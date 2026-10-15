@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo ============================================================
echo RevitGPT Setup
echo ============================================================
echo.
REM setup.bat is for runtime dependencies and logon startup. Official Native
REM RevitGPT is installed independently with explicit human host approval.
if not exist "%APPDATA%\Autodesk\Revit\Addins\2024\RevitGPT.addin" if not exist "%ProgramData%\Autodesk\Revit\Addins\2024\RevitGPT.addin" (
  echo [BLOCKED] Official RevitGPT Native 2024 add-in registration not found.
  echo [INFO] Install the official Native host using scripts\manage-native-revitgpt-install.ps1 with explicit approval.
  echo [INFO] No legacy Native installer will be executed.
  exit /b 3
)
echo [INFO] Existing RevitGPT Native add-in detected; will not reinstall it.

REM ------------------------------------------------------------
REM 1. Local configuration
REM ------------------------------------------------------------
if not exist ".env" (
  copy /Y ".env.example" ".env" >nul
  echo [OK] Created .env from .env.example
) else (
  echo [OK] .env already exists
)

REM Source checkout runs with development-only Revit MCP improvement tools enabled.
powershell.exe -NoProfile -Command "$p='.env';$lines=@(Get-Content $p);$found=$false;$out=foreach($line in $lines){if($line -match '^\s*REVITGPT_DEV_MODE\s*='){$found=$true;'REVITGPT_DEV_MODE=1'}else{$line}};if(-not $found){$out+='REVITGPT_DEV_MODE=1'};Set-Content $p $out -Encoding UTF8"
if errorlevel 1 exit /b %ERRORLEVEL%
echo [OK] Enabled source-development profile ^(revit-mcp-dev^).

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
REM 4. Install native Revit bridge (primary path)
REM ------------------------------------------------------------
echo.
echo [3/6] Reusing existing official Native RevitGPT add-in...
echo [INFO] Native host lifecycle is independent of Tray/Windows logon setup.
echo [OK] Existing RevitGPT Native registration left unchanged.

REM ------------------------------------------------------------
REM 5. Configure OpenAI Secure MCP Tunnel
REM ------------------------------------------------------------
echo.
echo [4/6] Configuring RevitGPT Secure MCP Tunnel...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CD%\openai-tunnel.ps1" -Init
if errorlevel 1 exit /b %ERRORLEVEL%

REM ------------------------------------------------------------
REM 6. Install and start Windows tray host
REM ------------------------------------------------------------
echo.
echo [5/6] Installing RevitGPT Windows tray auto-start...

REM Use the tracked RevitGPT-owned icon. Never copy a sibling CadGPT icon.
if not exist "%CD%\assets\revitgpt-tray.png" (
  echo [ERROR] Missing assets\revitgpt-tray.png from RevitGPT checkout.
  exit /b 1
)
echo [OK] RevitGPT tray icon is bundled with this repository.

echo.
call "%CD%\run.bat" install
if errorlevel 1 exit /b %ERRORLEVEL%

echo.
echo [6/6] Running RevitGPT doctor...
call "%CD%\doctor.bat"
if errorlevel 1 exit /b %ERRORLEVEL%

REM ------------------------------------------------------------
REM 7. Final instructions
REM ------------------------------------------------------------
echo.
echo Setup complete.
echo.
echo Next:
echo   1. Restart Revit so Autodesk Revit loads the native RevitMCPBridge.addin.
echo   2. Open an RVT model.
echo   3. Invoke @rg / RevitGPT from ChatGPT.
echo.
echo RevitGPT tray + slim MCP + Secure Tunnel are already docked and running.
echo Native RevitGPT add-in loads when Revit starts. No manual legacy bridge command.
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
