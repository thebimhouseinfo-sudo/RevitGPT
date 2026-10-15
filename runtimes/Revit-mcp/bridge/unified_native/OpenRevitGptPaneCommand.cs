using System;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitGPT.Native
{
    // UI-only action: never leases, binds, restarts MCP or navigates WebView2.
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public sealed class OpenRevitGptPaneCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            try
            {
                if (commandData == null || commandData.Application == null)
                {
                    message = "Revit UI is not available.";
                    return Result.Failed;
                }
                var pane = commandData.Application.GetDockablePane(RevitGptPaneProvider.PaneId);
                bool shownBefore = pane.IsShown();
                NativePaneDiagnostics.Record("manual_open_attempt",
                    "already_shown=" + shownBefore);
                if (!shownBefore) pane.Show();
                bool shownAfter = pane.IsShown();
                NativePaneDiagnostics.Record("manual_open_result",
                    "shown=" + shownAfter);
                if (!shownAfter)
                {
                    message = "RevitGPT panel could not be shown. Open a project and try again.";
                    return Result.Failed;
                }
                return Result.Succeeded;
            }
            catch (Exception error)
            {
                NativePaneDiagnostics.Record("manual_open_failed", error: error);
                message = "Unable to show RevitGPT panel: " + error.GetType().Name;
                return Result.Failed;
            }
        }
    }
}
