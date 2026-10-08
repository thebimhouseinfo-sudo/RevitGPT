using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
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
        private bool _starting;
        private readonly Action _requestBridgeRetry;

        internal static string ProfileDirectory => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RevitGPT", "webview", "revit");

        public RevitGptPane(Action requestBridgeRetry)
        {
            _requestBridgeRetry = requestBridgeRetry ?? throw new ArgumentNullException(nameof(requestBridgeRetry));
            var grid = new Grid();
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var header = new DockPanel
            {
                Background = new SolidColorBrush(Color.FromRgb(34, 42, 54)),
                LastChildFill = true
            };
            var refresh = new Button
            {
                Content = "Refresh", MinWidth = 85,
                Margin = new Thickness(8, 5, 8, 5),
                Padding = new Thickness(8, 3, 8, 3)
            };
            DockPanel.SetDock(refresh, Dock.Right);
            header.Children.Add(refresh);
            header.Children.Add(new TextBlock
            {
                Text = "RevitGPT", Foreground = Brushes.White,
                FontWeight = FontWeights.SemiBold,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(12, 6, 0, 6)
            });
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
            Loaded += (sender, args) => { _ = InitializeBrowserAsync(); };
            refresh.Click += (sender, args) =>
            {
                // Never recreate the ChatGPT session to retry bridge startup.
                _requestBridgeRetry();
                _status.Text = "Native bridge retry requested | Preview (read only)";
            };
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
