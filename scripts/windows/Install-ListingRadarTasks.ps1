param(
  [int]$Port = 3000,
  [int]$EmailIntervalMinutes = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$startScript = Join-Path $PSScriptRoot "Start-ListingRadar.ps1"
$cronScript = Join-Path $PSScriptRoot "Invoke-ListingRadarCron.ps1"
$powerShell = Join-Path $PSHOME "powershell.exe"
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal `
  -UserId $userId `
  -LogonType Interactive `
  -RunLevel Limited

function New-ListingRadarAction {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Arguments
  )

  return New-ScheduledTaskAction `
    -Execute $powerShell `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass $Arguments"
}

function Register-ListingRadarTask {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TaskName,
    [Parameter(Mandatory = $true)]
    [Microsoft.Management.Infrastructure.CimInstance]$Action,
    [Parameter(Mandatory = $true)]
    [Microsoft.Management.Infrastructure.CimInstance[]]$Trigger,
    [Parameter(Mandatory = $true)]
    [TimeSpan]$ExecutionTimeLimit,
    [Parameter(Mandatory = $true)]
    [string]$Description
  )

  $settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit $ExecutionTimeLimit `
    -MultipleInstances IgnoreNew

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Principal $principal `
    -Settings $settings `
    -Description $Description `
    -Force | Out-Null
}

$startAction = New-ListingRadarAction `
  -Arguments "-File `"$startScript`" -Port $Port"
$startTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userId

Register-ListingRadarTask `
  -TaskName "Listing Radar - Start" `
  -Action $startAction `
  -Trigger $startTrigger `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
  -Description "Starts the private Listing Radar Next.js application at user logon."

$emailAction = New-ListingRadarAction `
  -Arguments "-File `"$cronScript`" -EndpointPath `"/api/cron/email-alerts`" -LogName `"email-alerts`" -Port $Port -TimeoutSeconds 180"
$emailTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $EmailIntervalMinutes)

Register-ListingRadarTask `
  -TaskName "Listing Radar - Email Alerts" `
  -Action $emailAction `
  -Trigger $emailTrigger `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 4) `
  -Description "Checks the configured mailbox for real-estate alerts every $EmailIntervalMinutes minutes."

Unregister-ScheduledTask `
  -TaskName "Listing Radar - Daily Scrape" `
  -Confirm:$false `
  -ErrorAction SilentlyContinue

Start-ScheduledTask -TaskName "Listing Radar - Start"

Get-ScheduledTask -TaskName "Listing Radar*" |
  Select-Object TaskName, State, TaskPath
