Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

@(
  "Listing Radar - Start",
  "Listing Radar - Email Alerts",
  "Listing Radar - Daily Scrape"
) | ForEach-Object {
  Unregister-ScheduledTask -TaskName $_ -Confirm:$false -ErrorAction SilentlyContinue
}

Write-Output "Listing Radar scheduled tasks removed."
