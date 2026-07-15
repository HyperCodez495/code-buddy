[CmdletBinding()]
param(
  [string]$BindHost = '100.73.222.64',
  [int]$Port = 4310,
  [string]$Repo = 'D:\DEV\code-buddy-gpu-worker',
  [string]$NodeDir = 'D:\DEV\_third_party\node-v22.23.1-win-x64',
  [string]$StateDir = 'D:\CodeBuddyData\gpu-worker',
  [string]$TokenFile = 'D:\CodeBuddyData\gpu-worker\token'
)

$ErrorActionPreference = 'Stop'
$token = (Get-Content -LiteralPath $TokenFile -Raw).Trim()
if ([Text.Encoding]::UTF8.GetByteCount($token) -lt 24) {
  throw 'The GPU worker token file must contain at least 24 bytes.'
}

$runner = Join-Path $Repo 'scripts\gpu-runners\panoworld-wsl.sh'
$node = Join-Path $NodeDir 'node.exe'
$entrypoint = Join-Path $Repo 'dist\index.js'
foreach ($path in @($runner, $node, $entrypoint)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required worker file does not exist: $path"
  }
}

$roots = @('D:\DEV', 'D:\CodeBuddyData', 'D:\LisaMedia') |
  Where-Object { Test-Path -LiteralPath $_ -PathType Container }
if ($roots.Count -eq 0) {
  throw 'No GPU worker filesystem root is available.'
}

$env:CODEBUDDY_GPU_WORKER_TOKEN = $token
$env:CODEBUDDY_PANOWORLD_RUNNER = 'C:\Windows\System32\wsl.exe'
$env:CODEBUDDY_PANOWORLD_RUNNER_ARGS = @(
  '-d',
  'Ubuntu-22.04',
  '--',
  'bash',
  '/mnt/d/DEV/code-buddy-gpu-worker/scripts/gpu-runners/panoworld-wsl.sh'
) | ConvertTo-Json -Compress
$forwarded = 'CODEBUDDY_GPU_JOB_REQUEST/p:CODEBUDDY_GPU_JOB_RESULT/p:CODEBUDDY_GPU_JOB_ID'
$env:WSLENV = if ($env:WSLENV) { "${env:WSLENV}:$forwarded" } else { $forwarded }

New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
Set-Location -LiteralPath $Repo
$arguments = @(
  $entrypoint,
  'gpu-worker',
  '--host',
  $BindHost,
  '--port',
  [string]$Port,
  '--state-dir',
  $StateDir,
  '--worker-id',
  'darkstar',
  '--max-concurrency',
  '1',
  '--root'
) + $roots
& $node @arguments
exit $LASTEXITCODE
