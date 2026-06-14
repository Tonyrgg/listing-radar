param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("/api/cron/email-alerts", "/api/cron/scrape")]
  [string]$EndpointPath,
  [Parameter(Mandatory = $true)]
  [ValidateSet("email-alerts", "scrape")]
  [string]$LogName,
  [int]$Port = 3000,
  [int]$TimeoutSeconds = 600
)

. (Join-Path $PSScriptRoot "Common.ps1")

$mutexName = "Local\ListingRadar-$LogName"
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
$hasLock = $false

try {
  $hasLock = $mutex.WaitOne(0)

  if (-not $hasLock) {
    Write-ListingRadarLog -Name $LogName -Message "Skipped: another run is active."
    exit 0
  }

  if (-not (Test-ListingRadarServer -Port $Port)) {
    & (Join-Path $PSScriptRoot "Start-ListingRadar.ps1") -Port $Port
  }

  $secret = Get-ListingRadarEnvValue -Name "CRON_SECRET"
  $uri = "http://localhost:$Port$EndpointPath"
  $response = Invoke-RestMethod `
    -Method Post `
    -Uri $uri `
    -Headers @{ Authorization = "Bearer $secret" } `
    -TimeoutSec $TimeoutSeconds
  $runtimeDirectory = Get-ListingRadarRuntimeDirectory
  $resultPath = Join-Path $runtimeDirectory "$LogName.latest.json"

  $response | ConvertTo-Json -Depth 12 |
    Set-Content -LiteralPath $resultPath -Encoding UTF8

  if ($EndpointPath -eq "/api/cron/email-alerts") {
    $email = $response.emailAlerts
    $message = "ok=$($response.ok) connected=$($email.connected) checked=$($email.messagesChecked) processed=$($email.messagesProcessed) inserted=$($email.incomingInserted) errors=$($email.errors.Count)"
  } else {
    $providerCount = @($response.providers).Count
    $message = "ok=$($response.ok) providers=$providerCount inserted=$($response.inserted) updated=$($response.updated) snapshots=$($response.snapshots)"
  }

  Write-ListingRadarLog -Name $LogName -Message $message

  if (-not $response.ok) {
    exit 1
  }
} catch {
  Write-ListingRadarLog -Name $LogName -Message "FAILED: $($_.Exception.Message)"
  throw
} finally {
  if ($hasLock) {
    $mutex.ReleaseMutex()
  }

  $mutex.Dispose()
}
