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
echo [3/6] Installing native Revit MCP Bridge add-in...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CD%\scripts\install-revit-bridge-addin.ps1"
if errorlevel 1 (
  echo [ERROR] Failed to install the native Revit MCP Bridge add-in.
  exit /b %ERRORLEVEL%
)
echo [OK] Native Revit MCP Bridge installed.
echo [INFO] pyRevit is optional fallback only; it is not required by RevitGPT.

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

REM Temporary icon reuse from sibling CadGPT repo.
REM Replace RevitGPT\icon.png later with the real product icon.
if not exist "%CD%\icon.png" (
  if exist "%CD%\..\Cadgpt\icon.png" (
    copy /Y "%CD%\..\Cadgpt\icon.png" "%CD%\icon.png" >nul
    echo [OK] Copied temporary tray icon from sibling Cadgpt repo.
  ) else if exist "%CD%\..\cadgpt\icon.png" (
    copy /Y "%CD%\..\cadgpt\icon.png" "%CD%\icon.png" >nul
    echo [OK] Copied temporary tray icon from sibling cadgpt repo.
  ) else (
    echo [INFO] CadGPT icon.png not found beside RevitGPT; tray will use the Windows fallback icon.
  )
)

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
echo After Revit starts, use ribbon panel "Revit MCP Bridge" > "Start Bridge". pyRevit is optional fallback only.
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
