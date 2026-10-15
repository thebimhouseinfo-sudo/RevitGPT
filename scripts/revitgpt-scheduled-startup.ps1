# RevitGPT Windows startup: one verified Scheduled Task, or HKCU Run fallback.
$script:RevitGptStartupTaskName = 'RevitGPT Startup'

function Get-RevitGptTaskLauncher([string]$LauncherPath) {
    return [pscustomobject]@{
        Execute = Join-Path $env:WINDIR 'System32\wscript.exe'
        Arguments = '"' + [IO.Path]::GetFullPath($LauncherPath) + '"'
        WorkingDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($LauncherPath))
    }
}

function Test-RevitGptSamePath([string]$Left, [string]$Right) {
    if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) { return $false }
    try {
        return [string]::Equals(
            [IO.Path]::GetFullPath($Left).TrimEnd('\'),
            [IO.Path]::GetFullPath($Right).TrimEnd('\'),
            [StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}

function Test-RevitGptTaskUser([string]$Actual) {
    if ([string]::IsNullOrWhiteSpace($Actual)) { return $false }
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if ([string]::Equals($Actual, $identity.Name, [StringComparison]::OrdinalIgnoreCase) -or
        [string]::Equals($Actual, $identity.User.Value, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    try {
        $sid = (New-Object System.Security.Principal.NTAccount($Actual)).Translate([System.Security.Principal.SecurityIdentifier])
        return ($sid.Value -eq $identity.User.Value)
    } catch { return $false }
}

function Get-RevitGptTaskSnapshot([string]$LauncherPath) {
    if (-not (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) {
        return [pscustomobject]@{ Status='UNAVAILABLE'; Reason='TASK_SCHEDULER_UNAVAILABLE'; Task=$null }
    }
    try {
        $task = Get-ScheduledTask -TaskName $script:RevitGptStartupTaskName -ErrorAction Stop
    } catch {
        if ($_.CategoryInfo.Category -eq [System.Management.Automation.ErrorCategory]::ObjectNotFound -or
            $_.FullyQualifiedErrorId -match 'NoMatchingMSFT_TaskObjectsFound|ObjectNotFound') {
            return [pscustomobject]@{ Status='MISSING'; Reason='TASK_NOT_FOUND'; Task=$null }
        }
        return [pscustomobject]@{ Status='UNAVAILABLE'; Reason='TASK_QUERY_FAILED'; Task=$null }
    }
    if (-not $task) {
        return [pscustomobject]@{ Status='MISSING'; Reason='TASK_NOT_FOUND'; Task=$null }
    }
    $actions = @($task.Actions)
    if ($actions.Count -ne 1) {
        return [pscustomobject]@{ Status='CONFLICT'; Reason='UNVERIFIED_ACTIONS'; Task=$task }
    }
    $action = $actions[0]
    $expected = Get-RevitGptTaskLauncher $LauncherPath
    if (-not (Test-RevitGptSamePath $action.Execute $expected.Execute)) {
        return [pscustomobject]@{ Status='CONFLICT'; Reason='FOREIGN_EXECUTABLE'; Task=$task }
    }
    $match = [regex]::Match([string]$action.Arguments, '^"([^"]+\\revitgpt-tray[.]vbs)"$', 'IgnoreCase')
    if (-not $match.Success) {
        return [pscustomobject]@{ Status='CONFLICT'; Reason='UNVERIFIED_ARGUMENTS'; Task=$task }
    }
    $registeredVbs = $match.Groups[1].Value
    if (-not (Test-RevitGptOwnedLauncher $registeredVbs)) {
        return [pscustomobject]@{ Status='CONFLICT'; Reason='UNVERIFIED_CHECKOUT_OWNER'; Task=$task }
    }
    if (-not (Test-RevitGptSamePath $registeredVbs $LauncherPath)) {
        return [pscustomobject]@{ Status='OWNED_OTHER_CHECKOUT'; Reason='MIGRATION_REQUIRES_APPROVAL'; Task=$task }
    }
    $reasons = @()
    if (-not (Test-RevitGptSamePath $action.WorkingDirectory $expected.WorkingDirectory)) {
        $reasons += 'WORKING_DIRECTORY_INVALID'
    }
    if ([string]$task.State -eq 'Disabled' -or $task.Settings.Enabled -eq $false) {
        $reasons += 'TASK_DISABLED'
    }
    $triggers = @($task.Triggers)
    if ($triggers.Count -ne 1) {
        $reasons += 'TRIGGER_COUNT_INVALID'
    } else {
        $trigger = $triggers[0]
        $kind = [string]$trigger.CimClass.CimClassName
        if ($kind -ne 'MSFT_TaskLogonTrigger' -and [string]$trigger.Type -ne 'Logon') { $reasons += 'LOGON_TRIGGER_INVALID' }
        if (-not (Test-RevitGptTaskUser ([string]$trigger.UserId))) { $reasons += 'LOGON_USER_INVALID' }
        if ([string]$trigger.Delay -ne 'PT10S') { $reasons += 'LOGON_DELAY_INVALID' }
        if ($trigger.Enabled -eq $false) { $reasons += 'TRIGGER_DISABLED' }
    }
    $principal = $task.Principal
    if (-not $principal -or -not (Test-RevitGptTaskUser ([string]$principal.UserId))) {
        $reasons += 'PRINCIPAL_USER_INVALID'
    }
    if (-not $principal -or [string]$principal.LogonType -ne 'Interactive') {
        $reasons += 'PRINCIPAL_LOGON_INVALID'
    }
    if (-not $principal -or [string]$principal.RunLevel -ne 'Limited') {
        $reasons += 'PRINCIPAL_RUNLEVEL_INVALID'
    }
    if (-not $task.Settings -or [string]$task.Settings.MultipleInstances -ne 'IgnoreNew') {
        $reasons += 'MULTIPLE_INSTANCES_INVALID'
    }
    if ($reasons.Count -gt 0) {
        return [pscustomobject]@{ Status='OWNED_NEEDS_REPAIR'; Reason=($reasons -join ','); Task=$task }
    }
    return [pscustomobject]@{ Status='INSTALLED'; Reason='VERIFIED_USER_LOGON_TASK'; Task=$task }
}

function Get-RevitGptStartupTaskStatus([string]$LauncherPath) {
    return (Get-RevitGptTaskSnapshot $LauncherPath).Status
}

function Install-RevitGptStartupTask {
    param([string]$LauncherPath, [switch]$AllowOwnedMigration)
    if (-not (Test-RevitGptOwnedLauncher $LauncherPath)) { throw 'STARTUP_LAUNCHER_INVALID' }
    $before = Get-RevitGptTaskSnapshot $LauncherPath
    if ($before.Status -eq 'INSTALLED') { return }
    if ($before.Status -eq 'OWNED_OTHER_CHECKOUT' -and -not $AllowOwnedMigration) {
        throw 'STARTUP_TASK_MIGRATION_REQUIRES_APPROVAL'
    }
    if ($before.Status -notin @('MISSING','OWNED_NEEDS_REPAIR','OWNED_OTHER_CHECKOUT')) {
        throw ("STARTUP_TASK_" + $before.Status + ': ' + $before.Reason)
    }
    foreach ($cmd in @('Register-ScheduledTask','New-ScheduledTaskAction','New-ScheduledTaskTrigger',
                       'New-ScheduledTaskPrincipal','New-ScheduledTaskSettingsSet')) {
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "STARTUP_TASK_COMMAND_UNAVAILABLE: $cmd" }
    }
    $launcher = Get-RevitGptTaskLauncher $LauncherPath
    if (-not (Test-Path -LiteralPath $launcher.Execute -PathType Leaf)) { throw 'STARTUP_WSCRIPT_MISSING' }
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $action = New-ScheduledTaskAction -Execute $launcher.Execute -Argument $launcher.Arguments -WorkingDirectory $launcher.WorkingDirectory
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $trigger.Delay = 'PT10S'
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $script:RevitGptStartupTaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
    $after = Get-RevitGptTaskSnapshot $LauncherPath
    if ($after.Status -ne 'INSTALLED') { throw "STARTUP_TASK_READBACK_FAILED: $($after.Status) $($after.Reason)" }
}

function Remove-RevitGptStartupTask([string]$LauncherPath) {
    $state = Get-RevitGptStartupTaskStatus $LauncherPath
    if ($state -eq 'MISSING') { return }
    if ($state -notin @('INSTALLED','OWNED_NEEDS_REPAIR')) { throw "STARTUP_TASK_REMOVE_REFUSED: $state" }
    Unregister-ScheduledTask -TaskName $script:RevitGptStartupTaskName -Confirm:$false -ErrorAction Stop
    if ((Get-RevitGptStartupTaskStatus $LauncherPath) -ne 'MISSING') { throw 'STARTUP_TASK_REMOVE_READBACK_FAILED' }
}

function Get-RevitGptStartupTaskDiagnostics([string]$LauncherPath) {
    $snapshot = Get-RevitGptTaskSnapshot $LauncherPath
    $lastTime = $null
    $lastResult = $null
    if ($snapshot.Task -and (Get-Command Get-ScheduledTaskInfo -ErrorAction SilentlyContinue)) {
        try {
            $info = Get-ScheduledTaskInfo -TaskName $script:RevitGptStartupTaskName -ErrorAction Stop
            $lastTime = $info.LastRunTime
            $lastResult = $info.LastTaskResult
        } catch {}
    }
    return [pscustomobject]@{
        Status=$snapshot.Status
        Reason=$snapshot.Reason
        LastRunTime=$lastTime
        LastTaskResult=$lastResult
    }
}
