<# 
Usage:
  powershell -ExecutionPolicy Bypass -File .\scripts\update-ollama-windows.ps1

This script:
  - checks the local Ollama version on http://127.0.0.1:11434
  - runs the official Ollama Windows installer/update script
  - waits for Ollama to become reachable again

Optional flags:
  -InstallerScriptUrl <url>   Override the official installer script URL
  -WaitTimeoutSeconds <n>     How long to wait for Ollama to come back
  -SkipStop                   Do not stop local Ollama processes first
#>
param(
  [string]$InstallerScriptUrl = 'https://ollama.com/install.ps1',
  [int]$WaitTimeoutSeconds = 300,
  [switch]$SkipStop
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-OllamaVersion {
  try {
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 5
    if ($null -ne $response.version -and -not [string]::IsNullOrWhiteSpace([string]$response.version)) {
      return [string]$response.version
    }
  } catch {
    return $null
  }

  return $null
}

function Wait-OllamaReady {
  param(
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $version = Get-OllamaVersion
    if ($null -ne $version) {
      return $version
    }

    Start-Sleep -Seconds 2
  }

  return $null
}

function Stop-OllamaProcesses {
  $names = @('Ollama', 'ollama')
  foreach ($name in $names) {
    $processes = Get-Process -Name $name -ErrorAction SilentlyContinue
    foreach ($process in $processes) {
      try {
        Stop-Process -Id $process.Id -Force -ErrorAction Stop
      } catch {
        Write-Host "Could not stop process $($process.ProcessName) ($($process.Id)): $($_.Exception.Message)" -ForegroundColor Yellow
      }
    }
  }
}

Write-Host '==================================================' -ForegroundColor Cyan
Write-Host '   Ollama Windows updater                          ' -ForegroundColor Cyan
Write-Host '==================================================' -ForegroundColor Cyan

$before = Get-OllamaVersion
if ($null -ne $before) {
  Write-Host "Current Ollama version: $before" -ForegroundColor Yellow
} else {
  Write-Host 'Current Ollama version: unavailable (API not reachable)' -ForegroundColor Yellow
}

if (-not $SkipStop) {
  Write-Host 'Stopping local Ollama processes if any...' -ForegroundColor Yellow
  Stop-OllamaProcesses
}

$request = @{
  Uri         = $InstallerScriptUrl
  ErrorAction = 'Stop'
}

if ($PSVersionTable.PSVersion.Major -lt 6) {
  $request['UseBasicParsing'] = $true
}

Write-Host "Downloading official installer script from $InstallerScriptUrl" -ForegroundColor Green
$installerScript = (Invoke-WebRequest @request).Content

if ([string]::IsNullOrWhiteSpace($installerScript)) {
  throw "Installer script download returned empty content from $InstallerScriptUrl"
}

Write-Host 'Running Ollama installer/update script...' -ForegroundColor Green
Invoke-Expression $installerScript

Write-Host "Waiting up to $WaitTimeoutSeconds second(s) for Ollama to come back..." -ForegroundColor Green
$after = Wait-OllamaReady -TimeoutSeconds $WaitTimeoutSeconds

if ($null -eq $after) {
  throw "Ollama did not become reachable at http://127.0.0.1:11434/api/version within $WaitTimeoutSeconds second(s)"
}

Write-Host "Updated Ollama version: $after" -ForegroundColor Green
