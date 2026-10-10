using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace RevitGPT.Native
{
    // WPF never calls the Revit API or creates an MCP permission.
    public sealed class RevitGptPane : Page
    {
        private const string ChatUrl = "https://chatgpt.com/";
        private readonly WebView2 _browser;
        private readonly Border _header;
        private readonly TextBlock _modelName;
        private readonly Button _bind;
        private readonly ToggleButton _theme;
        private readonly TextBlock _status;
        private readonly DispatcherTimer _bindingTimer;
        private readonly NativeModelBindingState _binding;
        private readonly NativeWriteAuthority _writeAuthority;
        private readonly Button _approveWrite;
        private bool _starting;

        internal static string ProfileDirectory => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RevitGPT", "webview", "revit");

        public RevitGptPane(NativeModelBindingState binding, NativeWriteAuthority writeAuthority)
        {
            _binding = binding ?? throw new ArgumentNullException(nameof(binding));
            _writeAuthority = writeAuthority ?? throw new ArgumentNullException(nameof(writeAuthority));
            var grid = new Grid();
            // Two rows only: no reserved footer strip under the WebView.
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            grid.Background = Brushes.White;
            Background = Brushes.White;

            _header = new Border { Padding = new Thickness(8, 5, 8, 5) };
            var columns = new Grid();
            columns.ColumnDefinitions.Add(new ColumnDefinition {
                Width = new GridLength(1, GridUnitType.Star)
            });
            columns.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            columns.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            columns.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            _modelName = new TextBlock {
                Text = "No model bound",
                FontWeight = FontWeights.SemiBold,
                VerticalAlignment = VerticalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
                Margin = new Thickness(4, 0, 6, 0)
            };
            Grid.SetColumn(_modelName, 0);
            columns.Children.Add(_modelName);

            _bind = new Button {
                Content = "Bind Current", IsEnabled = false,
                Padding = new Thickness(7, 3, 7, 3),
                Margin = new Thickness(2, 0, 4, 0)
            };
            Grid.SetColumn(_bind, 1);
            columns.Children.Add(_bind);

            _theme = new ToggleButton {
                Content = "Light", IsChecked = false,
                ToolTip = "Toggle light/dark",
                Padding = new Thickness(7, 3, 7, 3),
                Margin = new Thickness(2, 0, 2, 0)
            };
            Grid.SetColumn(_theme, 2);
            columns.Children.Add(_theme);

            _approveWrite = new Button {
                Content = "Approve Write", IsEnabled = false,
                Visibility = Visibility.Collapsed,
                ToolTip = "Approve one exact pending write on an explicitly allowed local test RVT",
                Padding = new Thickness(7, 3, 7, 3),
                Margin = new Thickness(2, 0, 2, 0)
            };
            Grid.SetColumn(_approveWrite, 3);
            columns.Children.Add(_approveWrite);

            _header.Child = columns;
            Grid.SetRow(_header, 0);
            grid.Children.Add(_header);

            _browser = new WebView2 {
                ZoomFactor = 0.8,
                DefaultBackgroundColor = System.Drawing.Color.White
            };
            Grid.SetRow(_browser, 1);
            grid.Children.Add(_browser);

            _status = new TextBlock {
                Margin = new Thickness(8, 3, 8, 3),
                Foreground = Brushes.DimGray,
                TextWrapping = TextWrapping.Wrap,
                Visibility = Visibility.Collapsed,
                VerticalAlignment = VerticalAlignment.Top,
                Background = Brushes.White
            };
            // Only show errors as an overlay; collapsed status occupies zero height.
            Grid.SetRow(_status, 1);
            grid.Children.Add(_status);

            _bindingTimer = new DispatcherTimer {
                Interval = TimeSpan.FromMilliseconds(800)
            };
            _bindingTimer.Tick += (sender, args) => RefreshBindingIndicator();
            Content = grid;
            Loaded += (sender, args) => {
                NativePaneDiagnostics.Record("wpf_loaded");
                RefreshBindingIndicator();
                _bindingTimer.Start();
                _ = InitializeBrowserAsync();
            };
            Unloaded += (sender, args) => _bindingTimer.Stop();
            _bind.Click += (sender, args) => {
                ShowStatus(_binding.RequestBindCurrent()
                    ? "Switching binding to active project"
                    : "No active project to bind");
            };
            _approveWrite.Click += (sender, args) => {
                bool approved = _writeAuthority.ApproveFromNativePane(_binding.Current);
                ShowStatus(approved
                    ? "One exact pending write approved; resubmit the same operation."
                    : "Write request expired or binding changed; no write approved.");
                RefreshBindingIndicator();
            };
            _theme.Checked += (sender, args) => ApplyTheme();
            _theme.Unchecked += (sender, args) => ApplyTheme();
            ApplyTheme();
        }

        private void ShowStatus(string message)
        {
            _status.Text = message ?? "";
            _status.Visibility = String.IsNullOrEmpty(message)
                ? Visibility.Collapsed : Visibility.Visible;
        }

        private void ApplyTheme()
        {
            bool dark = _theme.IsChecked == true;
            _theme.Content = dark ? "Dark" : "Light";
            var pageBrush = dark ? (Brush)new SolidColorBrush(Color.FromRgb(24, 26, 30)) : Brushes.White;
            Background = pageBrush;
            _status.Background = pageBrush;
            _status.Foreground = dark ? Brushes.White : Brushes.DimGray;
            _browser.DefaultBackgroundColor = dark
                ? System.Drawing.Color.FromArgb(24, 26, 30)
                : System.Drawing.Color.White;
            RefreshBindingIndicator();
            // Respect WebView2's browser preference without injecting scripts.
            // ChatGPT account-specific appearance may override this preference.
            if (_browser?.CoreWebView2 != null)
                _browser.CoreWebView2.Profile.PreferredColorScheme = dark
                    ? CoreWebView2PreferredColorScheme.Dark
                    : CoreWebView2PreferredColorScheme.Light;
        }

        private void RefreshBindingIndicator()
        {
            var snap = _binding.Current; // UI reads snapshots only
            bool dark = _theme.IsChecked == true;
            string pendingWrite = _writeAuthority.PendingDescription;
            _approveWrite.Visibility = pendingWrite == null ?
                Visibility.Collapsed : Visibility.Visible;
            _approveWrite.IsEnabled = pendingWrite != null && snap.Status == "BOUND_CURRENT";
            _approveWrite.ToolTip = pendingWrite == null ? null :
                "Approve EXACT one-time intent: " + pendingWrite;
            _bind.IsEnabled = !String.IsNullOrEmpty(snap.ActiveId) &&
                snap.Status != "BOUND_CURRENT";
            _modelName.Text = String.IsNullOrEmpty(snap.BoundTitle)
                ? "No model bound"
                : snap.Status == "BOUND_CLOSED" ? "Closed: " + snap.BoundTitle
                    : snap.Status == "BOUND_UNVERIFIED" ? "Checking: " + snap.BoundTitle
                    : snap.BoundTitle;
            _modelName.ToolTip = snap.Status == "BOUND_OTHER_ACTIVE"
                ? "Bound: " + snap.BoundTitle + " | Active: " + snap.ActiveTitle
                : snap.Status == "BOUND_CLOSED"
                    ? "Bound model is closed. Use Bind Current to choose another project."
                    : snap.Status == "BOUND_UNVERIFIED"
                    ? "Revit document list temporarily unavailable. Reads are blocked until refreshed."
                    : _modelName.Text;
            Color background, foreground;
            switch (snap.Status)
            {
                case "BOUND_UNVERIFIED":
                case "BOUND_OTHER_ACTIVE":
                    background = Color.FromRgb(180, 83, 9);
                    foreground = Colors.White;
                    break;
                case "BOUND_CLOSED":
                    background = Color.FromRgb(253, 224, 71);
                    foreground = Color.FromRgb(40, 35, 16);
                    break;
                default:
                    background = dark ? Color.FromRgb(34, 42, 54)
                        : Color.FromRgb(232, 237, 245);
                    foreground = dark ? Colors.White : Color.FromRgb(28, 40, 59);
                    break;
            }
            _header.Background = new SolidColorBrush(background);
            _modelName.Foreground = new SolidColorBrush(foreground);
        }

        private async Task InitializeBrowserAsync()
        {
            if (_starting || _browser.CoreWebView2 != null) return;
            _starting = true;
            try
            {
                Directory.CreateDirectory(ProfileDirectory);
                var environment = await CoreWebView2Environment.CreateAsync(
                    browserExecutableFolder: null, userDataFolder: ProfileDirectory);
                await _browser.EnsureCoreWebView2Async(environment);
                _browser.ZoomFactor = 0.8;
                ApplyTheme();
                _browser.CoreWebView2.Navigate(ChatUrl);
                NativePaneDiagnostics.Record("webview_ready");
                ShowStatus(null);
            }
            catch (Exception error)
            {
                NativePaneDiagnostics.Record("webview_failed", error: error);
                ShowStatus("WebView2 unavailable (" + error.GetType().Name +
                    "). Use browser until repaired.");
            }
            finally { _starting = false; }
        }
    }
}
