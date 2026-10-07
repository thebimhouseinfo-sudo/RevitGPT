$ErrorActionPreference = "Continue"

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $repoRoot "runtimes\Revit-mcp\bridge\pyrevit_extension\RevitMCPBridge.extension"
$sourceStartup = Join-Path $sourceRoot "startup.py"
$sourceBridge = Join-Path $sourceRoot "RevitMCPBridge.bundle\Contents\revit_mcp_bridge.py"

. (Join-Path $PSScriptRoot "pyrevit-runtime.ps1")

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

$nativeReady = $false
$nativeManifests = @()
foreach ($year in @(2024) + @(Get-RunningRevitYears)) {
    foreach ($root in @(
        (Join-Path $env:APPDATA "Autodesk\Revit\Addins\$year"),
        (Join-Path $env:ProgramData "Autodesk\Revit\Addins\$year")
    )) {
        $manifest = Join-Path $root "RevitMCPBridge.addin"
        if (-not (Test-Path $manifest)) { continue }
        $nativeManifests += $manifest
        try {
            [xml]$xml = Get-Content $manifest -Raw
            $addin = @($xml.RevitAddIns.AddIn) | Where-Object { $_.FullClassName -eq "RevitMCPBridge.BridgeApplication" } | Select-Object -First 1
            $assembly = if ($addin) { [string]$addin.Assembly } else { $null }
            $exists = [bool]($assembly -and (Test-Path $assembly))
            Write-Host ("[INFO] Native bridge manifest: {0}" -f $manifest)
            Write-Host ("[INFO] Native bridge assembly: {0} exists={1}" -f $assembly,$exists)
            if ($exists) { $nativeReady = $true }
        } catch {
            Write-Host ("[WARN] Native bridge manifest parse failed: " + $_.Exception.Message)
        }
    }
}
if ($nativeReady) {
    Write-Host "[OK] Native standalone Revit MCP Bridge is installed; pyRevit is optional."
} elseif ($nativeManifests.Count -eq 0) {
    Write-Host "[INFO] Native RevitMCPBridge.addin not found."
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
    if ($nativeReady) {
        Write-Host "[INFO] No pyRevit bridge fallback installed; native bridge is the primary path."
    } else {
        Write-Host "[FAIL] No native bridge and no RevitMCPBridge.extension fallback found."
    }
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

$pyrevitCli = Find-PyRevitCli
if ($pyrevitCli) {
    Write-Host ("[OK] pyRevit CLI/runtime found: " + $pyrevitCli)
    try {
        Write-Host "--- pyrevit attached ---"
        & $pyrevitCli attached 2>&1 | Select-Object -First 80
    } catch {
        Write-Host ("[INFO] pyrevit attached failed: " + $_.Exception.Message)
    }
} else {
    if ($nativeReady) {
        Write-Host "[INFO] pyRevit runtime/CLI not found; this is acceptable because the native bridge is installed."
    } else {
        Write-Host "[FAIL] pyRevit runtime/CLI was not found and no native bridge is installed."
        Write-Host ("[INFO] Checked user install: " + (Join-Path $env:APPDATA "pyRevit-Master\bin\pyrevit.exe"))
        if ($env:ProgramFiles) {
            Write-Host ("[INFO] Checked admin install: " + (Join-Path $env:ProgramFiles "pyRevit-Master\bin\pyrevit.exe"))
            Write-Host ("[INFO] Checked CLI install: " + (Join-Path $env:ProgramFiles "pyRevit CLI\bin\pyrevit.exe"))
        }
    }
}

$runningYears = @(Get-RunningRevitYears)
if ($runningYears.Count -eq 0 -and $revit.Count -gt 0) {
    Write-Host "[WARN] Revit is running but its product year could not be derived from Revit.exe metadata/path."
}

foreach ($year in $runningYears) {
    $attachment = Get-PyRevitAttachmentInfo -Year $year
    if (-not $attachment) {
        if ($nativeReady) {
            Write-Host ("[INFO] pyRevit is not attached to Revit {0}; native RevitMCPBridge.addin is the active path." -f $year)
        } else {
            Write-Host ("[FAIL] pyRevit is not attached to running Revit {0}: pyRevit.addin was not found." -f $year)
            foreach ($candidate in (Get-PyRevitAttachmentPaths -Year $year)) {
                Write-Host ("[INFO] Expected attachment candidate: " + $candidate)
            }
        }
        continue
    }

    if ($attachment.ParseError) {
        Write-Host ("[FAIL] pyRevit attachment manifest could not be parsed: " + $attachment.ManifestPath)
        Write-Host ("[INFO] Manifest parse error: " + $attachment.ParseError)
        continue
    }

    Write-Host ("[OK] pyRevit attachment Revit {0}: {1}" -f $year,$attachment.ManifestPath)
    Write-Host ("[INFO] pyRevit loader assembly: " + $attachment.AssemblyPath)
    if (-not $attachment.AssemblyExists) {
        Write-Host "[FAIL] pyRevit attachment points to a missing loader assembly."
    }
}
