param(
    [ValidateSet("Inspect", "PreparePyRevit", "RestoreNative")]
    [string]$Mode = "Inspect",
    [int[]]$RevitYears = @(2024),
    [string]$EvidencePath
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $evidenceRoot = Join-Path ($env:LOCALAPPDATA ? $env:LOCALAPPDATA : [Environment]::GetFolderPath("LocalApplicationData")) "RevitGPT\evidence\E-PY"
    $EvidencePath = Join-Path $evidenceRoot ("host-baseline-{0}.json" -f (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss"))
}

function Get-Sha256([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Get-FileText([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return Get-Content -LiteralPath $Path -Raw
}

function Test-RevitBridgeManifest([string]$Path) {
    try {
        [xml]$xml = Get-Content -LiteralPath $Path -Raw
        $addin = @($xml.RevitAddIns.AddIn) |
            Where-Object { [string]$_.FullClassName -eq "RevitMCPBridge.BridgeApplication" } |
            Select-Object -First 1
        if (-not $addin) { return $null }
        return [pscustomobject]@{
            full_class_name = [string]$addin.FullClassName
            assembly = [string]$addin.Assembly
        }
    } catch {
        return $null
    }
}

function Get-RevitProcesses {
    $items = @()
    foreach ($proc in @(Get-CimInstance Win32_Process -Filter "Name='Revit.exe'" -ErrorAction SilentlyContinue)) {
        $items += [pscustomobject]@{
            pid = [int]$proc.ProcessId
            executable_path = [string]$proc.ExecutablePath
            command_line = [string]$proc.CommandLine
        }
    }
    return @($items)
}

function Get-NativeBridgeManifestRecords([int[]]$Years) {
    $records = @()
    foreach ($year in @($Years | Sort-Object -Unique)) {
        foreach ($root in @(
            (Join-Path $env:APPDATA "Autodesk\Revit\Addins\$year"),
            (Join-Path $env:ProgramData "Autodesk\Revit\Addins\$year")
        ) | Select-Object -Unique) {
            foreach ($candidate in @(
                (Join-Path $root "RevitMCPBridge.addin"),
                (Join-Path $root "RevitMCPBridge.addin.e-py-disabled")
            )) {
                if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
                $manifestInfo = Test-RevitBridgeManifest $candidate
                if (-not $manifestInfo) { continue }
                $enabled = $candidate.EndsWith(".addin", [StringComparison]::OrdinalIgnoreCase)
                $records += [pscustomobject]@{
                    year = $year
                    path = $candidate
                    enabled = $enabled
                    sha256 = Get-Sha256 $candidate
                    content = Get-FileText $candidate
                    full_class_name = $manifestInfo.full_class_name
                    assembly = $manifestInfo.assembly
                }
            }
        }
    }
    return @($records)
}

function Get-PyRevitBridgeRecords {
    $sourceRoot = Join-Path $repoRoot "runtimes\Revit-mcp\bridge\pyrevit_extension\RevitMCPBridge.extension"
    $sourceStartup = Join-Path $sourceRoot "startup.py"
    $sourceBridge = Join-Path $sourceRoot "RevitMCPBridge.bundle\Contents\revit_mcp_bridge.py"
    $sourceStartupSha = Get-Sha256 $sourceStartup
    $sourceBridgeSha = Get-Sha256 $sourceBridge

    $roots = @(
        (Join-Path $env:APPDATA "pyRevit\Extensions"),
        (Join-Path $env:LOCALAPPDATA "pyRevit\Extensions"),
        "C:\ProgramData\pyRevit\Extensions"
    ) | Select-Object -Unique

    $records = @()
    foreach ($root in $roots) {
        $extension = Join-Path $root "RevitMCPBridge.extension"
        if (-not (Test-Path -LiteralPath $extension -PathType Container)) { continue }
        $startup = Join-Path $extension "startup.py"
        $bridge = Join-Path $extension "RevitMCPBridge.bundle\Contents\revit_mcp_bridge.py"
        $startupText = Get-FileText $startup
        $firstLine = $null
        if ($startupText) {
            $firstLine = ($startupText -split "\r?\n", 2)[0]
        }
        $records += [pscustomobject]@{
            path = $extension
            startup_path = $startup
            startup_sha256 = Get-Sha256 $startup
            startup_source_match = ((Get-Sha256 $startup) -eq $sourceStartupSha)
            startup_first_line = $firstLine
            bridge_path = $bridge
            bridge_sha256 = Get-Sha256 $bridge
            bridge_source_match = ((Get-Sha256 $bridge) -eq $sourceBridgeSha)
        }
    }
    return @($records)
}

function Get-Port8765Owner {
    try {
        $conn = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 8765 -State Listen -ErrorAction Stop |
            Select-Object -First 1
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($conn.OwningProcess)" -ErrorAction SilentlyContinue
        return [pscustomobject]@{
            listening = $true
            pid = [int]$conn.OwningProcess
            process_name = $(if ($proc) { [string]$proc.Name } else { $null })
            executable_path = $(if ($proc) { [string]$proc.ExecutablePath } else { $null })
            command_line = $(if ($proc) { [string]$proc.CommandLine } else { $null })
        }
    } catch {
        return [pscustomobject]@{
            listening = $false
            pid = $null
            process_name = $null
            executable_path = $null
            command_line = $null
        }
    }
}

function Write-Evidence([hashtable]$Evidence) {
    $dir = Split-Path -Parent $EvidencePath
    if (-not [string]::IsNullOrWhiteSpace($dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    $Evidence | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
    Write-Host ("[E-PY] Evidence: " + $EvidencePath)
}

$actions = @()
$errorText = $null

try {
    $revitBefore = @(Get-RevitProcesses)

    if ($Mode -in @("PreparePyRevit", "RestoreNative") -and $revitBefore.Count -gt 0) {
        throw "Revit must be fully closed before changing bridge manifests. Running PID(s): $((@($revitBefore | ForEach-Object { $_.pid })) -join ',')"
    }

    if ($Mode -eq "PreparePyRevit") {
        $moved = @()
        try {
            foreach ($record in @(Get-NativeBridgeManifestRecords $RevitYears | Where-Object { $_.enabled })) {
                $source = [string]$record.path
                $target = $source + ".e-py-disabled"
                if (Test-Path -LiteralPath $target) {
                    throw "Refusing to overwrite existing disabled manifest: $target"
                }
                Move-Item -LiteralPath $source -Destination $target
                $moved += [pscustomobject]@{ source = $source; target = $target }
                $actions += [pscustomobject]@{
                    action = "disable_native_manifest"
                    source = $source
                    target = $target
                    source_sha256 = $record.sha256
                }
            }
        } catch {
            foreach ($item in @($moved | Select-Object -Reverse)) {
                if ((Test-Path -LiteralPath $item.target) -and -not (Test-Path -LiteralPath $item.source)) {
                    Move-Item -LiteralPath $item.target -Destination $item.source -ErrorAction SilentlyContinue
                }
            }
            throw
        }
    }

    if ($Mode -eq "RestoreNative") {
        foreach ($record in @(Get-NativeBridgeManifestRecords $RevitYears | Where-Object { -not $_.enabled })) {
            $disabled = [string]$record.path
            $original = $disabled.Substring(0, $disabled.Length - ".e-py-disabled".Length)
            if (Test-Path -LiteralPath $original) {
                throw "Refusing to overwrite enabled manifest while restoring: $original"
            }
            Move-Item -LiteralPath $disabled -Destination $original
            $actions += [pscustomobject]@{
                action = "restore_native_manifest"
                source = $disabled
                target = $original
                source_sha256 = $record.sha256
            }
        }
    }
} catch {
    $errorText = $_.Exception.Message
}

$revitAfter = @(Get-RevitProcesses)
$native = @(Get-NativeBridgeManifestRecords $RevitYears)
$pyrevit = @(Get-PyRevitBridgeRecords)
$port = Get-Port8765Owner
$enabledNativeCount = @($native | Where-Object { $_.enabled }).Count

$evidence = @{
    schema = "revitgpt.e-py.host-baseline.v1"
    timestamp_utc = (Get-Date).ToUniversalTime().ToString("o")
    mode = $Mode
    repo_root = $repoRoot
    revit_years = @($RevitYears | Sort-Object -Unique)
    revit_processes_before = $revitBefore
    revit_processes_after = $revitAfter
    native_bridge_manifests = $native
    pyrevit_bridge_extensions = $pyrevit
    port_8765 = $port
    actions = $actions
    error = $errorText
    pyrevit_evidence_ready = (
        [string]::IsNullOrWhiteSpace($errorText) -and
        $revitAfter.Count -eq 0 -and
        $enabledNativeCount -eq 0 -and
        $pyrevit.Count -gt 0 -and
        -not $port.listening
    )
}

Write-Evidence $evidence

if (-not [string]::IsNullOrWhiteSpace($errorText)) {
    throw $errorText
}

if ($Mode -eq "PreparePyRevit" -and -not $evidence.pyrevit_evidence_ready) {
    throw "E-PY host is not ready: require Revit closed, no enabled native RevitMCPBridge.addin, at least one pyRevit bridge extension, and port 8765 free."
}

if ($Mode -eq "PreparePyRevit") {
    Write-Host "[PASS] E-PY pyRevit baseline host prepared without any bridge HTTP request."
} elseif ($Mode -eq "RestoreNative") {
    Write-Host "[PASS] E-PY native bridge manifest state restored."
} else {
    Write-Host "[PASS] E-PY host inspected without any bridge HTTP request."
}
