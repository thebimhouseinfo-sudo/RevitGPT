# RevitGPT tray host for Windows.
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
$StateRoot = Join-Path $env:LOCALAPPDATA "RevitGPT"
$LogDir = Join-Path $StateRoot "logs"
$StateDir = Join-Path $StateRoot "state"
$TrayLog = Join-Path $LogDir "tray.log"
$TrayReadyPath = Join-Path $StateDir "tray-ready.json"

New-Item -ItemType Directory -Force -Path $LogDir,$StateDir | Out-Null

function Get-DotEnvValue([string]$Name) {
    if (-not (Test-Path ".env")) { return $null }
    $line = Get-Content ".env" | Where-Object {
        $_ -match "^\s*$Name\s*=" -and -not $_.TrimStart().StartsWith("#")
    } | Select-Object -First 1
    if (-not $line) { return $null }
    return (($line -split "=", 2)[1].Trim()).Trim("'").Trim('"')
}

$PortValue = Get-DotEnvValue "PORT"
$Port = if ($PortValue) { [int]$PortValue } else { 3300 }

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

function Test-OwnedRuntime([int]$ProcessId) {
    if ($ProcessId -le 0) { return $false }
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.ProcessName -notmatch '^node(?:\.exe)?$') { return $false }
    $info = Get-ProcessInfo -ProcessId $ProcessId
    if (-not $info -or -not $info.CommandLine) { return $false }
    return $info.CommandLine.IndexOf($IndexPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Get-RevitGptHealth {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
        if ($resp.status -eq "ok" -and $resp.name -eq "revitgpt") { return $resp }
    } catch {}
    return $null
}

function Get-RevitProcesses {
    return @(Get-Process -Name "Revit" -ErrorAction SilentlyContinue)
}

function Write-TrayState {
    $health = Get-RevitGptHealth
    $revit = Get-RevitProcesses
    $payload = @{
        pid = $PID
        ready = $true
        started_at = $script:TrayStartedAt
        runtime_pid = $script:RuntimePid
        runtime_ready = [bool]$health
        revit_running = ($revit.Count -gt 0)
        revit_process_count = $revit.Count
        revit_pids = @($revit | ForEach-Object { $_.Id })
        revit_mcp_connected = if ($health) { [bool]$health.revit_mcp.connected } else { $false }
    } | ConvertTo-Json -Depth 5
    $temp = "$TrayReadyPath.tmp"
    [System.IO.File]::WriteAllText($temp, $payload, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item $temp $TrayReadyPath -Force
}

function Start-RevitGptRuntime {
    $health = Get-RevitGptHealth
    if ($health) {
        $pid = Get-PortOwnerPid -TargetPort $Port
        if ($pid -and (Test-OwnedRuntime -ProcessId $pid)) {
            $script:RuntimePid = $pid
            return
        }
    }

    $occupied = Get-PortOwnerPid -TargetPort $Port
    if ($occupied) {
        throw "Port $Port is occupied by another process."
    }

    $proc = Start-Process -FilePath "node.exe" -ArgumentList @($IndexPath) -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru
    $script:RuntimePid = $proc.Id

    $deadline = (Get-Date).AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 500
        $health = Get-RevitGptHealth
        if ($health) { return }
    } while ((Get-Date) -lt $deadline)

    throw "RevitGPT runtime did not become healthy on port $Port."
}

function Stop-RevitGptRuntime {
    $pid = $script:RuntimePid
    if (-not $pid) { $pid = Get-PortOwnerPid -TargetPort $Port }
    if ($pid -and (Test-OwnedRuntime -ProcessId $pid)) {
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    }
    $script:RuntimePid = $null
}

if ($InstallStartup) { Install-StartupRegistration; exit 0 }
if ($RemoveStartup) { Remove-StartupRegistration; exit 0 }
if ($StopInstalled) {
    $pid = Get-PortOwnerPid -TargetPort $Port
    if ($pid -and (Test-OwnedRuntime -ProcessId $pid)) { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue }
    if (Test-Path $TrayReadyPath) {
        try {
            $state = Get-Content $TrayReadyPath -Raw | ConvertFrom-Json
            if ($state.pid -and $state.pid -ne $PID) {
                Stop-Process -Id ([int]$state.pid) -Force -ErrorAction SilentlyContinue
            }
        } catch {}
        Remove-Item $TrayReadyPath -Force -ErrorAction SilentlyContinue
    }
    exit 0
}
if ($StatusOnly) {
    $health = Get-RevitGptHealth
    $revit = Get-RevitProcesses
    Write-Host "Tray             : $(if (Test-Path $TrayReadyPath) { 'READY' } else { 'OFFLINE' })"
    Write-Host "Slim MCP         : $(if ($health) { 'READY' } else { 'OFFLINE' })"
    Write-Host "Revit            : $(if ($revit.Count -gt 0) { 'ON' } else { 'OFF' })"
    if ($health) {
        Write-Host "Full Revit MCP   : $(if ($health.revit_mcp.connected) { 'ON' } else { 'OFF' })"
    }
    exit 0
}

if ($env:OS -ne "Windows_NT") { throw "RevitGPT tray is Windows-only." }
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

try { Start-RevitGptRuntime }
catch {
    Write-TrayLog $_.Exception.Message
}

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
        Write-TrayLog "Failed to load icon.png; using Windows fallback icon. $($_.Exception.Message)"
        $notify.Icon = [System.Drawing.SystemIcons]::Application
    }
} else {
    $notify.Icon = [System.Drawing.SystemIcons]::Application
}
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = $menu.Items.Add("RevitGPT: Starting")
$revitItem = $menu.Items.Add("Revit: checking")
$mcpItem = $menu.Items.Add("Full Revit MCP: checking")
$menu.Items.Add("-") | Out-Null
$restartItem = $menu.Items.Add("Restart RevitGPT")
$exitItem = $menu.Items.Add("Exit RevitGPT")
$notify.ContextMenuStrip = $menu

function Update-Ui {
    $health = Get-RevitGptHealth
    $revit = Get-RevitProcesses
    $statusItem.Text = "RevitGPT: $(if ($health) { 'READY' } else { 'OFFLINE' })"
    $revitItem.Text = "Revit: $(if ($revit.Count -gt 0) { 'ON (' + $revit.Count + ')' } else { 'OFF' })"
    $mcpItem.Text = "Full Revit MCP: $(if ($health -and $health.revit_mcp.connected) { 'ON' } else { 'OFF' })"
    $tip = "RevitGPT $(if ($health) { 'READY' } else { 'OFF' }) | Revit $(if ($revit.Count -gt 0) { 'ON' } else { 'OFF' })"
    if ($tip.Length -gt 63) { $tip = $tip.Substring(0,63) }
    $notify.Text = $tip
    Write-TrayState
}

$restartItem.Add_Click({
    try {
        Stop-RevitGptRuntime
        Start-Sleep -Milliseconds 500
        Start-RevitGptRuntime
        Update-Ui
    } catch {
        Write-TrayLog $_.Exception.Message
    }
})

$exitItem.Add_Click({
    Stop-RevitGptRuntime
    $notify.Visible = $false
    $notify.Dispose()
    if ($script:TrayIcon) { $script:TrayIcon.Dispose() }
    if ($script:TrayBitmap) { $script:TrayBitmap.Dispose() }
    Remove-Item $TrayReadyPath -Force -ErrorAction SilentlyContinue
    [System.Windows.Forms.Application]::Exit()
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.Add_Tick({ Update-Ui })
$timer.Start()
Update-Ui
[System.Windows.Forms.Application]::Run()
