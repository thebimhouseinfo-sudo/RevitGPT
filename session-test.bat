@echo off
setlocal
cd /d "%~dp0"

if /I "%~1"=="install" (
  call npm install
  exit /b %ERRORLEVEL%
)

if /I "%~1"=="serve" (
  node scripts\session-probe-server.mjs
  exit /b %ERRORLEVEL%
)

if /I "%~1"=="reset" (
  node scripts\session-stability-report.mjs reset
  exit /b %ERRORLEVEL%
)

if /I "%~1"=="capture" (
  node scripts\session-stability-report.mjs capture %~2
  exit /b %ERRORLEVEL%
)

if /I "%~1"=="report" (
  node scripts\session-stability-report.mjs report
  exit /b %ERRORLEVEL%
)

echo Usage:
echo   session-test.bat install
echo   session-test.bat serve
echo   session-test.bat reset
echo   session-test.bat capture t0
echo   session-test.bat capture 1h
echo   session-test.bat capture 4h
echo   session-test.bat capture 8h
echo   session-test.bat report
exit /b 0
