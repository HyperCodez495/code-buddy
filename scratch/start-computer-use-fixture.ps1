param(
  [Parameter(Mandatory = $true)]
  [string]$FixturePath,

  [Parameter(Mandatory = $true)]
  [string]$StatePath
)

$process = Start-Process -FilePath powershell.exe -PassThru -ArgumentList @(
  '-NoProfile',
  '-Sta',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  $FixturePath,
  '-StatePath',
  $StatePath
)

$process.Id
