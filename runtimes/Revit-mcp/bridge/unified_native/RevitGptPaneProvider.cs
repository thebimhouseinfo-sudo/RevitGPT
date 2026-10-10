using System;
using System.Windows;
using Autodesk.Revit.UI;

namespace RevitGPT.Native
{
    public sealed class RevitGptPaneProvider : IDockablePaneProvider, IFrameworkElementCreator
    {
        private readonly NativeModelBindingState _binding;
        private readonly NativeWriteAuthority _writeAuthority;
        public RevitGptPaneProvider(NativeModelBindingState binding, NativeWriteAuthority writeAuthority)
        {
            _binding = binding ?? throw new ArgumentNullException(nameof(binding));
            _writeAuthority = writeAuthority ?? throw new ArgumentNullException(nameof(writeAuthority));
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
                var pane = new RevitGptPane(_binding, _writeAuthority);
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
