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
  if errorlevel 1 echo [INFO] Secure Tunnel configuration doctor reported a failure.
  echo --- Secure Tunnel live control-plane probe ---
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0openai-tunnel.ps1" -ProbeControlPlane
  if errorlevel 1 echo [INFO] Live control-plane probe failed. Check tunnel ownership, Runtime API key, Tunnels Read/Use, workspace association, or outbound network access.
  echo --- Secure Tunnel daemon diagnostics ---
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0openai-tunnel.ps1" -RuntimeDiagnostics
  echo --- End Secure Tunnel diagnostics ---
  set "FAILED=1"
) else echo [OK] Secure Tunnel READY

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\check-revit-bridge-host.ps1"
if errorlevel 2 (
  echo [FAIL] Revit MCP bridge host missing
  set "FAILED=1"
) else (
  echo [OK] Revit MCP bridge host installed
)

powershell -NoProfile -Command "$line=Get-Content '.env' -ErrorAction SilentlyContinue|Where-Object{$_ -match '^\s*REVITGPT_APPDATA_ROOT\s*=' -and -not $_.TrimStart().StartsWith('#')}|Select-Object -First 1;$cfg=if($line){(($line -split '=',2)[1].Trim()).Trim([char]39).Trim([char]34)}else{''};$root=if([string]::IsNullOrWhiteSpace($cfg)){Join-Path $env:LOCALAPPDATA 'RevitGPT'}elseif([IO.Path]::IsPathRooted($cfg)){$cfg}else{Join-Path (Get-Location) $cfg};$req=@('libraries\python','libraries\dynamo','libraries\jobs','registry\user','workspace\python-draft','workspace\dynamo-draft','workspace\job-draft','knowledge\revit','knowledge\failures','logs','state');foreach($p in $req){if(-not(Test-Path(Join-Path $root $p))){exit 1}};exit 0"
if errorlevel 1 (echo [FAIL] AppData skeleton incomplete&set "FAILED=1") else echo [OK] AppData skeleton

powershell -NoProfile -Command "$r=@(Get-Process -Name Revit -ErrorAction SilentlyContinue);if($r.Count -gt 0){try{$b=Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 2;if($b.status -eq 'ok'){exit 0}}catch{};exit 2}else{exit 0}"
if errorlevel 2 (
  echo [WARN] Revit is ON but bridge is not reachable.
  echo [INFO] If the native add-in was just installed, fully restart Revit and click "Revit MCP Bridge" ^> "Start Bridge".
  echo --- Revit bridge diagnostics ---
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\diagnose-revit-bridge.ps1"
  echo --- End Revit bridge diagnostics ---
) else echo [OK] Revit bridge condition acceptable

if "%FAILED%"=="1" exit /b 1
echo [PASS] RevitGPT doctor
exit /b 0
