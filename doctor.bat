@echo off
setlocal
cd /d "%~dp0"
echo === RevitGPT Doctor ===
set "FAILED=0"
set "RG_PORT=3300"
for /f "tokens=2 delims==" %%A in ('findstr /B /C:"PORT=" ".env" 2^>nul') do set "RG_PORT=%%A"
set "RG_TUNNEL_PORT=8280"
for /f "tokens=2 delims==" %%A in ('findstr /B /C:"OPENAI_TUNNEL_HEALTH_PORT=" ".env" 2^>nul') do set "RG_TUNNEL_PORT=%%A"

where node >nul 2>&1
if errorlevel 1 (echo [FAIL] Node.js missing&set "FAILED=1") else echo [OK] Node.js

if exist "runtimes\Revit-mcp\.venv\Scripts\python.exe" (echo [OK] Revit MCP Python runtime) else (echo [FAIL] Revit MCP Python runtime missing&set "FAILED=1")

powershell -NoProfile -Command "try{$h=Invoke-RestMethod 'http://127.0.0.1:%RG_PORT%/health' -TimeoutSec 2;if($h.status -eq 'ok' -and $h.name -eq 'revitgpt'){exit 0}else{exit 1}}catch{exit 1}"
if errorlevel 1 (echo [FAIL] Slim MCP offline&set "FAILED=1") else echo [OK] Slim MCP READY

powershell -NoProfile -Command "try{$r=Invoke-WebRequest 'http://127.0.0.1:%RG_TUNNEL_PORT%/readyz' -UseBasicParsing -TimeoutSec 2;if($r.StatusCode -eq 200){exit 0}else{exit 1}}catch{exit 1}"
if errorlevel 1 (
  echo [FAIL] Secure Tunnel offline
  echo --- Secure Tunnel doctor ---
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0openai-tunnel.ps1" -Doctor
  if errorlevel 1 echo [INFO] Secure Tunnel doctor reported a configuration, authentication, permission, or network failure.
  echo --- End Secure Tunnel doctor ---
  set "FAILED=1"
) else echo [OK] Secure Tunnel READY

if exist "%APPDATA%\pyRevit\Extensions\RevitMCPBridge.extension\startup.py" (
  echo [OK] pyRevit bridge installed
) else if exist "%LOCALAPPDATA%\pyRevit\Extensions\RevitMCPBridge.extension\startup.py" (
  echo [OK] pyRevit bridge installed
) else if exist "C:\ProgramData\pyRevit\Extensions\RevitMCPBridge.extension\startup.py" (
  echo [OK] pyRevit bridge installed
) else (
  echo [FAIL] pyRevit bridge startup.py not found
  set "FAILED=1"
)

powershell -NoProfile -Command "$line=Get-Content '.env' -ErrorAction SilentlyContinue|Where-Object{$_ -match '^\s*REVITGPT_APPDATA_ROOT\s*=' -and -not $_.TrimStart().StartsWith('#')}|Select-Object -First 1;$cfg=if($line){(($line -split '=',2)[1].Trim()).Trim([char]39).Trim([char]34)}else{''};$root=if([string]::IsNullOrWhiteSpace($cfg)){Join-Path $env:LOCALAPPDATA 'RevitGPT'}elseif([IO.Path]::IsPathRooted($cfg)){$cfg}else{Join-Path (Get-Location) $cfg};$req=@('libraries\python','libraries\dynamo','libraries\jobs','registry\user','workspace\python-draft','workspace\dynamo-draft','workspace\job-draft','knowledge\revit','knowledge\failures','logs','state');foreach($p in $req){if(-not(Test-Path(Join-Path $root $p))){exit 1}};exit 0"
if errorlevel 1 (echo [FAIL] AppData skeleton incomplete&set "FAILED=1") else echo [OK] AppData skeleton

powershell -NoProfile -Command "$r=@(Get-Process -Name Revit -ErrorAction SilentlyContinue);if($r.Count -gt 0){try{$b=Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 2;if($b.status -eq 'ok'){exit 0}}catch{};exit 2}else{exit 0}"
if errorlevel 2 (echo [WARN] Revit is ON but bridge is not reachable. Restart/reload pyRevit.) else echo [OK] Revit bridge condition acceptable

if "%FAILED%"=="1" exit /b 1
echo [PASS] RevitGPT doctor
exit /b 0
