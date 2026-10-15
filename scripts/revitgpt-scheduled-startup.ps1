# RevitGPT Windows logon Task Scheduler launcher, modeled on GPTWorker.
# Scheduled Task launches wscript.exe (GUI subsystem) -> existing silent VBS.
# HKCU Run is a fallback ONLY. Never change another application's entries.
$script:RevitGptStartupTaskName = 'RevitGPT Startup'

function Get-RevitGptTaskLauncher([string]$LauncherPath) {
    return [pscustomobject]@{
        Execute = Join-Path $env:WINDIR 'System32\wscript.exe'
        Arguments = '"' + [IO.Path]::GetFullPath($LauncherPath) + '"'
        WorkingDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($LauncherPath))
    }
}

function Get-RevitGptStartupTaskStatus([string]$LauncherPath) {
    if (-not (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) { return 'UNAVAILABLE' }
    $task = Get-ScheduledTask -TaskName $script:RevitGptStartupTaskName -ErrorAction SilentlyContinue
    if (-not $task) { return 'MISSING' }
    $launcher = Get-RevitGptTaskLauncher $LauncherPath
    $actions = @($task.Actions)
    if ($actions.Count -ne 1 -or $task.State -eq 'Disabled') { return 'CONFLICT' }
    $action = $actions[0]
    if (-not [string]::Equals($action.Execute, $launcher.Execute, [StringComparison]::OrdinalIgnoreCase) -or
        $action.Arguments -cne $launcher.Arguments -or
        -not [string]::Equals($action.WorkingDirectory, $launcher.WorkingDirectory, [StringComparison]::OrdinalIgnoreCase)) {
        return 'CONFLICT'
    }
    return 'INSTALLED'
}

function Install-RevitGptStartupTask([string]$LauncherPath) {
    if (-not (Test-RevitGptOwnedLauncher $LauncherPath)) { throw 'STARTUP_LAUNCHER_INVALID' }
    $state = Get-RevitGptStartupTaskStatus $LauncherPath
    if ($state -eq 'CONFLICT') { throw 'STARTUP_TASK_CONFLICT' }
    if ($state -eq 'UNAVAILABLE') { throw 'STARTUP_TASK_UNVERIFIABLE' }
    foreach ($cmd in @('Register-ScheduledTask', 'New-ScheduledTaskAction', 'New-ScheduledTaskTrigger',
                       'New-ScheduledTaskPrincipal', 'New-ScheduledTaskSettingsSet')) {
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "STARTUP_TASK_COMMAND_UNAVAILABLE: $cmd" }
    }
    $launcher = Get-RevitGptTaskLauncher $LauncherPath
    if (-not (Test-Path -LiteralPath $launcher.Execute -PathType Leaf)) { throw 'STARTUP_WSCRIPT_MISSING' }
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $action = New-ScheduledTaskAction -Execute $launcher.Execute -Argument $launcher.Arguments -WorkingDirectory $launcher.WorkingDirectory
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    try { $trigger.Delay = 'PT10S' } catch {}
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $script:RevitGptStartupTaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
    if ((Get-RevitGptStartupTaskStatus $LauncherPath) -ne 'INSTALLED') { throw 'STARTUP_TASK_READBACK_FAILED' }
}

function Remove-RevitGptStartupTask([string]$LauncherPath) {
    $state = Get-RevitGptStartupTaskStatus $LauncherPath
    if ($state -eq 'MISSING') { return }
    if ($state -ne 'INSTALLED') { throw "STARTUP_TASK_REMOVE_REFUSED: $state" }
    Unregister-ScheduledTask -TaskName $script:RevitGptStartupTaskName -Confirm:$false -ErrorAction Stop
    if ((Get-RevitGptStartupTaskStatus $LauncherPath) -ne 'MISSING') { throw 'STARTUP_TASK_REMOVE_READBACK_FAILED' }
}
