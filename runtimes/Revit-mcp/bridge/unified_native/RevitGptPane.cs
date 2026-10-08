using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace RevitGPT.Native
{
    // Infrastructure shell only: the browser never creates or owns an RVT model lease.
    public sealed class RevitGptPane : Page
    {
        private const string ChatUrl = "https://chatgpt.com/";
        private readonly WebView2 _browser;
        private readonly TextBlock _status;
        private readonly TextBlock _bindingStatus;
        private readonly Button _bind;
        private readonly Button _pair;
        private readonly TextBox _pairCode;
        private readonly NativePanelSession _panelSession;
        private string _pendingBindTarget;
        private long _pendingBindRevision;
        private DateTime _pendingSinceUtc;
        private readonly DispatcherTimer _bindingTimer;
        private readonly NativeModelBindingState _binding;
        private bool _starting;
        private readonly Action _requestBridgeRetry;

        internal static string ProfileDirectory => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RevitGPT", "webview", "revit");

        public RevitGptPane(Action requestBridgeRetry, NativeModelBindingState binding,
            NativePanelSession panelSession)
        {
            _requestBridgeRetry = requestBridgeRetry ?? throw new ArgumentNullException(nameof(requestBridgeRetry));
            _binding = binding ?? throw new ArgumentNullException(nameof(binding));
            _panelSession = panelSession ?? throw new ArgumentNullException(nameof(panelSession));
            var grid = new Grid();
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var header = new StackPanel
            {
                Background = new SolidColorBrush(Color.FromRgb(34, 42, 54))
            };
            var headerTop = new DockPanel { LastChildFill = true };
            var refresh = new Button
            {
                Content = "Refresh", MinWidth = 85,
                Margin = new Thickness(8, 5, 8, 5),
                Padding = new Thickness(8, 3, 8, 3)
            };
            DockPanel.SetDock(refresh, Dock.Right);
            headerTop.Children.Add(refresh);
            headerTop.Children.Add(new TextBlock
            {
                Text = "RevitGPT", Foreground = Brushes.White,
                FontWeight = FontWeights.SemiBold,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(12, 6, 0, 6)
            });
            header.Children.Add(headerTop);

            var bindingRow = new DockPanel { LastChildFill = true };
            _bind = new Button
            {
                Content = "Bind Current (preview)",
                Margin = new Thickness(8, 0, 8, 5),
                Padding = new Thickness(5, 2, 5, 2),
                IsEnabled = false
            };
            DockPanel.SetDock(_bind, Dock.Right);
            bindingRow.Children.Add(_bind);
            _bindingStatus = new TextBlock
            {
                Text = "Not bound", Foreground = Brushes.LightGray,
                TextWrapping = TextWrapping.Wrap,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(12, 0, 3, 6), FontSize = 11
            };
            bindingRow.Children.Add(_bindingStatus);
            header.Children.Add(bindingRow);

            var pairingRow = new DockPanel { LastChildFill = true };
            _pair = new Button {
                Content = "Pair", Margin = new Thickness(7, 0, 8, 6),
                Padding = new Thickness(6, 2, 6, 2)
            };
            DockPanel.SetDock(_pair, Dock.Right);
            pairingRow.Children.Add(_pair);
            _pairCode = new TextBox {
                MinWidth = 125, MaxWidth = 220,
                Margin = new Thickness(12, 0, 0, 6),
                ToolTip = "Call @rg revitgpt_pair_panel, then enter the 32-character code here"
            };
            pairingRow.Children.Add(_pairCode);
            header.Children.Add(pairingRow);

            _bindingTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(800) };
            _bindingTimer.Tick += (sender, args) => RefreshBindingIndicator();
            Grid.SetRow(header, 0);
            grid.Children.Add(header);

            _browser = new WebView2();
            Grid.SetRow(_browser, 1);
            grid.Children.Add(_browser);

            _status = new TextBlock
            {
                Text = "ChatGPT starting | Native bridge preview (read only)",
                Margin = new Thickness(10, 5, 10, 5),
                Foreground = Brushes.DimGray,
                TextWrapping = TextWrapping.Wrap
            };
            Grid.SetRow(_status, 2);
            grid.Children.Add(_status);

            Content = grid;
            Loaded += (sender, args) =>
            {
                RefreshBindingIndicator();
                _bindingTimer.Start();
                _ = InitializeBrowserAsync();
            };
            Unloaded += (sender, args) => _bindingTimer.Stop();
            _pair.Click += async (sender, args) => await PairPanelAsync();
            _bind.Click += (sender, args) =>
            {
                var previous = _binding.Current;
                if (_binding.RequestBindCurrent())
                {
                    _pendingBindTarget = previous.ActiveId;
                    _pendingBindRevision = previous.Revision;
                    _pendingSinceUtc = DateTime.UtcNow;
                    _status.Text = _panelSession.IsPaired
                        ? "Binding requested | Waiting for Revit to confirm before leasing"
                        : "Binding requested | Pair panel for automatic session lease";
                }
                else _status.Text = "No active model to bind";
            };
            refresh.Click += (sender, args) =>
            {
                // Never recreate the ChatGPT session to retry bridge startup.
                _requestBridgeRetry();
                _status.Text = "Native bridge retry requested | Preview (read only)";
            };
        }

        private async Task PairPanelAsync()
        {
            _pair.IsEnabled = false;
            try
            {
                string token = await NativePanelPairingClient.PairAsync(_pairCode.Text);
                _panelSession.SetToken(token);
                _pairCode.Clear(); // never retain challenge in UI
                _status.Text = "Panel paired to one ChatGPT MCP session (read only)";
            }
            catch (Exception error)
            {
                _status.Text = "Pairing failed: " + error.GetType().Name +
                    " | Request a new code using @rg";
            }
            finally { _pair.IsEnabled = true; }
        }

        private async Task LeasePanelAsync(NativeModelBindingState.Snapshot snap)
        {
            try
            {
                await NativePanelPairingClient.LeaseAsync(_panelSession.Token, snap);
                _status.Text = "Read-only MCP lease confirmed for " + snap.BoundTitle;
            }
            catch (Exception error)
            {
                _panelSession.Clear(); // expired/revoked token cannot be trusted
                _status.Text = "Lease failed: " + error.GetType().Name +
                    " | Pair again, or explicitly lease with @rg";
            }
        }

        private void RefreshBindingIndicator()
        {
            // This never calls Revit API; the host Idling callback supplies snapshots.
            var snap = _binding.Current;
            _bind.Content = _panelSession.IsPaired
                ? "Lease + Bind Current" : "Bind Current (preview)";
            _bind.IsEnabled = !String.IsNullOrEmpty(snap.ActiveId) &&
                _pendingBindTarget == null &&
                (snap.Status != "BOUND_CURRENT" || _panelSession.IsPaired);
            if (_pendingBindTarget != null)
            {
                if (snap.Revision > _pendingBindRevision)
                {
                    string target = _pendingBindTarget;
                    _pendingBindTarget = null;
                    if (snap.Status == "BOUND_CURRENT" && snap.BoundId == target)
                    {
                        if (_panelSession.IsPaired) _ = LeasePanelAsync(snap);
                        else _status.Text = "Bound: " + snap.BoundTitle +
                            " | Use @rg revitgpt_lease_bound_model until paired";
                    }
                    else _status.Text = "Binding changed; no lease granted";
                }
                else if (snap.ActiveId != _pendingBindTarget ||
                         DateTime.UtcNow - _pendingSinceUtc > TimeSpan.FromSeconds(15))
                {
                    _pendingBindTarget = null;
                    _status.Text = "Binding cancelled or delayed; no lease granted";
                }
            }
            switch (snap.Status)
            {
                case "BOUND_CURRENT":
                    _bindingStatus.Text = "Bound: " + snap.BoundTitle;
                    _bindingStatus.Foreground = Brushes.LightGreen;
                    break;
                case "BOUND_OTHER_ACTIVE":
                    _bindingStatus.Text = "Different model: " + snap.ActiveTitle +
                        " | Bound: " + snap.BoundTitle;
                    _bindingStatus.Foreground = Brushes.Orange;
                    break;
                case "BOUND_CLOSED":
                    _bindingStatus.Text = "Bound model closed: " + snap.BoundTitle;
                    _bindingStatus.Foreground = Brushes.Gold;
                    break;
                default:
                    _bindingStatus.Text = "Not bound" +
                        (String.IsNullOrEmpty(snap.ActiveTitle) ? "" : " | Active: " + snap.ActiveTitle);
                    _bindingStatus.Foreground = Brushes.LightGray;
                    break;
            }
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
                _browser.CoreWebView2.Navigate(ChatUrl);
                _status.Text = "ChatGPT | Native bridge preview (read only)";
            }
            catch (Exception error)
            {
                _status.Text = "WebView2 unavailable (" + error.GetType().Name
                    + "). Use browser mode until repaired.";
            }
            finally { _starting = false; }
        }
    }
}
