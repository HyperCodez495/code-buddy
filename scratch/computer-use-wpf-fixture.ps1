param(
  [Parameter(Mandatory = $true)]
  [string]$StatePath
)

# WPF Computer Use fixture — mirrors computer-use-fixture.ps1 (WinForms) but adds
# a virtualized 300-item ListBox and a DataGrid, and sets AutomationProperties.AutomationId
# on every control so the UIA snapshot can re-resolve elements by stable id (P0a/P0b/P0d).

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$script:appliedCount = 0

[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="CodeBuddy WPF Fixture" Width="740" Height="660" Topmost="True"
        WindowStartupLocation="Manual" Left="120" Top="80">
  <Grid Margin="16">
    <Grid.ColumnDefinitions>
      <ColumnDefinition Width="*"/>
      <ColumnDefinition Width="*"/>
    </Grid.ColumnDefinitions>
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="Auto"/>
    </Grid.RowDefinitions>

    <StackPanel Grid.Row="0" Grid.Column="0" Margin="0,0,8,10">
      <TextBlock Text="Message"/>
      <TextBox x:Name="MessageBox" AutomationProperties.AutomationId="Message" AutomationProperties.Name="Message"/>
      <TextBlock Text="Country" Margin="0,8,0,0"/>
      <ComboBox x:Name="CountryCombo" AutomationProperties.AutomationId="Country" AutomationProperties.Name="Country"/>
      <CheckBox x:Name="CompanionCheck" Content="Enable companion mode" Margin="0,8,0,0"
                AutomationProperties.AutomationId="Companion" AutomationProperties.Name="Enable companion mode"/>
    </StackPanel>

    <StackPanel Grid.Row="0" Grid.Column="1" Margin="8,0,0,10">
      <RadioButton x:Name="BasicRadio" Content="Basic mode" IsChecked="True"
                   AutomationProperties.AutomationId="BasicMode" AutomationProperties.Name="Basic mode"/>
      <RadioButton x:Name="ExpertRadio" Content="Expert mode"
                   AutomationProperties.AutomationId="ExpertMode" AutomationProperties.Name="Expert mode"/>
      <TextBlock Text="Zoom" Margin="0,8,0,0"/>
      <Slider x:Name="ZoomSlider" Minimum="0" Maximum="100" Value="25"
              AutomationProperties.AutomationId="Zoom" AutomationProperties.Name="Zoom"/>
    </StackPanel>

    <StackPanel Grid.Row="1" Grid.Column="0" Margin="0,0,8,10">
      <TextBlock Text="Projects"/>
      <TreeView x:Name="ProjectTree" Height="96" AutomationProperties.AutomationId="ProjectTree" AutomationProperties.Name="Project tree"/>
    </StackPanel>

    <TabControl x:Name="ModeTabs" Grid.Row="1" Grid.Column="1" Height="96" Margin="8,0,0,10"
                AutomationProperties.AutomationId="ModeTabs" AutomationProperties.Name="Mode tabs">
      <TabItem Header="Overview"/>
      <TabItem Header="Advanced"><TextBlock Text="Advanced panel" Margin="8"/></TabItem>
    </TabControl>

    <StackPanel Grid.Row="2" Grid.Column="0" Margin="0,0,8,10">
      <TextBlock Text="Big virtualized list (300 items)"/>
      <ListBox x:Name="BigList" Height="130"
               AutomationProperties.AutomationId="BigList" AutomationProperties.Name="BigList"
               VirtualizingStackPanel.IsVirtualizing="True"
               VirtualizingStackPanel.VirtualizationMode="Recycling"
               ScrollViewer.CanContentScroll="True"/>
    </StackPanel>

    <StackPanel Grid.Row="2" Grid.Column="1" Margin="8,0,0,10">
      <TextBlock Text="Data grid"/>
      <DataGrid x:Name="DataGrid1" Height="130" AutoGenerateColumns="True" IsReadOnly="True"
                AutomationProperties.AutomationId="DataGrid1" AutomationProperties.Name="DataGrid1"/>
    </StackPanel>

    <Button x:Name="ApplyButton" Grid.Row="3" Grid.Column="0" Content="Apply" Width="120" HorizontalAlignment="Left"
            AutomationProperties.AutomationId="Apply" AutomationProperties.Name="Apply"/>
    <TextBlock x:Name="StatusText" Grid.Row="3" Grid.Column="1" Text="Idle"
               AutomationProperties.AutomationId="Status" AutomationProperties.Name="Status"/>
  </Grid>
</Window>
'@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)

$messageBox    = $window.FindName('MessageBox')
$countryCombo  = $window.FindName('CountryCombo')
$companionCheck = $window.FindName('CompanionCheck')
$basicRadio    = $window.FindName('BasicRadio')
$expertRadio   = $window.FindName('ExpertRadio')
$zoomSlider    = $window.FindName('ZoomSlider')
$projectTree   = $window.FindName('ProjectTree')
$modeTabs      = $window.FindName('ModeTabs')
$bigList       = $window.FindName('BigList')
$dataGrid      = $window.FindName('DataGrid1')
$applyButton   = $window.FindName('ApplyButton')
$statusText    = $window.FindName('StatusText')

# Populate combo
@('Canada', 'France', 'Japan') | ForEach-Object { [void]$countryCombo.Items.Add($_) }
$countryCombo.SelectedIndex = 0

# Populate virtualized list with 300 items
$bigItems = New-Object System.Collections.Generic.List[string]
1..300 | ForEach-Object { $bigItems.Add("Item $_") }
$bigList.ItemsSource = $bigItems
$bigList.SelectedIndex = 0

# Populate data grid
$rows = New-Object System.Collections.ObjectModel.ObservableCollection[object]
$rows.Add([pscustomobject]@{ Name = 'Alpha'; Value = 10 })
$rows.Add([pscustomobject]@{ Name = 'Beta';  Value = 20 })
$rows.Add([pscustomobject]@{ Name = 'Gamma'; Value = 30 })
$dataGrid.ItemsSource = $rows

# Build tree
$script:projectsNode = New-Object System.Windows.Controls.TreeViewItem
$script:projectsNode.Header = 'Projects'
$alphaNode = New-Object System.Windows.Controls.TreeViewItem; $alphaNode.Header = 'Alpha'
$betaNode  = New-Object System.Windows.Controls.TreeViewItem; $betaNode.Header  = 'Beta'
[void]$script:projectsNode.Items.Add($alphaNode)
[void]$script:projectsNode.Items.Add($betaNode)
$archiveNode = New-Object System.Windows.Controls.TreeViewItem; $archiveNode.Header = 'Archive'
[void]$projectTree.Items.Add($script:projectsNode)
[void]$projectTree.Items.Add($archiveNode)

function Write-FixtureState {
  param([string]$Status)

  $mode = if ($expertRadio.IsChecked) { 'Expert' } elseif ($basicRadio.IsChecked) { 'Basic' } else { '' }
  $tab = if ($modeTabs.SelectedItem) { [string]$modeTabs.SelectedItem.Header } else { '' }
  $treeNode = if ($projectTree.SelectedItem) { [string]$projectTree.SelectedItem.Header } else { '' }

  $state = @{
    ready            = $true
    status           = $Status
    framework        = 'wpf'
    message          = $messageBox.Text
    country          = [string]$countryCombo.SelectedItem
    companionEnabled = [bool]$companionCheck.IsChecked
    mode             = $mode
    activeTab        = $tab
    bigItem          = [string]$bigList.SelectedItem
    zoom             = [int]$zoomSlider.Value
    selectedTreeNode = $treeNode
    projectsExpanded = [bool]$script:projectsNode.IsExpanded
    appliedCount     = $script:appliedCount
    timestamp        = (Get-Date).ToString('o')
  } | ConvertTo-Json -Compress

  Set-Content -Path $StatePath -Value $state -Encoding UTF8
}

$applyButton.Add_Click({
  $script:appliedCount += 1
  $statusText.Text = 'Saved'
  Write-FixtureState 'saved'
})

$bigList.Add_SelectionChanged({
  Write-FixtureState 'selection'
})

$window.Add_ContentRendered({
  $window.Activate()
  [void]$messageBox.Focus()
  Write-FixtureState 'ready'
})

$window.Add_Closed({
  Write-FixtureState 'closed'
})

$app = New-Object System.Windows.Application
[void]$app.Run($window)
