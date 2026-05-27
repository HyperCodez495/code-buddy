# run-all-probes.ps1 — reproducible regression net for the "universal control piloting" work.
# Sequences the real-app validation probes authored alongside that feature and aggregates a
# pass/fail verdict. The probes themselves swallow errors and write a result JSON only on the
# success path, so this orchestrator is authoritative: it clears stale result files, runs each
# probe, then asserts the FRESH result file exists AND its pass-predicate holds.
#
#   Surfaces covered : WPF (virtualized Item 250) · Avalonia (basic + visible-deep + Item 250) · browser x2
#   WinForms baseline: see the pre-existing scratch/computer-use-real-test.ts harness (not folded in here).
#
# Exit code: 0 only if every non-skipped probe passes; 1 if any fails. Avalonia is SKIPPED (not
# failed) when its compiled fixture is absent and `dotnet` is unavailable to build it.
#
# Usage:  npm run pilot:validate     (or)     pwsh -File scratch/run-all-probes.ps1
# NOTE: launches real GUI apps (WPF/Avalonia) and headless chromium. Windows only.

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
$scratch  = $PSScriptRoot

function Read-Json($path) {
  if (-not (Test-Path $path)) { return $null }
  try { return Get-Content -Raw -LiteralPath $path | ConvertFrom-Json } catch { return $null }
}

# Each probe: a human label, the tsx entry, its result file, and a predicate over the parsed JSON.
$probes = @(
  @{
    Name    = 'WPF (virtualized Item 250)'
    Script  = 'scratch/wpf-snapshot-probe.ts'
    Result  = Join-Path $scratch 'wpf-snapshot-probe-result.json'
    Pass    = { param($j) $j.summary.hasItem1_visible -eq $true -and $j.summary.selectItem250_success -eq $true }
    Detail  = { param($j) "Item1 visible=$($j.summary.hasItem1_visible) selectItem250=$($j.summary.selectItem250_success) bigItem='$($j.summary.bigItem_after_select)' autoIds=$($j.summary.automationIdPopulated)" }
  },
  @{
    Name    = 'Avalonia (basic + visible-deep + Item 250)'
    Script  = 'scratch/avalonia-snapshot-probe.ts'
    Result  = Join-Path $scratch 'avalonia-snapshot-probe-result.json'
    Pass    = { param($j) $j.assertions.messageTyped -and $j.assertions.companionEnabled -and $j.assertions.virtualizedItemSelected -and $j.assertions.applyClicked }
    Detail  = { param($j) "msg=$($j.assertions.messageTyped) companion=$($j.assertions.companionEnabled) item250=$($j.assertions.virtualizedItemSelected) apply=$($j.assertions.applyClicked)" }
  },
  @{
    Name    = 'Browser — BrowserManager (selector-first by ref)'
    Script  = 'scratch/browser-use-probe.ts'
    Result  = Join-Path $scratch 'browser-use-probe-result.json'
    Pass    = { param($j) $j.statusAchieved -eq $true }
    Detail  = { param($j) "statusAchieved=$($j.statusAchieved) elements=$($j.elements)" }
  },
  @{
    Name    = 'Browser — BrowserTool surface (broad, 20 steps + example.com)'
    Script  = 'scratch/browser-use-probe2.ts'
    Result  = Join-Path $scratch 'browser-use-probe2-result.json'
    Pass    = { param($j) ($j.total -ge 18) -and ($j.passed -eq $j.total) }
    Detail  = { param($j) "passed=$($j.passed)/$($j.total) failed=[$([string]::Join(',', @($j.failed)))]" }
  }
)

# --- Avalonia build gate: the compiled fixture is gitignored, so build on demand or skip cleanly. ---
$avaloniaExe = Join-Path $scratch 'avalonia-fixture\bin\Debug\net10.0\AvaloniaFixture.exe'
$skipAvalonia = $false
$skipReason = ''
if (-not (Test-Path $avaloniaExe)) {
  if (Get-Command dotnet -ErrorAction SilentlyContinue) {
    Write-Host "[avalonia] compiled fixture missing -> dotnet build ..." -ForegroundColor Yellow
    $proj = Join-Path $scratch 'avalonia-fixture'
    & dotnet build $proj -c Debug 2>&1 | Out-Host
    if (-not (Test-Path $avaloniaExe)) { $skipAvalonia = $true; $skipReason = 'dotnet build did not produce the exe' }
  } else {
    $skipAvalonia = $true; $skipReason = 'dotnet not on PATH and exe not built'
  }
}

$rows = @()
foreach ($p in $probes) {
  $isAvalonia = $p.Script -like '*avalonia*'
  if ($isAvalonia -and $skipAvalonia) {
    Write-Host "`n=== SKIP $($p.Name) :: $skipReason ===" -ForegroundColor DarkYellow
    $rows += [pscustomobject]@{ Probe = $p.Name; Status = 'SKIP'; Detail = $skipReason }
    continue
  }

  Write-Host "`n=== RUN  $($p.Name) ===" -ForegroundColor Cyan
  Remove-Item -LiteralPath $p.Result -Force -ErrorAction SilentlyContinue

  Push-Location $repoRoot
  try { & npx tsx $p.Script 2>&1 | Out-Host } finally { Pop-Location }

  $j = Read-Json $p.Result
  if ($null -eq $j) {
    Write-Host "[FAIL] $($p.Name) :: no result file (probe threw before writing)" -ForegroundColor Red
    $rows += [pscustomobject]@{ Probe = $p.Name; Status = 'FAIL'; Detail = 'no result file' }
    continue
  }

  $ok = [bool](& $p.Pass $j)
  $detail = & $p.Detail $j
  if ($ok) {
    Write-Host "[PASS] $($p.Name) :: $detail" -ForegroundColor Green
    $rows += [pscustomobject]@{ Probe = $p.Name; Status = 'PASS'; Detail = $detail }
  } else {
    Write-Host "[FAIL] $($p.Name) :: $detail" -ForegroundColor Red
    $rows += [pscustomobject]@{ Probe = $p.Name; Status = 'FAIL'; Detail = $detail }
  }
}

Write-Host "`n================ PILOT VALIDATION SUMMARY ================" -ForegroundColor White
$rows | Format-Table -AutoSize | Out-Host
$failed = @($rows | Where-Object { $_.Status -eq 'FAIL' })
$skipped = @($rows | Where-Object { $_.Status -eq 'SKIP' })
if ($skipped.Count) { Write-Host "$($skipped.Count) skipped." -ForegroundColor DarkYellow }
if ($failed.Count) {
  Write-Host "$($failed.Count) FAILED: $([string]::Join('; ', @($failed.Probe)))" -ForegroundColor Red
  exit 1
}
Write-Host "All non-skipped probes passed." -ForegroundColor Green
exit 0
