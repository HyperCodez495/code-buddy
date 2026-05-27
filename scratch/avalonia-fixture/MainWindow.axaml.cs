using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using Avalonia.Controls;
using Avalonia.Interactivity;

namespace AvaloniaFixture;

public partial class MainWindow : Window
{
    private readonly string? _statePath = Environment.GetEnvironmentVariable("CB_FIXTURE_STATE");
    private int _appliedCount;

    public MainWindow()
    {
        InitializeComponent();

        CountryCombo.ItemsSource = new[] { "Canada", "France", "Japan" };
        CountryCombo.SelectedIndex = 0;

        // 300-item list — Avalonia ListBox virtualizes by default (VirtualizingStackPanel),
        // so off-screen items have no automation peer until realized/scrolled into view.
        BigList.ItemsSource = Enumerable.Range(1, 300).Select(i => $"Item {i}").ToList();
        BigList.SelectedIndex = 0;

        // Wire SelectionChanged AFTER setting the initial index so it only fires on real changes.
        ApplyButton.Click += OnApply;
        BigList.SelectionChanged += (_, _) => WriteState("selection");
        Opened += (_, _) => WriteState("ready");
        Closed += (_, _) => WriteState("closed");
    }

    private void OnApply(object? sender, RoutedEventArgs e)
    {
        _appliedCount++;
        StatusText.Text = "Saved";
        WriteState("saved");
    }

    private void WriteState(string status)
    {
        if (string.IsNullOrEmpty(_statePath)) return;
        var mode = ExpertRadio.IsChecked == true ? "Expert" : (BasicRadio.IsChecked == true ? "Basic" : "");
        var tab = (ModeTabs.SelectedItem as TabItem)?.Header?.ToString() ?? "";
        var state = new
        {
            ready = true,
            status,
            framework = "avalonia",
            message = MessageBox.Text ?? "",
            country = CountryCombo.SelectedItem?.ToString() ?? "",
            companionEnabled = CompanionCheck.IsChecked == true,
            mode,
            activeTab = tab,
            bigItem = BigList.SelectedItem?.ToString() ?? "",
            zoom = (int)ZoomSlider.Value,
            appliedCount = _appliedCount,
            timestamp = DateTime.Now.ToString("o"),
        };
        try { File.WriteAllText(_statePath, JsonSerializer.Serialize(state), new UTF8Encoding(false)); }
        catch { /* best-effort fixture state */ }
    }
}
