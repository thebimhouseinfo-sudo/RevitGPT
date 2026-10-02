@echo off
setlocal
echo ============================================================
echo RevitGPT - Revit MCP Bridge Setup
echo ============================================================
echo.
echo This bootstrap uses the proven pyRevit bridge path first.
echo It does NOT assume a specific Revit major version.
echo.
echo 1. Ensure pyRevit is installed and attached to the Revit version you use.
echo 2. Find your pyRevit extension roots:
echo.
echo    pyrevit extensions
echo.
echo 3. Copy this folder:
echo.
echo    %~dp0bridge\pyrevit_extension\RevitMCPBridge.extension
echo.
echo    into a pyRevit Extensions root.
echo.
echo 4. Restart Revit, open a real RVT model, then start "Revit MCP Bridge"
echo    from the pyRevit ribbon.
echo.
echo 5. Verify bridge health from this runtime folder:
echo.
echo    python tests\test_real_connection.py
echo.
echo Bridge default: http://127.0.0.1:8765
echo Override with REVIT_BRIDGE_URL / REVIT_MCP_PORT when needed.
echo.
echo NOTE:
echo Standalone .NET add-in activation is intentionally deferred until
echo the actual Revit host version/runtime target is measured.
echo ============================================================
pause
