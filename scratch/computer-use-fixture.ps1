param(
  [Parameter(Mandatory = $true)]
  [string]$StatePath
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$script:appliedCount = 0

function Write-FixtureState {
  param([string]$Status)

  $state = @{
    ready = $true
    status = $Status
    message = $messageTextBox.Text
    country = [string]$countryComboBox.SelectedItem
    companionEnabled = $companionCheckBox.Checked
    mode = if ($expertRadio.Checked) { 'Expert' } elseif ($basicRadio.Checked) { 'Basic' } else { '' }
    activeTab = $tabControl.SelectedTab.Text
    color = [string]$colorListBox.SelectedItem
    zoom = $zoomTrackBar.Value
    selectedTreeNode = if ($projectTreeView.SelectedNode) { $projectTreeView.SelectedNode.Text } else { '' }
    projectsExpanded = $projectsNode.IsExpanded
    appliedCount = $script:appliedCount
    timestamp = (Get-Date).ToString('o')
  } | ConvertTo-Json -Compress

  Set-Content -Path $StatePath -Value $state -Encoding UTF8
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'CodeBuddy Computer Use Fixture'
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(80, 80)
$form.Size = New-Object System.Drawing.Size(640, 620)
$form.TopMost = $true

$messageLabel = New-Object System.Windows.Forms.Label
$messageLabel.Text = 'Message'
$messageLabel.Location = New-Object System.Drawing.Point(24, 24)
$messageLabel.Size = New-Object System.Drawing.Size(160, 24)
$form.Controls.Add($messageLabel)

$messageTextBox = New-Object System.Windows.Forms.TextBox
$messageTextBox.Name = 'Message'
$messageTextBox.AccessibleName = 'Message'
$messageTextBox.Location = New-Object System.Drawing.Point(24, 54)
$messageTextBox.Size = New-Object System.Drawing.Size(360, 28)
$messageTextBox.Text = ''
$form.Controls.Add($messageTextBox)

$countryLabel = New-Object System.Windows.Forms.Label
$countryLabel.Text = 'Country'
$countryLabel.Location = New-Object System.Drawing.Point(24, 96)
$countryLabel.Size = New-Object System.Drawing.Size(160, 24)
$form.Controls.Add($countryLabel)

$countryComboBox = New-Object System.Windows.Forms.ComboBox
$countryComboBox.Name = 'Country'
$countryComboBox.AccessibleName = 'Country'
$countryComboBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$countryComboBox.Location = New-Object System.Drawing.Point(24, 126)
$countryComboBox.Size = New-Object System.Drawing.Size(240, 28)
[void]$countryComboBox.Items.Add('Canada')
[void]$countryComboBox.Items.Add('France')
[void]$countryComboBox.Items.Add('Japan')
$countryComboBox.SelectedItem = 'Canada'
$form.Controls.Add($countryComboBox)

$companionCheckBox = New-Object System.Windows.Forms.CheckBox
$companionCheckBox.Name = 'Enable companion mode'
$companionCheckBox.AccessibleName = 'Enable companion mode'
$companionCheckBox.Text = 'Enable companion mode'
$companionCheckBox.Location = New-Object System.Drawing.Point(24, 176)
$companionCheckBox.Size = New-Object System.Drawing.Size(260, 28)
$form.Controls.Add($companionCheckBox)

$basicRadio = New-Object System.Windows.Forms.RadioButton
$basicRadio.Name = 'Basic mode'
$basicRadio.AccessibleName = 'Basic mode'
$basicRadio.Text = 'Basic mode'
$basicRadio.Location = New-Object System.Drawing.Point(320, 126)
$basicRadio.Size = New-Object System.Drawing.Size(140, 28)
$basicRadio.Checked = $true
$form.Controls.Add($basicRadio)

$expertRadio = New-Object System.Windows.Forms.RadioButton
$expertRadio.Name = 'Expert mode'
$expertRadio.AccessibleName = 'Expert mode'
$expertRadio.Text = 'Expert mode'
$expertRadio.Location = New-Object System.Drawing.Point(320, 158)
$expertRadio.Size = New-Object System.Drawing.Size(140, 28)
$form.Controls.Add($expertRadio)

$tabControl = New-Object System.Windows.Forms.TabControl
$tabControl.Name = 'Mode tabs'
$tabControl.AccessibleName = 'Mode tabs'
$tabControl.Location = New-Object System.Drawing.Point(320, 202)
$tabControl.Size = New-Object System.Drawing.Size(260, 110)
$overviewTab = New-Object System.Windows.Forms.TabPage
$overviewTab.Text = 'Overview'
$advancedTab = New-Object System.Windows.Forms.TabPage
$advancedTab.Text = 'Advanced'
$advancedLabel = New-Object System.Windows.Forms.Label
$advancedLabel.Text = 'Advanced panel'
$advancedLabel.Location = New-Object System.Drawing.Point(12, 20)
$advancedLabel.Size = New-Object System.Drawing.Size(180, 24)
$advancedTab.Controls.Add($advancedLabel)
[void]$tabControl.TabPages.Add($overviewTab)
[void]$tabControl.TabPages.Add($advancedTab)
$form.Controls.Add($tabControl)

$colorLabel = New-Object System.Windows.Forms.Label
$colorLabel.Text = 'Color'
$colorLabel.Location = New-Object System.Drawing.Point(24, 214)
$colorLabel.Size = New-Object System.Drawing.Size(120, 24)
$form.Controls.Add($colorLabel)

$colorListBox = New-Object System.Windows.Forms.ListBox
$colorListBox.Name = 'Color'
$colorListBox.AccessibleName = 'Color'
$colorListBox.Location = New-Object System.Drawing.Point(24, 244)
$colorListBox.Size = New-Object System.Drawing.Size(180, 72)
[void]$colorListBox.Items.Add('Red')
[void]$colorListBox.Items.Add('Blue')
[void]$colorListBox.Items.Add('Green')
$colorListBox.SelectedItem = 'Red'
$form.Controls.Add($colorListBox)

$zoomLabel = New-Object System.Windows.Forms.Label
$zoomLabel.Text = 'Zoom'
$zoomLabel.Location = New-Object System.Drawing.Point(320, 320)
$zoomLabel.Size = New-Object System.Drawing.Size(120, 24)
$form.Controls.Add($zoomLabel)

$zoomTrackBar = New-Object System.Windows.Forms.TrackBar
$zoomTrackBar.Name = 'Zoom'
$zoomTrackBar.AccessibleName = 'Zoom'
$zoomTrackBar.Minimum = 0
$zoomTrackBar.Maximum = 100
$zoomTrackBar.TickFrequency = 25
$zoomTrackBar.Value = 25
$zoomTrackBar.Location = New-Object System.Drawing.Point(320, 348)
$zoomTrackBar.Size = New-Object System.Drawing.Size(240, 48)
$form.Controls.Add($zoomTrackBar)

$projectTreeView = New-Object System.Windows.Forms.TreeView
$projectTreeView.Name = 'Project tree'
$projectTreeView.AccessibleName = 'Project tree'
$projectTreeView.Location = New-Object System.Drawing.Point(320, 410)
$projectTreeView.Size = New-Object System.Drawing.Size(260, 82)
$projectsNode = New-Object System.Windows.Forms.TreeNode('Projects')
[void]$projectsNode.Nodes.Add((New-Object System.Windows.Forms.TreeNode('Alpha')))
[void]$projectsNode.Nodes.Add((New-Object System.Windows.Forms.TreeNode('Beta')))
$archiveNode = New-Object System.Windows.Forms.TreeNode('Archive')
[void]$projectTreeView.Nodes.Add($projectsNode)
[void]$projectTreeView.Nodes.Add($archiveNode)
$projectTreeView.SelectedNode = $archiveNode
$form.Controls.Add($projectTreeView)

$applyButton = New-Object System.Windows.Forms.Button
$applyButton.Name = 'Apply'
$applyButton.AccessibleName = 'Apply'
$applyButton.Text = 'Apply'
$applyButton.Location = New-Object System.Drawing.Point(24, 460)
$applyButton.Size = New-Object System.Drawing.Size(120, 34)
$form.Controls.Add($applyButton)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Name = 'Status'
$statusLabel.AccessibleName = 'Status'
$statusLabel.Text = 'Idle'
$statusLabel.Location = New-Object System.Drawing.Point(24, 512)
$statusLabel.Size = New-Object System.Drawing.Size(360, 28)
$form.Controls.Add($statusLabel)

$applyButton.Add_Click({
  $script:appliedCount += 1
  $statusLabel.Text = 'Saved'
  Write-FixtureState 'saved'
})

$form.Add_Shown({
  $form.Activate()
  $messageTextBox.Focus()
  Write-FixtureState 'ready'
})

$form.Add_FormClosed({
  Write-FixtureState 'closed'
})

[System.Windows.Forms.Application]::Run($form)
