@echo off
setlocal
cd /d "%~dp0"
set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=start"

if /I "%ACTION%"=="install" goto :install
if /I "%ACTION%"=="start" goto :start
if /I "%ACTION%"=="stop" goto :stop
if /I "%ACTION%"=="restart" goto :restart
if /I "%ACTION%"=="status" goto :status
if /I "%ACTION%"=="doctor" goto :doctor
if /I "%ACTION%"=="uninstall" goto :uninstall
goto :usage

:preflight
if not exist ".env" exit /b 1
if not exist "revitgpt-tray.ps1" exit /b 1
if not exist "revitgpt-tray.vbs" exit /b 1
if not exist "src\index.mjs" exit /b 1
exit /b 0

:install
call :preflight
if errorlevel 1 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0revitgpt-tray.ps1" -InstallStartup
if errorlevel 1 exit /b 1
goto :start

:start
call :preflight
if errorlevel 1 exit /b 1
wscript "%~dp0revitgpt-tray.vbs"
powershell -NoProfile -Command "$ok=$false; foreach($i in 1..120){ try{$h=Invoke-RestMethod 'http://127.0.0.1:3300/health' -TimeoutSec 1; $t=Invoke-WebRequest 'http://127.0.0.1:8280/readyz' -UseBasicParsing -TimeoutSec 1; if($h.status -eq 'ok' -and $h.name -eq 'revitgpt' -and $t.StatusCode -eq 200){$ok=$true;break}}catch{}; Start-Sleep -Milliseconds 500}; if(-not $ok){exit 1}"
if errorlevel 1 exit /b 1
goto :status

:stop
call :preflight
if errorlevel 1 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0revitgpt-tray.ps1" -StopInstalled
exit /b %ERRORLEVEL%

:restart
call :stop
wscript "%~dp0revitgpt-tray.vbs"
powershell -NoProfile -Command "$ok=$false; foreach($i in 1..120){ try{$h=Invoke-RestMethod 'http://127.0.0.1:3300/health' -TimeoutSec 1; $t=Invoke-WebRequest 'http://127.0.0.1:8280/readyz' -UseBasicParsing -TimeoutSec 1; if($h.status -eq 'ok' -and $h.name -eq 'revitgpt' -and $t.StatusCode -eq 200){$ok=$true;break}}catch{}; Start-Sleep -Milliseconds 500}; if(-not $ok){exit 1}"
if errorlevel 1 exit /b 1
goto :status

:status
call :preflight
if errorlevel 1 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0revitgpt-tray.ps1" -StatusOnly
exit /b %ERRORLEVEL%

:doctor
call "%~dp0doctor.bat"
exit /b %ERRORLEVEL%

:uninstall
call :stop
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0revitgpt-tray.ps1" -RemoveStartup
exit /b %ERRORLEVEL%

:usage
echo RevitGPT runtime control
echo.
echo   run.bat start
echo   run.bat stop
echo   run.bat restart
echo   run.bat status
echo   run.bat doctor
echo   run.bat install
echo   run.bat uninstall
exit /b 2
