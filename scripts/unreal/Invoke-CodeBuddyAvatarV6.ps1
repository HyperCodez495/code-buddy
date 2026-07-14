[CmdletBinding()]
param(
  [ValidateSet('Stage', 'Validate', 'Promote')]
  [string]$Mode = 'Stage',
  [string]$ProjectRoot = 'D:\DEV\AvatarStudio',
  [string]$EngineRoot = '',
  [string]$SourceRoot = '',
  [int]$GatewayPort = 3055,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $SourceRoot) {
  $SourceRoot = Join-Path $PSScriptRoot '..\..\integrations\unreal\CodeBuddyAvatar'
}
$SourceRoot = (Resolve-Path -LiteralPath $SourceRoot).Path
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$SplitRoot = Join-Path $ProjectRoot '.codebuddy\metahuman-splits\split-a.6'
$StageRoot = Join-Path $SplitRoot 'CodeBuddyAvatar'
$EvidenceRoot = Join-Path $SplitRoot 'evidence'
$ManifestPath = Join-Path $SourceRoot 'bundle-manifest.json'

function Get-IsoStamp {
  return [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
}

function Get-RelativeFileMap([string]$Root, [switch]$ExcludeManifest) {
  $map = @{}
  Get-ChildItem -LiteralPath $Root -File -Recurse | ForEach-Object {
    $relative = [System.IO.Path]::GetRelativePath($Root, $_.FullName).Replace('\', '/')
    if ($ExcludeManifest -and $relative -eq 'bundle-manifest.json') { return }
    $map[$relative] = $_.FullName
  }
  return $map
}

function Test-Bundle([string]$Root) {
  $manifestFile = Join-Path $Root 'bundle-manifest.json'
  if (-not (Test-Path -LiteralPath $manifestFile -PathType Leaf)) {
    throw "Missing bundle manifest: $manifestFile"
  }
  $manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
  if ($manifest.bundleId -ne 'metahuman-split-a.6' -or $manifest.protocolVersion -ne 1) {
    throw 'Unexpected bundle identity or protocol version.'
  }
  $actual = Get-RelativeFileMap -Root $Root -ExcludeManifest
  $expected = @{}
  foreach ($entry in $manifest.files) { $expected[$entry.path] = $entry }
  $actualNames = @($actual.Keys | Sort-Object)
  $expectedNames = @($expected.Keys | Sort-Object)
  if (($actualNames -join "`n") -ne ($expectedNames -join "`n")) {
    throw 'Bundle tree differs from the manifest (missing or unexpected files).'
  }
  foreach ($name in $expectedNames) {
    $file = Get-Item -LiteralPath $actual[$name]
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $expected[$name].sha256 -or $file.Length -ne $expected[$name].size) {
      throw "Bundle hash/size mismatch: $name"
    }
  }
  return $manifest
}

function Get-RelevantProcessMap {
  return @(
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -match '^(UnrealEditor|UnrealEditor-Cmd|AutomationTool|dotnet|MSBuild|cl)(\.exe)?$'
      } |
      Select-Object Name, ProcessId, ParentProcessId, CreationDate, ExecutablePath, CommandLine
  )
}

function Get-NetworkEvidence {
  $profiles = @(
    Get-NetFirewallProfile -ErrorAction SilentlyContinue |
      Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction
  )
  $listeners = @(
    Get-NetTCPConnection -State Listen -LocalPort $GatewayPort -ErrorAction SilentlyContinue |
      Select-Object LocalAddress, LocalPort, OwningProcess, CreationTime
  )
  $reachable = Test-NetConnection -ComputerName 127.0.0.1 -Port $GatewayPort `
    -InformationLevel Quiet -WarningAction SilentlyContinue
  return [ordered]@{
    gatewayPort = $GatewayPort
    loopbackReachable = [bool]$reachable
    listeners = $listeners
    firewallProfiles = $profiles
    policyNote = 'No firewall rule is changed; the supported transport is a loopback SSH tunnel.'
  }
}

function Write-Evidence([string]$Kind, [System.Collections.IDictionary]$Data) {
  New-Item -ItemType Directory -Path $EvidenceRoot -Force | Out-Null
  $path = Join-Path $EvidenceRoot ("$Kind-$(Get-IsoStamp).json")
  $Data['schemaVersion'] = 1
  $Data['kind'] = $Kind
  $Data['createdAt'] = [DateTime]::UtcNow.ToString('o')
  $Data | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $path -Encoding utf8
  Write-Host "Evidence: $path"
  return $path
}

function Move-Aside([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $backup = "$Path.$Label.$(Get-IsoStamp)"
  Move-Item -LiteralPath $Path -Destination $backup
  return $backup
}

function Stage-Bundle {
  $sourceManifest = Test-Bundle -Root $SourceRoot
  $sourceManifestHash = (Get-FileHash -LiteralPath $ManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
  New-Item -ItemType Directory -Path $SplitRoot -Force | Out-Null
  $previous = $null
  if (Test-Path -LiteralPath $StageRoot) {
    try {
      Test-Bundle -Root $StageRoot | Out-Null
      $stageManifestHash = (Get-FileHash -LiteralPath (Join-Path $StageRoot 'bundle-manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($stageManifestHash -eq $sourceManifestHash) {
        Write-Host "Existing stage already matches the current manifest: $StageRoot"
        return $sourceManifest
      }
      $previous = Move-Aside -Path $StageRoot -Label 'stale'
    } catch {
      $previous = Move-Aside -Path $StageRoot -Label 'stale'
    }
  }
  Copy-Item -LiteralPath $SourceRoot -Destination $StageRoot -Recurse
  Test-Bundle -Root $StageRoot | Out-Null
  Write-Evidence -Kind 'stage' -Data ([ordered]@{
    mode = 'Stage'
    sourceRoot = $SourceRoot
    stageRoot = $StageRoot
    manifestSha256 = $sourceManifestHash
    previousStage = $previous
    fileCount = @($sourceManifest.files).Count
    processMap = Get-RelevantProcessMap
    network = Get-NetworkEvidence
  }) | Out-Null
  return $sourceManifest
}

function Invoke-CheckedProcess(
  [string]$Name,
  [string]$FilePath,
  [string[]]$ArgumentList,
  [string]$WorkingDirectory,
  [string]$LogRoot
) {
  New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
  $stdout = Join-Path $LogRoot "$Name.stdout.log"
  $stderr = Join-Path $LogRoot "$Name.stderr.log"
  $startedAt = [DateTime]::UtcNow
  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList `
    -WorkingDirectory $WorkingDirectory -PassThru -Wait -NoNewWindow `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $record = [ordered]@{
    name = $Name
    pid = $process.Id
    startTimeUtc = $startedAt.ToString('o')
    exitTimeUtc = [DateTime]::UtcNow.ToString('o')
    exitCode = $process.ExitCode
    stdout = $stdout
    stderr = $stderr
  }
  if ($null -eq $process.ExitCode -or $process.ExitCode -ne 0) {
    $record['failed'] = $true
  }
  return [pscustomobject]$record
}

function Get-TreeHashes([string]$Root) {
  $result = @()
  $files = Get-RelativeFileMap -Root $Root
  foreach ($relative in @($files.Keys | Sort-Object)) {
    $item = Get-Item -LiteralPath $files[$relative]
    $result += [ordered]@{
      path = $relative
      size = $item.Length
      sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  return $result
}

function Validate-Bundle {
  Stage-Bundle | Out-Null
  if (-not $EngineRoot) {
    throw 'Validate requires -EngineRoot (for example D:\Epic\UE_5.8).'
  }
  $EngineRoot = [System.IO.Path]::GetFullPath($EngineRoot)
  $runUat = Join-Path $EngineRoot 'Engine\Build\BatchFiles\RunUAT.bat'
  $editorCmd = Join-Path $EngineRoot 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
  if (-not (Test-Path -LiteralPath $runUat -PathType Leaf) -or
      -not (Test-Path -LiteralPath $editorCmd -PathType Leaf)) {
    throw "EngineRoot does not contain RunUAT and UnrealEditor-Cmd: $EngineRoot"
  }
  if (Get-Process UnrealEditor -ErrorAction SilentlyContinue) {
    throw 'Validation refuses to run while the Unreal Editor GUI is active.'
  }

  $validationRoot = Join-Path $SplitRoot 'validation'
  $previousValidation = Move-Aside -Path $validationRoot -Label 'previous'
  New-Item -ItemType Directory -Path $validationRoot -Force | Out-Null
  $packageRoot = Join-Path $validationRoot 'Package\CodeBuddyAvatar'
  $logs = Join-Path $validationRoot 'logs'
  $before = Get-RelevantProcessMap
  $runs = @()
  $failure = $null
  try {
    $buildRun = Invoke-CheckedProcess -Name 'build-plugin' -FilePath $runUat `
      -ArgumentList @(
        'BuildPlugin',
        ('-Plugin="{0}"' -f (Join-Path $StageRoot 'CodeBuddyAvatar.uplugin')),
        ('-Package="{0}"' -f $packageRoot),
        '-TargetPlatforms=Win64'
      ) -WorkingDirectory $EngineRoot -LogRoot $logs
    $runs += $buildRun
    if ($buildRun.exitCode -ne 0) {
      throw "build-plugin failed with exit code $($buildRun.exitCode)."
    }

    $hostRoot = Join-Path $validationRoot 'HostProject'
    $hostPlugin = Join-Path $hostRoot 'Plugins\CodeBuddyAvatar'
    New-Item -ItemType Directory -Path (Split-Path $hostPlugin -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $packageRoot -Destination $hostPlugin -Recurse
    $hostProjectFile = Join-Path $hostRoot 'CodeBuddyAvatarHost.uproject'
    @{
      FileVersion = 3
      EngineAssociation = '5.8'
      Category = 'Validation'
      Description = 'Disposable CodeBuddyAvatar validation host'
      Plugins = @(@{ Name = 'CodeBuddyAvatar'; Enabled = $true })
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $hostProjectFile -Encoding utf8

    $testRun = Invoke-CheckedProcess -Name 'automation-tests' -FilePath $editorCmd `
      -ArgumentList @(
        ('"{0}"' -f $hostProjectFile),
        '-unattended',
        '-nop4',
        '-NullRHI',
        '-nosplash',
        '-stdout',
        '-FullStdOutLogOutput',
        '-ExecCmds=Automation RunTests CodeBuddy.Avatar;Quit',
        '-TestExit=Automation Test Queue Empty'
      ) -WorkingDirectory $hostRoot -LogRoot $logs
    $runs += $testRun
    if ($testRun.exitCode -ne 0) {
      throw "automation-tests failed with exit code $($testRun.exitCode)."
    }
  } catch {
    $failure = $_.Exception.Message
  }

  $after = Get-RelevantProcessMap
  $evidence = [ordered]@{
    mode = 'Validate'
    engineRoot = $EngineRoot
    engineBuildVersion = if (Test-Path (Join-Path $EngineRoot 'Engine\Build\Build.version')) {
      Get-Content -LiteralPath (Join-Path $EngineRoot 'Engine\Build\Build.version') -Raw | ConvertFrom-Json
    } else { $null }
    stageRoot = $StageRoot
    validationRoot = $validationRoot
    previousValidation = $previousValidation
    sourceManifestSha256 = (Get-FileHash -LiteralPath (Join-Path $StageRoot 'bundle-manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
    processMapBefore = $before
    processRuns = $runs
    processMapAfter = $after
    packagedTree = if (Test-Path -LiteralPath $packageRoot) { Get-TreeHashes -Root $packageRoot } else { @() }
    network = Get-NetworkEvidence
    success = ($null -eq $failure)
    failure = $failure
  }
  Write-Evidence -Kind 'validation' -Data $evidence | Out-Null
  if ($failure) { throw $failure }
}

function Promote-Bundle {
  Stage-Bundle | Out-Null
  if (Get-Process UnrealEditor -ErrorAction SilentlyContinue) {
    throw 'Promotion refuses to run while the Unreal Editor GUI is active.'
  }
  $pluginsRoot = Join-Path $ProjectRoot 'Plugins'
  $destination = Join-Path $pluginsRoot 'CodeBuddyAvatar'
  New-Item -ItemType Directory -Path $pluginsRoot -Force | Out-Null
  $backup = $null
  if (Test-Path -LiteralPath $destination) {
    if (-not $Force) {
      throw "Plugin already exists at $destination. Re-run with -Force to preserve it as an explicit backup."
    }
    $backup = Move-Aside -Path $destination -Label 'backup'
  }
  Copy-Item -LiteralPath $StageRoot -Destination $destination -Recurse
  Test-Bundle -Root $destination | Out-Null
  Write-Evidence -Kind 'promotion' -Data ([ordered]@{
    mode = 'Promote'
    destination = $destination
    backup = $backup
    manifestSha256 = (Get-FileHash -LiteralPath (Join-Path $destination 'bundle-manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
    processMap = Get-RelevantProcessMap
    network = Get-NetworkEvidence
  }) | Out-Null
}

try {
  switch ($Mode) {
    'Stage' { Stage-Bundle | Out-Null }
    'Validate' { Validate-Bundle }
    'Promote' { Promote-Bundle }
  }
  Write-Host "CodeBuddyAvatar v5 $Mode completed successfully."
  exit 0
} catch {
  Write-Error $_
  exit 1
}
