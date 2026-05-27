param(
  [Parameter(Mandatory = $true)] [string]$Exe,
  [Parameter(Mandatory = $true)] [string]$StatePath
)

# One-off diagnostic: launch the Avalonia fixture and dump its UIA subtree, annotating
# ScrollPattern / ItemContainerPattern availability — to understand why virtualized-item
# realization fails on Avalonia and which fallback tier to add (task #6).

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$env:CB_FIXTURE_STATE = $StatePath
$proc = Start-Process -FilePath $Exe -PassThru
Start-Sleep -Seconds 4

$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::NameProperty, 'CodeBuddy Avalonia Fixture')
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)

if ($null -eq $win) {
  Write-Output 'WINDOW NOT FOUND'
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  return
}

$script:lines = New-Object System.Collections.Generic.List[string]
function Walk($el, [int]$d) {
  if ($null -eq $el -or $d -gt 20 -or $script:lines.Count -ge 320) { return }
  try {
    $name = [string]$el.Current.Name
    if ($name.Length -gt 22) { $name = $name.Substring(0, 22) }
    $role = ([string]$el.Current.ControlType.ProgrammaticName) -replace 'ControlType\.', ''
    $extra = ''
    try {
      if ([bool]$el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsScrollPatternAvailableProperty)) {
        $sp = $el.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
        $extra += " SCROLL(vScrollable=$($sp.Current.VerticallyScrollable))"
      }
    } catch {}
    try {
      if ([bool]$el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsItemContainerPatternAvailableProperty)) { $extra += ' ITEMCONTAINER' }
    } catch {}
    $script:lines.Add((('. ' * $d) + "[$role] '$name'$extra"))
  } catch {}
  try {
    $c = $walker.GetFirstChild($el)
    while ($null -ne $c) { Walk $c ($d + 1); $c = $walker.GetNextSibling($c) }
  } catch {}
}
Walk $win 0

Write-Output ("TOTAL_NODES=" + $script:lines.Count)
$script:lines | ForEach-Object { Write-Output $_ }

Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
