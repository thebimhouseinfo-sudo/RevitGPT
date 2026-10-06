$ErrorActionPreference = "Continue"

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $repoRoot "runtimes\Revit-mcp\bridge\pyrevit_extension\RevitMCPBridge.extension"
$sourceStartup = Join-Path $sourceRoot "startup.py"
$sourceBridge = Join-Path $sourceRoot "RevitMCPBridge.bundle\Contents\revit_mcp_bridge.py"

function Get-EnvValue([string]$Name) {
    $envPath = Join-Path $repoRoot ".env"
    if (-not (Test-Path $envPath)) { return $null }
    $line = Get-Content $envPath | Where-Object {
        $_ -match "^\s*$Name\s*=" -and -not $_.TrimStart().StartsWith("#")
    } | Select-Object -First 1
    if (-not $line) { return $null }
    return (($line -split "=", 2)[1].Trim()).Trim("'").Trim('"')
}

function Get-Sha([string]$Path) {
    if (-not (Test-Path $Path)) { return $null }
    return (Get-FileHash -Algorithm SHA256 $Path).Hash
}

$revit = @(Get-Process -Name Revit -ErrorAction SilentlyContinue)
Write-Host ("[INFO] Revit process count: " + $revit.Count)
if ($revit.Count -gt 0) {
    Write-Host ("[INFO] Revit PIDs: " + (($revit | ForEach-Object { $_.Id }) -join ","))
}

try {
    $conn = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 8765 -State Listen -ErrorAction Stop | Select-Object -First 1
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($conn.OwningProcess)" -ErrorAction SilentlyContinue
    Write-Host ("[INFO] Port 8765 owner PID={0} name={1}" -f $conn.OwningProcess, $(if($proc){$proc.Name}else{"unknown"}))
} catch {
    Write-Host "[INFO] Port 8765 has no LISTENING owner."
}

$roots = @(
    (Join-Path $env:APPDATA "pyRevit\Extensions"),
    (Join-Path $env:LOCALAPPDATA "pyRevit\Extensions"),
    "C:\ProgramData\pyRevit\Extensions"
) | Select-Object -Unique

$sourceStartupSha = Get-Sha $sourceStartup
$sourceBridgeSha = Get-Sha $sourceBridge
$installedCount = 0
foreach ($root in $roots) {
    $installed = Join-Path $root "RevitMCPBridge.extension"
    if (-not (Test-Path $installed)) { continue }
    $installedCount++
    $startup = Join-Path $installed "startup.py"
    $bridge = Join-Path $installed "RevitMCPBridge.bundle\Contents\revit_mcp_bridge.py"
    $startupMatch = ((Get-Sha $startup) -eq $sourceStartupSha)
    $bridgeMatch = ((Get-Sha $bridge) -eq $sourceBridgeSha)
    Write-Host ("[INFO] Installed bridge: {0}" -f $installed)
    Write-Host ("[INFO] Source hash match: startup={0} bridge={1}" -f $startupMatch,$bridgeMatch)
}
if ($installedCount -eq 0) {
    Write-Host "[FAIL] No installed RevitMCPBridge.extension found in standard pyRevit extension roots."
}

$appData = Get-EnvValue "REVITGPT_APPDATA_ROOT"
if ([string]::IsNullOrWhiteSpace($appData)) {
    $appData = Join-Path $env:LOCALAPPDATA "RevitGPT"
} elseif (-not [System.IO.Path]::IsPathRooted($appData)) {
    $appData = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $appData))
}

$startupLog = Join-Path $appData "logs\bridge-startup.ndjson"
$bridgeLog = Join-Path $appData "logs\bridge.ndjson"

if (Test-Path $startupLog) {
    Write-Host "--- bridge-startup.ndjson (last 20) ---"
    Get-Content $startupLog -Tail 20
} else {
    Write-Host "[INFO] bridge-startup.ndjson is absent. The installed startup.py has not produced evidence in this RevitGPT AppData root."
}

if (Test-Path $bridgeLog) {
    Write-Host "--- bridge.ndjson (last 20) ---"
    Get-Content $bridgeLog -Tail 20
} else {
    Write-Host "[INFO] bridge.ndjson is absent. The bridge module has not produced runtime evidence in this RevitGPT AppData root."
}

$pyrevit = Get-Command pyrevit -ErrorAction SilentlyContinue
if ($pyrevit) {
    Write-Host ("[INFO] pyRevit CLI: " + $pyrevit.Source)
    try {
        Write-Host "--- pyrevit env ---"
        & $pyrevit.Source env 2>&1 | Select-Object -First 80
    } catch {
        Write-Host ("[INFO] pyrevit env failed: " + $_.Exception.Message)
    }
} else {
    Write-Host "[INFO] pyRevit CLI was not found in PATH."
}
