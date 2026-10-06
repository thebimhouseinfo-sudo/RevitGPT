# RevitGPT Windows tray host.
param(
    [switch]$InstallStartup,
    [switch]$RemoveStartup,
    [switch]$StopInstalled,
    [switch]$StatusOnly
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$StartupKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$StartupName = "RevitGPT"
$TrayScriptPath = [System.IO.Path]::GetFullPath($PSCommandPath)
$TrayLauncherPath = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "revitgpt-tray.vbs"))
$IconPath = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "icon.png"))
$IndexPath = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "src\index.mjs"))
$TunnelExe = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "bin\tunnel-client.exe"))
$TunnelProfilePath = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "profiles\revitgpt.yaml"))

function Get-DotEnvValue([string]$Name) {
    if (-not (Test-Path ".env")) { return $null }
    $line = Get-Content ".env" | Where-Object {
        $_ -match "^\s*$Name\s*=" -and -not $_.TrimStart().StartsWith("#")
    } | Select-Object -First 1
    if (-not $line) { return $null }
    return (($line -split "=", 2)[1].Trim()).Trim("'").Trim('"')
}

$appDataConfigured = Get-DotEnvValue "REVITGPT_APPDATA_ROOT"
$StateRoot = if ([string]::IsNullOrWhiteSpace($appDataConfigured)) {
    Join-Path $env:LOCALAPPDATA "RevitGPT"
} elseif ([System.IO.Path]::IsPathRooted($appDataConfigured)) {
    [System.IO.Path]::GetFullPath($appDataConfigured)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $ScriptDir $appDataConfigured))
}
$LogDir = Join-Path $StateRoot "logs"
$StateDir = Join-Path $StateRoot "state"
$TrayLog = Join-Path $LogDir "tray.log"
$TrayReadyPath = Join-Path $StateDir "tray-ready.json"

foreach ($relative in @(
    "libraries\python",
    "libraries\dynamo",
    "libraries\jobs",
    "registry\user",
    "workspace\python-draft",
    "workspace\dynamo-draft",
    "workspace\job-draft",
    "runtime\dynamic-python",
    "data\runs",
    "knowledge\revit",
    "knowledge\api",
    "knowledge\failures",
    "knowledge\learned",
    "state",
    "logs"
)) {
    New-Item -ItemType Directory -Force -Path (Join-Path $StateRoot $relative) | Out-Null
}

$PortValue = Get-DotEnvValue "PORT"
$Port = if ($PortValue) { [int]$PortValue } else { 3300 }
$TunnelHealthValue = Get-DotEnvValue "OPENAI_TUNNEL_HEALTH_PORT"
$TunnelHealthPort = if ($TunnelHealthValue) { [int]$TunnelHealthValue } else { 8280 }

function Write-TrayLog([string]$Message) {
    Add-Content -Path $TrayLog -Value "[$((Get-Date).ToString('s'))] $Message" -Encoding UTF8
}

function Get-StartupCommand {
    return 'wscript.exe "' + $TrayLauncherPath + '"'
}

function Install-StartupRegistration {
    New-Item -Path $StartupKey -Force | Out-Null
    New-ItemProperty -Path $StartupKey -Name $StartupName -Value (Get-StartupCommand) -PropertyType String -Force | Out-Null
    Write-Host "[OK] RevitGPT will start automatically when this Windows user signs in."
}

function Remove-StartupRegistration {
    Remove-ItemProperty -Path $StartupKey -Name $StartupName -ErrorAction SilentlyContinue
    Write-Host "[OK] RevitGPT Windows auto-start removed."
}

function Get-PortOwnerPid([int]$TargetPort) {
    try {
        $lines = netstat -ano | Select-String ":$TargetPort\s" | Select-String "LISTENING"
        foreach ($line in $lines) {
            $parts = ($line -replace '\s+', ' ').ToString().Trim().Split(' ')
            $processId = [int]$parts[-1]
            if ($processId -gt 0) { return $processId }
        }
    } catch {}
    return $null
}

function Get-ProcessInfo([int]$ProcessId) {
    try { return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop }
    catch { return $null }
}

function Test-CommandLineContains([int]$ProcessId, [string]$Needle) {
    $info = Get-ProcessInfo -ProcessId $ProcessId
    if (-not $info -or -not $info.CommandLine) { return $false }
    return $info.CommandLine.IndexOf($Needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Test-OwnedRuntime([int]$ProcessId) {
    if ($ProcessId -le 0) { return $false }
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.ProcessName -notmatch '^node(?:\.exe)?$') { return $false }
    return Test-CommandLineContains -ProcessId $ProcessId -Needle $IndexPath
}

function Test-OwnedTunnel([int]$ProcessId) {
    if ($ProcessId -le 0) { return $false }
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.ProcessName -notmatch '^tunnel-client(?:\.exe)?$') { return $false }
    return Test-CommandLineContains -ProcessId $ProcessId -Needle $TunnelProfilePath
}

function Test-OwnedTray([int]$ProcessId) {
    if ($ProcessId -le 0) { return $false }
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.ProcessName -notmatch '^(powershell|pwsh)(?:\.exe)?$') { return $false }
    return Test-CommandLineContains -ProcessId $ProcessId -Needle $TrayScriptPath
}

function Get-RevitGptHealth {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
        if ($resp.status -eq "ok" -and $resp.name -eq "revitgpt") { return $resp }
    } catch {}
    return $null
}

function Test-TunnelHealthy {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$TunnelHealthPort/readyz" -UseBasicParsing -TimeoutSec 2
        return ($resp.StatusCode -eq 200 -and $resp.Content -match "ready")
    } catch { return $false }
}

function Get-RevitProcesses {
    return @(Get-Process -Name "Revit" -ErrorAction SilentlyContinue)
}

function Read-TrayState {
    if (-not (Test-Path $TrayReadyPath)) { return $null }
    try { return Get-Content $TrayReadyPath -Raw | ConvertFrom-Json }
    catch { return $null }
}

function Write-TrayState {
    $health = Get-RevitGptHealth
    $revit = Get-RevitProcesses
    $payload = @{
        pid = $PID
        ready = $true
        started_at = $script:TrayStartedAt
        runtime_pid = $script:RuntimePid
        tunnel_pid = $script:TunnelPid
        runtime_ready = [bool]$health
        tunnel_ready = [bool](Test-TunnelHealthy)
        revit_running = ($revit.Count -gt 0)
        revit_process_count = $revit.Count
        revit_pids = @($revit | ForEach-Object { $_.Id })
        revit_mcp_connected = if ($health) { [bool]$health.revit_mcp.connected } else { $false }
    } | ConvertTo-Json -Depth 5
    $temp = "$TrayReadyPath.tmp"
    [System.IO.File]::WriteAllText($temp, $payload, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -Path $temp -Destination $TrayReadyPath -Force
}

function Start-RevitGptRuntime {
    $health = Get-RevitGptHealth
    if ($health) {
        $owner = Get-PortOwnerPid -TargetPort $Port
        if ($owner -and (Test-OwnedRuntime -ProcessId $owner)) {
            $script:RuntimePid = $owner
            return
        }
        throw "Port $Port has a healthy service that is not owned by this RevitGPT source tree."
    }

    $occupied = Get-PortOwnerPid -TargetPort $Port
    if ($occupied) { throw "Port $Port is occupied by PID $occupied." }

    $stdout = Join-Path $LogDir "revitgpt.out.log"
    $stderr = Join-Path $LogDir "revitgpt.err.log"
    $proc = Start-Process -FilePath "node.exe" -ArgumentList @("`"$IndexPath`"") -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $script:RuntimePid = $proc.Id

    $deadline = (Get-Date).AddSeconds(20)
    do {
        if (Get-RevitGptHealth) { return }
        if ($proc.HasExited) {
            $script:RuntimePid = $null
            throw "RevitGPT slim MCP exited before becoming ready. See $stderr"
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if (-not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
    $script:RuntimePid = $null
    throw "RevitGPT slim MCP did not become ready on port $Port. See $stderr"
}

function Stop-RevitGptRuntime {
    $state = Read-TrayState
    $runtimePid = $script:RuntimePid

    if (-not $runtimePid -and $state -and $state.runtime_pid) {
        $candidate = [int]$state.runtime_pid
        if (Test-OwnedRuntime -ProcessId $candidate) { $runtimePid = $candidate }
    }

    if (-not $runtimePid) {
        $candidate = Get-PortOwnerPid -TargetPort $Port
        if ($candidate -and (Test-OwnedRuntime -ProcessId $candidate)) { $runtimePid = $candidate }
    }

    if ($runtimePid -and (Test-OwnedRuntime -ProcessId $runtimePid)) {
        Stop-Process -Id $runtimePid -Force -ErrorAction SilentlyContinue
    }
    $script:RuntimePid = $null
}

function Start-RevitGptTunnel {
    if (Test-TunnelHealthy) {
        $owner = Get-PortOwnerPid -TargetPort $TunnelHealthPort
        if ($owner -and (Test-OwnedTunnel -ProcessId $owner)) {
            $script:TunnelPid = $owner
            return
        }
        throw "Tunnel health port $TunnelHealthPort is healthy but not owned by this RevitGPT profile."
    }

    if (-not (Test-Path $TunnelExe)) { throw "tunnel-client.exe is missing. Run setup.bat." }
    if (-not (Test-Path $TunnelProfilePath)) { throw "profiles\revitgpt.yaml is missing. Run setup.bat." }
    $apiKey = Get-DotEnvValue "OPENAI_TUNNEL_API_KEY"
    if (-not $apiKey) { throw "OPENAI_TUNNEL_API_KEY is missing. Run setup.bat." }

    $occupied = Get-PortOwnerPid -TargetPort $TunnelHealthPort
    if ($occupied) { throw "Tunnel health port $TunnelHealthPort is occupied by PID $occupied." }

    $savedApiKey = $env:OPENAI_TUNNEL_API_KEY
    try {
        $env:OPENAI_TUNNEL_API_KEY = $apiKey
        $stdout = Join-Path $LogDir "tunnel.out.log"
        $stderr = Join-Path $LogDir "tunnel.err.log"
        $proc = Start-Process -FilePath $TunnelExe -ArgumentList @("run", "--profile-file", "`"$TunnelProfilePath`"") -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $script:TunnelPid = $proc.Id
    } finally {
        $env:OPENAI_TUNNEL_API_KEY = $savedApiKey
    }

    $deadline = (Get-Date).AddSeconds(20)
    do {
        if (Test-TunnelHealthy) { return }
        if ($proc.HasExited) {
            $script:TunnelPid = $null
            throw "RevitGPT tunnel-client exited before becoming ready. See $stderr and $stdout"
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if (-not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
    $script:TunnelPid = $null
    throw "RevitGPT Secure Tunnel did not become ready. See $stderr and $stdout"
}

function Stop-RevitGptTunnel {
    $state = Read-TrayState
    $tunnelPid = $script:TunnelPid

    if (-not $tunnelPid -and $state -and $state.tunnel_pid) {
        $candidate = [int]$state.tunnel_pid
        if (Test-OwnedTunnel -ProcessId $candidate) { $tunnelPid = $candidate }
    }

    if (-not $tunnelPid) {
        $candidate = Get-PortOwnerPid -TargetPort $TunnelHealthPort
        if ($candidate -and (Test-OwnedTunnel -ProcessId $candidate)) { $tunnelPid = $candidate }
    }

    if ($tunnelPid -and (Test-OwnedTunnel -ProcessId $tunnelPid)) {
        Stop-Process -Id $tunnelPid -Force -ErrorAction SilentlyContinue
    }
    $script:TunnelPid = $null
}

function Stop-InstalledTray {
    $state = Read-TrayState
    if ($state -and $state.pid) {
        $trayPid = [int]$state.pid
        if ($trayPid -ne $PID -and (Test-OwnedTray -ProcessId $trayPid)) {
            Stop-Process -Id $trayPid -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item $TrayReadyPath -Force -ErrorAction SilentlyContinue
}

if ($InstallStartup) {
    Install-StartupRegistration
    exit 0
}
if ($RemoveStartup) {
    Remove-StartupRegistration
    exit 0
}
if ($StopInstalled) {
    Stop-RevitGptTunnel
    Stop-RevitGptRuntime
    Stop-InstalledTray
    exit 0
}
if ($StatusOnly) {
    $health = Get-RevitGptHealth
    $revit = Get-RevitProcesses
    $state = Read-TrayState
    $trayReady = $false
    if ($state -and $state.pid) { $trayReady = Test-OwnedTray -ProcessId ([int]$state.pid) }
    Write-Host "Tray             : $(if ($trayReady) { 'READY' } else { 'OFFLINE' })"
    Write-Host "Slim MCP         : $(if ($health) { 'READY' } else { 'OFFLINE' })"
    Write-Host "Secure tunnel    : $(if (Test-TunnelHealthy) { 'READY' } else { 'OFFLINE' })"
    Write-Host "Revit            : $(if ($revit.Count -gt 0) { 'ON (' + $revit.Count + ')' } else { 'OFF' })"
    if ($health) {
        Write-Host "Full Revit MCP   : $(if ($health.revit_mcp.connected) { 'ON' } else { 'OFF' })"
    }
    exit 0
}

if ($env:OS -ne "Windows_NT") { throw "RevitGPT tray host is Windows-only." }
if (-not (Test-Path ".env")) { throw ".env is missing. Run setup.bat first." }
if (-not (Test-Path $IndexPath)) { throw "src\index.mjs is missing." }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, "Local\RevitGPTTray", [ref]$createdNew)
if (-not $createdNew) { exit 0 }

$script:TrayStartedAt = (Get-Date).ToString("o")
$script:RuntimePid = $null
$script:TunnelPid = $null
$script:Exiting = $false

try { Start-RevitGptRuntime } catch { Write-TrayLog ("Slim MCP start failed: " + $_.Exception.Message) }
try { Start-RevitGptTunnel } catch { Write-TrayLog ("Tunnel start failed: " + $_.Exception.Message) }

$notify = New-Object System.Windows.Forms.NotifyIcon
$script:TrayBitmap = $null
$script:TrayIcon = $null
if (Test-Path $IconPath) {
    try {
        $script:TrayBitmap = New-Object System.Drawing.Bitmap($IconPath)
        $iconHandle = $script:TrayBitmap.GetHicon()
        $script:TrayIcon = [System.Drawing.Icon]::FromHandle($iconHandle)
        $notify.Icon = $script:TrayIcon
    } catch {
        Write-TrayLog ("Icon load failed: " + $_.Exception.Message)
        $notify.Icon = [System.Drawing.SystemIcons]::Application
    }
} else {
    $notify.Icon = [System.Drawing.SystemIcons]::Application
}
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = $menu.Items.Add("RevitGPT: checking")
$tunnelItem = $menu.Items.Add("Secure Tunnel: checking")
$revitItem = $menu.Items.Add("Revit: checking")
$mcpItem = $menu.Items.Add("Full Revit MCP: checking")
$menu.Items.Add("-") | Out-Null
$restartItem = $menu.Items.Add("Restart RevitGPT")
$exitItem = $menu.Items.Add("Exit RevitGPT")
$notify.ContextMenuStrip = $menu

function Update-Ui {
    $health = Get-RevitGptHealth
    $revit = Get-RevitProcesses
    $tunnelReady = Test-TunnelHealthy

    $statusItem.Text = "RevitGPT: $(if ($health) { 'READY' } else { 'OFFLINE' })"
    $tunnelItem.Text = "Secure Tunnel: $(if ($tunnelReady) { 'READY' } else { 'OFFLINE' })"
    $revitItem.Text = "Revit: $(if ($revit.Count -gt 0) { 'ON (' + $revit.Count + ')' } else { 'OFF' })"
    $mcpItem.Text = "Full Revit MCP: $(if ($health -and $health.revit_mcp.connected) { 'ON' } else { 'OFF' })"

    $tip = "RevitGPT $(if ($health) { 'READY' } else { 'OFF' }) | Tunnel $(if ($tunnelReady) { 'ON' } else { 'OFF' }) | Revit $(if ($revit.Count -gt 0) { 'ON' } else { 'OFF' })"
    if ($tip.Length -gt 63) { $tip = $tip.Substring(0, 63) }
    $notify.Text = $tip
    Write-TrayState
}

function Self-Heal {
    if (-not (Get-RevitGptHealth)) {
        try { Start-RevitGptRuntime } catch { Write-TrayLog ("Slim MCP self-heal failed: " + $_.Exception.Message) }
    }
    if (-not (Test-TunnelHealthy) -and (Get-RevitGptHealth)) {
        try { Start-RevitGptTunnel } catch { Write-TrayLog ("Tunnel self-heal failed: " + $_.Exception.Message) }
    }
}

$restartItem.Add_Click({
    try {
        Stop-RevitGptTunnel
        Stop-RevitGptRuntime
        Start-Sleep -Milliseconds 500
        Start-RevitGptRuntime
        Start-RevitGptTunnel
    } catch {
        Write-TrayLog ("Restart failed: " + $_.Exception.Message)
    }
    Update-Ui
})

$exitItem.Add_Click({
    $script:Exiting = $true
    Stop-RevitGptTunnel
    Stop-RevitGptRuntime
    $notify.Visible = $false
    $notify.Dispose()
    if ($script:TrayIcon) { $script:TrayIcon.Dispose() }
    if ($script:TrayBitmap) { $script:TrayBitmap.Dispose() }
    Remove-Item $TrayReadyPath -Force -ErrorAction SilentlyContinue
    [System.Windows.Forms.Application]::Exit()
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({
    if (-not $script:Exiting) {
        Self-Heal
        Update-Ui
    }
})
$timer.Start()
Update-Ui
[System.Windows.Forms.Application]::Run()
