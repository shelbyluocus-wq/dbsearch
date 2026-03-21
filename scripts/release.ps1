[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Version,

  [Parameter(Position = 1)]
  [string]$PackageJsonPath,

  [Parameter(Position = 2)]
  [string]$CargoTomlPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptRoot = $PSScriptRoot
if (-not $scriptRoot) {
  $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}

if (-not $PackageJsonPath) {
  $PackageJsonPath = Join-Path $scriptRoot "..\package.json"
}

if (-not $CargoTomlPath) {
  $CargoTomlPath = Join-Path $scriptRoot "..\src-tauri\Cargo.toml"
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$Content
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Normalize-Version {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RawVersion
  )

  $normalized = $RawVersion.Trim()

  if ($normalized.StartsWith("v")) {
    $normalized = $normalized.Substring(1)
  }

  if ($normalized -notmatch '^\d+\.\d+\.\d+$') {
    throw "Invalid version '$RawVersion'. Use x.y.z, for example 4.4.1 or v4.4.1."
  }

  return $normalized
}

function Update-PackageJsonVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$Version
  )

  $packageJson = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  $packageJson.version = $Version
  $content = $packageJson | ConvertTo-Json -Depth 100
  Write-Utf8NoBom -Path $Path -Content "$content`n"
}

function Update-PackageLockVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$Version
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $content = Get-Content -LiteralPath $Path -Raw
  $updatedRootContent = [System.Text.RegularExpressions.Regex]::Replace(
    $content,
    '(?m)^(\s*"version"\s*:\s*")[^"]+(")',
    "`${1}${Version}`${2}",
    1
  )

  if ($updatedRootContent -eq $content) {
    throw "Could not find the root version field inside package-lock.json."
  }

  $updatedContent = [System.Text.RegularExpressions.Regex]::Replace(
    $updatedRootContent,
    '(?ms)("packages"\s*:\s*\{\s*""\s*:\s*\{.*?"version"\s*:\s*")[^"]+(")',
    "`${1}${Version}`${2}",
    1
  )

  Write-Utf8NoBom -Path $Path -Content $updatedContent
}

function Update-CargoTomlVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$Version
  )

  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($line in Get-Content -LiteralPath $Path) {
    [void]$lines.Add($line)
  }

  $inPackageSection = $false
  $updated = $false

  for ($index = 0; $index -lt $lines.Count; $index++) {
    $line = $lines[$index]

    if ($line -match '^\s*\[package\]\s*$') {
      $inPackageSection = $true
      continue
    }

    if ($inPackageSection -and $line -match '^\s*\[[^\]]+\]\s*$') {
      $inPackageSection = $false
    }

    if ($inPackageSection -and -not $updated -and $line -match '^(?<indent>\s*)version\s*=\s*".*"\s*$') {
      $indent = $Matches["indent"]
      $lines[$index] = "$indent" + 'version = "' + $Version + '"'
      $updated = $true
    }
  }

  if (-not $updated) {
    throw "Could not find a version field inside the [package] section of Cargo.toml."
  }

  Write-Utf8NoBom -Path $Path -Content (($lines -join [Environment]::NewLine) + [Environment]::NewLine)
}

function Update-CargoLockVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$Version
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $content = Get-Content -LiteralPath $Path -Raw
  $updatedContent = [System.Text.RegularExpressions.Regex]::Replace(
    $content,
    '(?ms)(\[\[package\]\]\s*name = "tauri-app"\s*version = ")[^"]+(")',
    "`${1}${Version}`${2}",
    1
  )

  if ($updatedContent -eq $content) {
    return
  }

  Write-Utf8NoBom -Path $Path -Content $updatedContent
}

$resolvedPackageJsonPath = (Resolve-Path -LiteralPath $PackageJsonPath).Path
$resolvedCargoTomlPath = (Resolve-Path -LiteralPath $CargoTomlPath).Path
$resolvedPackageLockPath = Join-Path (Split-Path -Parent $resolvedPackageJsonPath) "package-lock.json"
$resolvedCargoLockPath = Join-Path (Split-Path -Parent $resolvedCargoTomlPath) "Cargo.lock"
$normalizedVersion = Normalize-Version -RawVersion $Version

Update-PackageJsonVersion -Path $resolvedPackageJsonPath -Version $normalizedVersion
Update-PackageLockVersion -Path $resolvedPackageLockPath -Version $normalizedVersion
Update-CargoTomlVersion -Path $resolvedCargoTomlPath -Version $normalizedVersion
Update-CargoLockVersion -Path $resolvedCargoLockPath -Version $normalizedVersion

Write-Output "Updated version to $normalizedVersion"
Write-Output "package.json: $resolvedPackageJsonPath"
Write-Output "Cargo.toml: $resolvedCargoTomlPath"
