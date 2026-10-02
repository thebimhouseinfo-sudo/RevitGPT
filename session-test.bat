@echo off
setlocal
cd /d "%~dp0"
node scripts\session-stability-report.mjs %*
exit /b %ERRORLEVEL%
