param(
  [int]$Port = 3000,
  [int]$StartupTimeoutSeconds = 60
)

. (Join-Path $PSScriptRoot "Common.ps1")

if (Test-ListingRadarServer -Port $Port) {
  Write-ListingRadarLog -Name "server" -Message "Server already running on port $Port."
  exit 0
}

$root = Get-ListingRadarRoot
$runtimeDirectory = Get-ListingRadarRuntimeDirectory
$stdoutPath = Join-Path $runtimeDirectory "server.out.log"
$stderrPath = Join-Path $runtimeDirectory "server.err.log"
$npm = (Get-Command "npm.cmd" -ErrorAction Stop).Source

Start-Process `
  -FilePath $npm `
  -ArgumentList @("run", "dev", "--", "-p", "$Port") `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath

$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)

do {
  Start-Sleep -Seconds 1

  if (Test-ListingRadarServer -Port $Port) {
    Write-ListingRadarLog -Name "server" -Message "Server started on port $Port."
    exit 0
  }
} while ((Get-Date) -lt $deadline)

Write-ListingRadarLog -Name "server" -Message "Server did not start within $StartupTimeoutSeconds seconds."
throw "Listing Radar did not start on port $Port."
