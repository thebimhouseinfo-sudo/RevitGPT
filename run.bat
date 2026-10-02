@echo off
setlocal
cd /d "%~dp0"
if not exist ".env" (
  echo Missing .env. Run setup.bat first.
  exit /b 1
)
node src\index.mjs
