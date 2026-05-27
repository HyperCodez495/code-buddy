param(
  [Parameter(Mandatory = $true)]
  [string]$ResultPath
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = 'CodeBuddy Dialog Fixture'
$form.StartPosition = 'CenterScreen'
$form.Width = 460
$form.Height = 180
$form.TopMost = $true
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false
$form.MinimizeBox = $false

$label = New-Object System.Windows.Forms.Label
$label.Text = 'Do you want to save changes before closing this test dialog?'
$label.AutoSize = $true
$label.Left = 24
$label.Top = 24
$label.Width = 400
$form.Controls.Add($label)

$save = New-Object System.Windows.Forms.Button
$save.Text = 'Save'
$save.Left = 160
$save.Top = 82
$save.Width = 80
$save.Add_Click({
  @{ decision = 'save'; clickedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -Path $ResultPath -Encoding UTF8
  $form.Close()
})
$form.Controls.Add($save)

$delete = New-Object System.Windows.Forms.Button
$delete.Text = 'Delete'
$delete.Left = 250
$delete.Top = 82
$delete.Width = 80
$delete.Add_Click({
  @{ decision = 'delete'; clickedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -Path $ResultPath -Encoding UTF8
  $form.Close()
})
$form.Controls.Add($delete)

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = 'Cancel'
$cancel.Left = 340
$cancel.Top = 82
$cancel.Width = 80
$cancel.Add_Click({
  @{ decision = 'cancel'; clickedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -Path $ResultPath -Encoding UTF8
  $form.Close()
})
$form.Controls.Add($cancel)

$form.AcceptButton = $save
$form.CancelButton = $cancel
[void]$form.ShowDialog()
