param(
    [ValidateSet("Inspect", "PreparePyRevit", "RestoreNative")]
    [string]$Mode = "Inspect",
    [int[]]$RevitYears = @(2024),
    [string]$EvidencePath
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $localAppData = $env:LOCALAPPDATA
    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        $localAppData = [Environment]::GetFolderPath("LocalApplicationData")
    }
    $evidenceRoot = Join-Path $localAppData "RevitGPT\evidence\E-PY"
    $EvidencePath = Join-Path $evidenceRoot ("host-baseline-{0}.json" -f (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss"))
}

function Write-Stage([string]$Message) {
    Write-Host ("[E-PY] [{0}] {1}" -f (Get-Date).ToString("HH:mm:ss"), $Message)
}

function Get-Sha256([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    $file = [System.IO.File]::OpenRead($Path)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        return (-join ($hasher.ComputeHash($file) | ForEach-Object { $_.ToString("X2") }))
    } finally {
        $file.Dispose()
        $hasher.Dispose()
    }
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
    # Avoid Get-CimInstance: WMI can stall for minutes on unhealthy hosts.
    # PowerShell Get-Process gives a local snapshot without a WMI roundtrip.
    $items = @()
    foreach ($proc in @(Get-Process -Name "Revit" -ErrorAction SilentlyContinue)) {
        $exe = $null
        try { $exe = [string]$proc.Path } catch { $exe = $null }
        $items += [pscustomobject]@{
            pid = [int]$proc.Id
            executable_path = $exe
            command_line = $null
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
    # Use bounded netstat child process instead of unbounded CIM calls.
    # If the probe cannot complete, return UNKNOWN (never assume port free).
    $proc = $null
    try {
        $netstat = Join-Path $env:WINDIR "System32\netstat.exe"
        if (-not (Test-Path -LiteralPath $netstat -PathType Leaf)) {
            throw "netstat.exe is unavailable: $netstat"
        }

        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = $netstat
        $startInfo.Arguments = "-ano -p tcp"
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true

        $proc = New-Object System.Diagnostics.Process
        $proc.StartInfo = $startInfo
        if (-not $proc.Start()) { throw "Failed to start netstat port probe" }

        # Drain both pipes asynchronously before waiting to avoid pipe deadlock.
        $stdout = $proc.StandardOutput.ReadToEndAsync()
        $stderr = $proc.StandardError.ReadToEndAsync()
        if (-not $proc.WaitForExit(8000)) {
            try { $proc.Kill() } catch {}
            throw "netstat port probe exceeded 8 seconds"
        }
        $outText = $stdout.GetAwaiter().GetResult()
        $errText = $stderr.GetAwaiter().GetResult()
        if ($proc.ExitCode -ne 0) {
            throw ("netstat failed with exit code {0}: {1}" -f $proc.ExitCode, $errText)
        }

        $pids = @()
        foreach ($line in ($outText -split "\r?\n")) {
            # Match loopback and wildcard listeners. All may conflict with 8765.
            if ($line -match '^\s*TCP\s+\S+:8765\s+\S+\s+LISTENING\s+(\d+)\s*$') {
                $pids += [int]$Matches[1]
            }
        }
        $pids = @($pids | Sort-Object -Unique)
        # Independent listener check prevents a localized/changed netstat
        # output format from silently treating a busy port as free.
        $listenerPresent = @(
            [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
                Where-Object { $_.Port -eq 8765 }
        ).Count -gt 0
        if ($listenerPresent -and $pids.Count -eq 0) {
            throw "Port 8765 is listening, but netstat owner parsing was inconclusive"
        }
        $owners = @()
        foreach ($ownerPid in $pids) {
            $owner = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
            $ownerPath = $null
            try { if ($owner) { $ownerPath = [string]$owner.Path } } catch {}
            $owners += [pscustomobject]@{
                pid = $ownerPid
                process_name = $(if ($owner) { [string]$owner.ProcessName } else { $null })
                executable_path = $ownerPath
            }
        }
        return [pscustomobject]@{
            checked = $true
            listening = ($pids.Count -gt 0)
            pid = $(if ($pids.Count -gt 0) { $pids[0] } else { $null })
            owners = $owners
            error = $null
        }
    } catch {
        return [pscustomobject]@{
            checked = $false
            listening = $null
            pid = $null
            owners = @()
            error = $_.Exception.Message
        }
    } finally {
        if ($proc) { $proc.Dispose() }
    }
}

function Write-Evidence([hashtable]$Evidence) {
    Write-Stage "Evidence: creating directory"
    $dir = Split-Path -Parent $EvidencePath
    if (-not [string]::IsNullOrWhiteSpace($dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    Write-Stage "Evidence: serializing plain data"
    $json = ConvertTo-Json -InputObject $Evidence -Depth 8 -Compress
    Write-Stage "Evidence: writing JSON file"
    [System.IO.File]::WriteAllText(
        $EvidencePath,
        $json,
        [System.Text.UTF8Encoding]::new($false)
    )
    Write-Host ("[E-PY] Evidence: " + $EvidencePath)
}

$actions = @()
$errorText = $null

try {
    Write-Stage "Checking whether Revit is running (local process snapshot)"
    $revitBefore = @(Get-RevitProcesses)

    if ($Mode -in @("PreparePyRevit", "RestoreNative") -and $revitBefore.Count -gt 0) {
        throw "Revit must be fully closed before changing bridge manifests. Running PID(s): $((@($revitBefore | ForEach-Object { $_.pid })) -join ',')"
    }

    if ($Mode -eq "PreparePyRevit") {
        Write-Stage "Preflight: checking port 8765 (8-second maximum)"
        $preflightPort = Get-Port8765Owner
        if (-not $preflightPort.checked) {
            throw ("Port state unknown; refusing manifest changes: " + $preflightPort.error)
        }
        if ($preflightPort.listening) {
            throw "Port 8765 is already occupied; refusing manifest changes."
        }
        Write-Stage "Preflight: checking installed pyRevit bridge extension"
        $installed = @(Get-PyRevitBridgeRecords)
        if ($installed.Count -eq 0) {
            throw "pyRevit bridge extension was not found; refusing manifest changes."
        }
        if (@($installed | Where-Object {
            $_.startup_source_match -and $_.bridge_source_match -and $_.startup_first_line -eq "#! python3"
        }).Count -eq 0) {
            throw "No installed pyRevit bridge matches the source CPython startup/bridge files; refusing manifest changes."
        }
        Write-Stage "Preflight complete. Disabling only verified native manifests"
        $moved = @()
        try {
            foreach ($record in @(Get-NativeBridgeManifestRecords $RevitYears | Where-Object { $_.enabled })) {
                $source = [string]$record.path
                $target = $source + ".e-py-disabled"
                if (Test-Path -LiteralPath $target) {
                    throw "Refusing to overwrite existing disabled manifest: $target"
                }
                Write-Stage ("Disabling native manifest: " + $source)
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
            for ($i = $moved.Count - 1; $i -ge 0; $i--) {
                $item = $moved[$i]
                if ((Test-Path -LiteralPath $item.target) -and -not (Test-Path -LiteralPath $item.source)) {
                    Move-Item -LiteralPath $item.target -Destination $item.source -ErrorAction SilentlyContinue
                }
            }
            throw
        }
    }

    if ($Mode -eq "RestoreNative") {
        $restored = @()
        try {
            foreach ($record in @(Get-NativeBridgeManifestRecords $RevitYears | Where-Object { -not $_.enabled })) {
                $disabled = [string]$record.path
                $original = $disabled.Substring(0, $disabled.Length - ".e-py-disabled".Length)
                if (Test-Path -LiteralPath $original) {
                    throw "Refusing to overwrite enabled manifest while restoring: $original"
                }
                Write-Stage ("Restoring native manifest: " + $original)
                Move-Item -LiteralPath $disabled -Destination $original
                $restored += [pscustomobject]@{ source = $disabled; target = $original }
                $actions += [pscustomobject]@{
                    action = "restore_native_manifest"
                    source = $disabled
                    target = $original
                    source_sha256 = $record.sha256
                }
            }
        } catch {
            for ($i = $restored.Count - 1; $i -ge 0; $i--) {
                $item = $restored[$i]
                if ((Test-Path -LiteralPath $item.target) -and -not (Test-Path -LiteralPath $item.source)) {
                    Move-Item -LiteralPath $item.target -Destination $item.source -ErrorAction SilentlyContinue
                }
            }
            throw
        }
    }
} catch {
    $errorText = $_.Exception.Message
}

Write-Stage "Collecting final Revit process snapshot"
$revitAfter = @(Get-RevitProcesses)
Write-Stage "Inspecting native manifests"
$native = @(Get-NativeBridgeManifestRecords $RevitYears)
Write-Stage "Inspecting installed pyRevit extensions"
$pyrevit = @(Get-PyRevitBridgeRecords)
Write-Stage "Checking final port 8765 ownership (8-second maximum)"
$port = Get-Port8765Owner
if (-not $port.checked -and [string]::IsNullOrWhiteSpace($errorText)) {
    $errorText = "Could not verify port 8765: $($port.error)"
}
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
        @($pyrevit | Where-Object {
            $_.startup_source_match -and $_.bridge_source_match -and $_.startup_first_line -eq "#! python3"
        }).Count -gt 0 -and
        $port.checked -and
        -not $port.listening
    )
}

Write-Stage "Writing evidence JSON"
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
