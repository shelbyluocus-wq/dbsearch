[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Version,

  [Parameter(Position = 1)]
  [string]$PackageJsonPath,

  [Parameter(Position = 2)]
  [string]$CargoTomlPath,

  [Parameter(Position = 3)]
  [string]$TauriConfigPath
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

if (-not $TauriConfigPath) {
  $TauriConfigPath = Join-Path $scriptRoot "..\src-tauri\tauri.conf.json"
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

function Build-AppDisplayTitle {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Version
  )

  $baseName = Build-AppInstallName
  return "$baseName" + "V" + $Version
}

function Build-AppInstallName {
  return ([char]0x9E70).ToString() + ([char]0x6377).ToString()
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

  $rootVersionRegex = [System.Text.RegularExpressions.Regex]::new('(?m)^(\s*"version"\s*:\s*")[^"]+(")')
  $rootPackageVersionRegex = [System.Text.RegularExpressions.Regex]::new('(?ms)("packages"\s*:\s*\{\s*""\s*:\s*\{.*?"version"\s*:\s*")[^"]+(")')
  $content = Get-Content -LiteralPath $Path -Raw
  if (-not $rootVersionRegex.IsMatch($content)) {
    throw "Could not find the root version field inside package-lock.json."
  }

  $updatedRootContent = $rootVersionRegex.Replace($content, "`${1}${Version}`${2}", 1)
  $updatedContent = $rootPackageVersionRegex.Replace($updatedRootContent, "`${1}${Version}`${2}", 1)

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

  $cargoLockVersionRegex = [System.Text.RegularExpressions.Regex]::new('(?ms)(\[\[package\]\]\s*name = "tauri-app"\s*version = ")[^"]+(")')
  $content = Get-Content -LiteralPath $Path -Raw
  $updatedContent = $cargoLockVersionRegex.Replace($content, "`${1}${Version}`${2}", 1)

  if ($updatedContent -eq $content) {
    return
  }

  Write-Utf8NoBom -Path $Path -Content $updatedContent
}

function Update-TauriConfigDisplayTitle {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$Version
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $displayTitle = Build-AppDisplayTitle -Version $Version
  $installName = Build-AppInstallName
  $tauriConfig = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  $tauriConfig.productName = $installName

  $windows = $null
  if ($tauriConfig.PSObject.Properties.Name -contains "app" -and $tauriConfig.app) {
    if ($tauriConfig.app.PSObject.Properties.Name -contains "windows") {
      $windows = $tauriConfig.app.windows
    }
  }
  if ($windows) {
    foreach ($window in $windows) {
      if ($window.PSObject.Properties.Name -contains "title") {
        $window.title = $displayTitle
      } else {
        $window | Add-Member -NotePropertyName title -NotePropertyValue $displayTitle
      }
    }
  }

  $content = $tauriConfig | ConvertTo-Json -Depth 100
  Write-Utf8NoBom -Path $Path -Content "$content`n"
}

$resolvedPackageJsonPath = (Resolve-Path -LiteralPath $PackageJsonPath).Path
$resolvedCargoTomlPath = (Resolve-Path -LiteralPath $CargoTomlPath).Path
$resolvedTauriConfigPath = $null
if (Test-Path -LiteralPath $TauriConfigPath) {
  $resolvedTauriConfigPath = (Resolve-Path -LiteralPath $TauriConfigPath).Path
}
$resolvedPackageLockPath = Join-Path (Split-Path -Parent $resolvedPackageJsonPath) "package-lock.json"
$resolvedCargoLockPath = Join-Path (Split-Path -Parent $resolvedCargoTomlPath) "Cargo.lock"
$normalizedVersion = Normalize-Version -RawVersion $Version

Update-PackageJsonVersion -Path $resolvedPackageJsonPath -Version $normalizedVersion
Update-PackageLockVersion -Path $resolvedPackageLockPath -Version $normalizedVersion
Update-CargoTomlVersion -Path $resolvedCargoTomlPath -Version $normalizedVersion
Update-CargoLockVersion -Path $resolvedCargoLockPath -Version $normalizedVersion
if ($resolvedTauriConfigPath) {
  Update-TauriConfigDisplayTitle -Path $resolvedTauriConfigPath -Version $normalizedVersion
}

Write-Output "Updated version to $normalizedVersion"
Write-Output "package.json: $resolvedPackageJsonPath"
Write-Output "Cargo.toml: $resolvedCargoTomlPath"
if ($resolvedTauriConfigPath) {
  Write-Output "tauri.conf.json: $resolvedTauriConfigPath"
}
