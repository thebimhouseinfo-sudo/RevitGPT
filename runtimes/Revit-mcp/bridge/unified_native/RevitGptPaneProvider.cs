using System;
using System.Windows;
using Autodesk.Revit.UI;

namespace RevitGPT.Native
{
    public sealed class RevitGptPaneProvider : IDockablePaneProvider, IFrameworkElementCreator
    {
        private readonly NativeModelBindingState _binding;
        // Autodesk may re-create the WPF host for a document/layout change.
        // Browser controls cannot be cached safely across those host views.
        // Keep only a privacy-trimmed conversation route, never the WebView2,
        // so any recreated pane resumes the same chat instead of ChatGPT Home.
        private string _lastConversationUrl;

        private void RememberConversationUrl(string candidate)
        {
            Uri uri;
            if (!Uri.TryCreate(candidate, UriKind.Absolute, out uri) ||
                uri.Scheme != Uri.UriSchemeHttps ||
                !String.Equals(uri.Host, "chatgpt.com", StringComparison.OrdinalIgnoreCase))
                return;
            string path = uri.AbsolutePath;
            int marker = path.IndexOf("/c/", StringComparison.OrdinalIgnoreCase);
            if (marker < 0 || path.Length <= marker + 3) return;
            // Retain only the in-memory path, not query strings, fragments or tokens.
            _lastConversationUrl = uri.GetLeftPart(UriPartial.Path);
        }

        public RevitGptPaneProvider(NativeModelBindingState binding)
        {
            _binding = binding ?? throw new ArgumentNullException(nameof(binding));
        }

        public static readonly DockablePaneId PaneId =
            new DockablePaneId(new Guid("4B6C8E17-53D2-4D9A-9E77-C0A925B7D812"));

        public void SetupDockablePane(DockablePaneProviderData data)
        {
            if (data == null) throw new ArgumentNullException(nameof(data));
            data.FrameworkElement = null;
            data.FrameworkElementCreator = this;
            data.InitialState = new DockablePaneState { DockPosition = DockPosition.Right };
            data.VisibleByDefault = true;
        }

        public FrameworkElement CreateFrameworkElement()
        {
            NativePaneDiagnostics.Record("element_create");
            try
            {
                var pane = new RevitGptPane(_binding,
                    () => _lastConversationUrl, RememberConversationUrl);
                NativePaneDiagnostics.Record("element_created");
                return pane;
            }
            catch (Exception error)
            {
                NativePaneDiagnostics.Record("element_create_failed", error: error);
                throw;
            }
        }
    }
}
