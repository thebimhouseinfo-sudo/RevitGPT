using System;
using System.Windows;
using Autodesk.Revit.UI;

namespace RevitGPT.Native
{
    // A recreated pane must have a newly created browser, never a cached WebView2.
    public sealed class RevitGptPaneProvider : IDockablePaneProvider, IFrameworkElementCreator
    {
        private readonly Action _requestBridgeRetry;
        private readonly NativeModelBindingState _binding;

        public RevitGptPaneProvider(Action requestBridgeRetry, NativeModelBindingState binding)
        {
            _requestBridgeRetry = requestBridgeRetry ?? throw new ArgumentNullException(nameof(requestBridgeRetry));
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

        public FrameworkElement CreateFrameworkElement() => new RevitGptPane(_requestBridgeRetry, _binding);
    }
}
