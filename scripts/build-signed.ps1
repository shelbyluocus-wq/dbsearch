[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$KeyPath = "C:\Users\Administrator\.tauri\dbsearch.key",

  [Parameter()]
  [string]$PasswordPath,

  [Parameter()]
  [string]$OutputEnvPath,

  [Parameter()]
  [string]$OutputPasswordPath,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$TauriArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Content
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Resolve-SigningKey {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if ($env:TAURI_SIGNING_PRIVATE_KEY) {
    return $env:TAURI_SIGNING_PRIVATE_KEY
  }

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Signing key not found. Set TAURI_SIGNING_PRIVATE_KEY or create $Path."
  }

  return Get-Content -LiteralPath $Path -Raw
}

function Resolve-SigningKeyPassword {
  param(
    [Parameter(Mandatory = $true)]
    [string]$KeyPath,

    [Parameter()]
    [string]$ExplicitPasswordPath
  )

  if ($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    return $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  }

  $candidatePasswordPath = $ExplicitPasswordPath
  if (-not $candidatePasswordPath) {
    $candidatePasswordPath = "$KeyPath.password"
  }

  if (Test-Path -LiteralPath $candidatePasswordPath) {
    return (Get-Content -LiteralPath $candidatePasswordPath -Raw).TrimEnd("`r", "`n")
  }

  return ""
}

function Invoke-NpmCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,

    [string]$SigningKey,

    [AllowEmptyString()]
    [string]$SigningKeyPassword
  )

  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npmCommand) {
    $npmCommand = Get-Command npm -ErrorAction Stop
  }

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $npmCommand.Source
  $startInfo.WorkingDirectory = (Get-Location).Path
  $startInfo.UseShellExecute = $false
  $startInfo.Arguments = [string]::Join(" ", ($Arguments | ForEach-Object {
    if ($_ -match '[\s"]') {
      '"' + ($_ -replace '"', '\"') + '"'
    } else {
      $_
    }
  }))

  if ($SigningKey) {
    $startInfo.EnvironmentVariables["TAURI_SIGNING_PRIVATE_KEY"] = $SigningKey
  }

  if ($null -ne $SigningKeyPassword) {
    $startInfo.EnvironmentVariables["TAURI_SIGNING_PRIVATE_KEY_PASSWORD"] = $SigningKeyPassword
  }

  $process = [System.Diagnostics.Process]::Start($startInfo)
  if (-not $process) {
    throw "Failed to start npm."
  }

  $process.WaitForExit()
  return $process.ExitCode
}

function Test-RequiresSigningContext {
  param(
    [string[]]$Args,
    [string]$RawCommandLine
  )

  foreach ($arg in $Args) {
    if ($arg -in @("--help", "-h", "--version", "-V", "--no-sign")) {
      return $false
    }
  }

  if ($RawCommandLine -match '(^|\s)(--help|-h|--version|-V|--no-sign)(\s|$)') {
    return $false
  }

  return $true
}

$passThroughArgs = @()
if ($TauriArgs) {
  $passThroughArgs += $TauriArgs
}
$unboundArgs = Get-Variable -Name args -Scope Script -ErrorAction SilentlyContinue
if ($unboundArgs -and $unboundArgs.Value) {
  $passThroughArgs += $unboundArgs.Value
}

$requiresSigningContext = Test-RequiresSigningContext -Args $passThroughArgs -RawCommandLine ([Environment]::CommandLine)
$resolvedSigningKey = $null
$resolvedPassword = $null

if ($requiresSigningContext) {
  $resolvedSigningKey = Resolve-SigningKey -Path $KeyPath
  $resolvedPassword = Resolve-SigningKeyPassword -KeyPath $KeyPath -ExplicitPasswordPath $PasswordPath
}

if ($OutputEnvPath) {
  Write-Utf8NoBom -Path $OutputEnvPath -Content $resolvedSigningKey
  Write-Output "Wrote signing key to $OutputEnvPath for verification."
}

if ($OutputPasswordPath -and $null -ne $resolvedPassword) {
  Write-Utf8NoBom -Path $OutputPasswordPath -Content $resolvedPassword
}

if ($OutputEnvPath -or $OutputPasswordPath) {
  exit 0
}

$commandArgs = @("run", "tauri", "--", "build") + $passThroughArgs
$exitCode = Invoke-NpmCommand -Arguments $commandArgs -SigningKey $resolvedSigningKey -SigningKeyPassword $resolvedPassword
exit $exitCode
