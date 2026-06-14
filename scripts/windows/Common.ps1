Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-ListingRadarRoot {
  return [System.IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot "..\..")
  )
}

function Get-ListingRadarEnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $envPath = Join-Path (Get-ListingRadarRoot) ".env.local"

  if (-not (Test-Path -LiteralPath $envPath)) {
    throw "Missing .env.local at $envPath"
  }

  $line = Get-Content -LiteralPath $envPath |
    Where-Object { $_ -match "^$([regex]::Escape($Name))=" } |
    Select-Object -First 1

  if (-not $line) {
    throw "Missing $Name in .env.local"
  }

  $value = $line.Substring($Name.Length + 1).Trim()

  if (
    $value.Length -ge 2 -and
    (($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'")))
  ) {
    $value = $value.Substring(1, $value.Length - 2)
  }

  if (-not $value) {
    throw "$Name is empty in .env.local"
  }

  return $value
}

function Get-ListingRadarRuntimeDirectory {
  $runtimeDirectory = Join-Path (Get-ListingRadarRoot) ".runtime"

  if (-not (Test-Path -LiteralPath $runtimeDirectory)) {
    New-Item -ItemType Directory -Path $runtimeDirectory | Out-Null
  }

  return $runtimeDirectory
}

function Test-ListingRadarServer {
  param(
    [int]$Port = 3000
  )

  try {
    $response = Invoke-WebRequest `
      -UseBasicParsing `
      -Uri "http://localhost:$Port/settings" `
      -TimeoutSec 3

    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Write-ListingRadarLog {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  $runtimeDirectory = Get-ListingRadarRuntimeDirectory
  $logPath = Join-Path $runtimeDirectory "$Name.log"
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

  Add-Content -LiteralPath $logPath -Value "[$timestamp] $Message"
}
