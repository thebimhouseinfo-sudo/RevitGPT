@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo ============================================================
echo RevitGPT Setup
echo ============================================================
echo.

REM ------------------------------------------------------------
REM 1. Local configuration
REM ------------------------------------------------------------
if not exist ".env" (
  copy /Y ".env.example" ".env" >nul
  echo [OK] Created .env from .env.example
) else (
  echo [OK] .env already exists
)

REM ------------------------------------------------------------
REM 2. Node runtime
REM ------------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo Install Node.js LTS, then run setup.bat again.
  exit /b 1
)

echo.
echo [1/4] Installing RevitGPT Node dependencies...
call npm install
if errorlevel 1 exit /b %ERRORLEVEL%

REM ------------------------------------------------------------
REM 3. Python Revit MCP runtime
REM ------------------------------------------------------------
echo.
echo [2/4] Installing Revit MCP Python runtime...
pushd "runtimes\Revit-mcp"

if not exist ".venv\Scripts\python.exe" (
  where py >nul 2>&1
  if not errorlevel 1 (
    py -3 -m venv .venv
  ) else (
    where python >nul 2>&1
    if errorlevel 1 (
      echo [ERROR] Python 3 is not installed or not in PATH.
      popd
      exit /b 1
    )
    python -m venv .venv
  )
  if errorlevel 1 (
    popd
    exit /b %ERRORLEVEL%
  )
)

call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip
if errorlevel 1 (
  popd
  exit /b %ERRORLEVEL%
)

python -m pip install -r requirements.txt
if errorlevel 1 (
  popd
  exit /b %ERRORLEVEL%
)

popd

REM ------------------------------------------------------------
REM 4. Install pyRevit bridge
REM ------------------------------------------------------------
echo.
echo [3/4] Installing Revit MCP bridge into pyRevit Extensions...

set "BRIDGE_SRC=%CD%\runtimes\Revit-mcp\bridge\pyrevit_extension\RevitMCPBridge.extension"
set "PYREVIT_ROOT="

REM Prefer existing user-local pyRevit Extensions roots.
if exist "%APPDATA%\pyRevit\Extensions" (
  set "PYREVIT_ROOT=%APPDATA%\pyRevit\Extensions"
)

if not defined PYREVIT_ROOT if exist "%LOCALAPPDATA%\pyRevit\Extensions" (
  set "PYREVIT_ROOT=%LOCALAPPDATA%\pyRevit\Extensions"
)

if not defined PYREVIT_ROOT if exist "C:\ProgramData\pyRevit\Extensions" (
  set "PYREVIT_ROOT=C:\ProgramData\pyRevit\Extensions"
)

REM If no standard root exists, create the user-local root.
if not defined PYREVIT_ROOT (
  set "PYREVIT_ROOT=%APPDATA%\pyRevit\Extensions"
  mkdir "!PYREVIT_ROOT!" >nul 2>&1
)

set "BRIDGE_DST=!PYREVIT_ROOT!\RevitMCPBridge.extension"

if exist "!BRIDGE_DST!" (
  rmdir /S /Q "!BRIDGE_DST!"
)

xcopy /E /I /Y "%BRIDGE_SRC%" "!BRIDGE_DST!" >nul
if errorlevel 1 (
  echo [ERROR] Failed to install Revit MCP Bridge to:
  echo         !BRIDGE_DST!
  exit /b %ERRORLEVEL%
)

echo [OK] Revit MCP Bridge installed to:
echo      !BRIDGE_DST!

REM ------------------------------------------------------------
REM 5. Install and start Windows tray host
REM ------------------------------------------------------------
echo.
echo [4/5] Installing RevitGPT Windows tray auto-start...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CD%\revitgpt-tray.ps1" -InstallStartup
if errorlevel 1 exit /b %ERRORLEVEL%

echo [OK] RevitGPT tray registered for Windows sign-in.

echo.
echo [5/5] Starting RevitGPT tray now...
wscript.exe "%CD%\revitgpt-tray.vbs"

REM ------------------------------------------------------------
REM 6. Final instructions
REM ------------------------------------------------------------
echo.
echo Setup complete.
echo.
echo Next:
echo   1. Edit .env and set a private MCP_TOKEN.
echo   2. Restart Revit so pyRevit reloads the installed bridge.
echo   3. Open an RVT model.
echo   4. In Revit, start "Revit MCP Bridge" from pyRevit.
echo.
echo RevitGPT tray/control plane is already docked and running.
echo You do NOT need to run run.bat for normal use.
echo.
echo RevitGPT runtime:
echo   http://127.0.0.1:3300
echo.
echo Revit bridge:
echo   http://127.0.0.1:8765
echo.
echo IMPORTANT:
echo   Revit being ON does NOT auto-start full Revit MCP.
echo   Full Revit MCP starts only when ChatGPT invokes @rg/RevitGPT admission.
echo   When all Revit processes are OFF, full Revit MCP shuts down.
echo.
echo ============================================================
exit /b 0
