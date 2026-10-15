# Isolated startup-stage contract; never edits HKCU Run or starts real services.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$traySource = Get-Content -LiteralPath (Join-Path $root 'revitgpt-tray.ps1') -Raw
$launcherSource = Get-Content -LiteralPath (Join-Path $root 'revitgpt-tray.vbs') -Raw

function Assert([bool]$Ok, [string]$Reason) {
    if (-not $Ok) { throw ('Startup trace contract: ' + $Reason) }
}

$pattern = '(?ms)^function Write-StartupTrace\(\[string\]\$Stage\) \{.*?^\}\r?\n\r?\nfunction Set-StartupStage\(\[string\]\$Stage\) \{.*?^\}'
$match = [regex]::Match($traySource, $pattern)
Assert $match.Success 'trace helper boundary was not found'
Assert ($launcherSource.Contains('StartupLog "wscript_invoked"')) 'VBS entry is not traced'
Assert ($launcherSource.Contains('StartupLog "powershell_dispatched"')) 'VBS dispatch is not traced'

$required = @(
    'powershell_entry', 'env_verified', 'node_entry_verified',
    'ui_assemblies_ready', 'mutex_acquired', 'slim_starting',
    'slim_ready', 'slim_failed', 'tunnel_starting', 'tunnel_ready',
    'tunnel_failed', 'tray_icon_visible', 'tray_state_written',
    'message_loop_enter', 'message_loop_exit', 'duplicate_tray_detected',
    'env_missing', 'node_entry_missing', 'fatal_at_'
)
foreach ($stage in $required) {
    Assert ($traySource.Contains($stage)) ('missing stage ' + $stage)
}

$temp = Join-Path ([IO.Path]::GetTempPath()) ('rg-startup-trace-' + [guid]::NewGuid().ToString('N'))
try {
    $LogDir = Join-Path $temp 'logs'
    $StartupTracePath = Join-Path $LogDir 'startup-launch.log'
    Invoke-Expression $match.Value
    Write-StartupTrace 'powershell_entry'
    Set-StartupStage 'env_verified'

    Assert (Test-Path -LiteralPath $StartupTracePath) 'trace log not written'
    $log = Get-Content -LiteralPath $StartupTracePath -Raw
    Assert ($log.Contains('powershell_entry | pid=')) 'PowerShell entry event absent'
    Assert ($log.Contains('env_verified | pid=')) 'stage transition absent'
    Assert ($script:StartupStage -eq 'env_verified') 'stage state not updated'

    Write-StartupTrace 'SECRET=should_not_appear'
    $log = Get-Content -LiteralPath $StartupTracePath -Raw
    Assert (-not $log.Contains('SECRET')) 'non-stage data entered diagnostic trace'

    # A logging failure must not prevent the tray from starting.
    $StartupTracePath = Join-Path $temp 'no-such-folder\no-log.txt'
    Write-StartupTrace 'tunnel_ready'
    Assert (-not (Test-Path -LiteralPath $StartupTracePath)) 'unexpected writes outside configured log dir'

    Write-Host '[PASS] RevitGPT startup trace stages, safe values, and diagnostic failure isolation'
}
finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
