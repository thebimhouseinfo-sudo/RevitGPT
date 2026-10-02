@echo off
setlocal
cd /d "%~dp0"
echo === RevitGPT P1 Bootstrap Setup ===
if not exist ".env" (
  copy /Y ".env.example" ".env" >nul
  echo Created .env from .env.example.
  echo IMPORTANT: edit MCP_TOKEN in .env before exposing the MCP endpoint.
)
call npm install
if errorlevel 1 exit /b %ERRORLEVEL%
pushd runtimes\Revit-mcp
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv
  if errorlevel 1 exit /b %ERRORLEVEL%
)
call .venv\Scripts\activate.bat
python -m pip install -r requirements.txt
if errorlevel 1 exit /b %ERRORLEVEL%
popd
echo.
echo Setup complete.
echo Next:
echo   1. install_bridge.bat under runtimes\Revit-mcp
echo   2. start the pyRevit bridge in Revit
echo   3. run.bat
