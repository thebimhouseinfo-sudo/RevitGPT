# Safe P1 regression: mocks Task Scheduler; isolated HKCU Registry test key only.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'revitgpt-startup-registration.ps1')
. (Join-Path $PSScriptRoot 'revitgpt-scheduled-startup.ps1')

function Assert([bool]$Condition, [string]$Why) {
    if (-not $Condition) { throw "TEST_FAILED: $Why" }
}
function Expect-Failure([scriptblock]$Operation, [string]$Code) {
    $found = $false
    try { & $Operation | Out-Null } catch { $found = $_.Exception.Message -match [regex]::Escape($Code) }
    Assert $found "Expected failure $Code"
}
function Write-OwnedCheckout([string]$Dir) {
    New-Item -Path $Dir -ItemType Directory -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $Dir 'revitgpt-tray.vbs') -Value "' RevitGPT silent tray launcher for Windows." -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $Dir 'revitgpt-tray.ps1') -Value '# RevitGPT Windows tray host.' -Encoding ASCII
    return (Join-Path $Dir 'revitgpt-tray.vbs')
}

# Shadow task cmdlets locally; NEVER touch the real scheduled task.
$script:mockTask = $null
$script:registeredCount = 0
$script:unregisteredCount = 0
$script:corruptOnRegister = $false
$script:throwOnRegister = $false
$script:mockLastResult = 0
$script:mockLastTime = (Get-Date).AddMinutes(-1)
function Get-ScheduledTask {
    [CmdletBinding()]
    param([string]$TaskName)
    Assert ($TaskName -eq 'RevitGPT Startup') 'only own Scheduled Task read'
    return $script:mockTask
}
function Get-ScheduledTaskInfo {
    [CmdletBinding()]
    param([string]$TaskName)
    Assert ($TaskName -eq 'RevitGPT Startup') 'only own Scheduled Task info read'
    return [pscustomobject]@{ LastRunTime=$script:mockLastTime; LastTaskResult=$script:mockLastResult }
}
function New-ScheduledTaskAction {
    param([string]$Execute, [string]$Argument, [string]$WorkingDirectory)
    return [pscustomobject]@{ Execute=$Execute; Arguments=$Argument; WorkingDirectory=$WorkingDirectory }
}
function New-ScheduledTaskTrigger {
    param([switch]$AtLogOn, [string]$User)
    Assert ($AtLogOn -and $User) 'logon trigger for user'
    return [pscustomobject]@{ Type='Logon'; UserId=$User; Delay=$null; Enabled=$true }
}
function New-ScheduledTaskPrincipal {
    param([string]$UserId, [string]$LogonType, [string]$RunLevel)
    Assert ($LogonType -eq 'Interactive' -and $RunLevel -eq 'Limited') 'interactive limited user'
    return [pscustomobject]@{ UserId=$UserId; LogonType=$LogonType; RunLevel=$RunLevel }
}
function New-ScheduledTaskSettingsSet {
    param([switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries,
          [switch]$StartWhenAvailable, [string]$MultipleInstances)
    Assert ($MultipleInstances -eq 'IgnoreNew') 'IgnoreNew'
    return [pscustomobject]@{ MultipleInstances=$MultipleInstances; Enabled=$true }
}
function Register-ScheduledTask {
    [CmdletBinding()]
    param([string]$TaskName, $Action, $Trigger, $Principal, $Settings, [switch]$Force)
    Assert ($TaskName -eq 'RevitGPT Startup') 'own task only'
    Assert $Force 'safe verified task update'
    Assert ($Trigger.Delay -eq 'PT10S') '10-second delayed logon trigger'
    if ($script:throwOnRegister) { throw 'SIMULATED_SCHEDULER_UNAVAILABLE' }
    $script:registeredCount++
    $actualAction = if ($script:corruptOnRegister) {
        [pscustomobject]@{ Execute='notepad.exe'; Arguments=''; WorkingDirectory='' }
    } else { $Action }
    $script:mockTask = [pscustomobject]@{
        Actions=@($actualAction); Triggers=@($Trigger); Principal=$Principal; Settings=$Settings; State='Ready'
    }
    return $script:mockTask
}
function Unregister-ScheduledTask {
    [CmdletBinding()]
    param([string]$TaskName, [switch]$Confirm)
    Assert ($TaskName -eq 'RevitGPT Startup') 'own task removal'
    $script:unregisteredCount++
    $script:mockTask = $null
}

$dir = Join-Path $env:TEMP ('rg-startup-hardening-' + [guid]::NewGuid().ToString('N'))
$key = "HKCU:\Software\RevitGPT\AutostartTestRuns\$([guid]::NewGuid().ToString('N'))"
try {
    $launcher = Write-OwnedCheckout (Join-Path $dir 'current checkout')
    $oldLauncher = Write-OwnedCheckout (Join-Path $dir 'old checkout')
    Assert ((Get-RevitGptStartupTaskStatus $launcher) -eq 'MISSING') 'missing task'
    Install-RevitGptStartupTask -LauncherPath $launcher
    Assert ((Get-RevitGptStartupTaskStatus $launcher) -eq 'INSTALLED') 'valid action, trigger, principal and settings'
    Assert ($script:registeredCount -eq 1) 'one registration'
    $expected = Get-RevitGptTaskLauncher $launcher
    Assert (Test-RevitGptSamePath $script:mockTask.Actions[0].Execute $expected.Execute) 'wscript executable'
    Assert ($script:mockTask.Actions[0].Arguments -eq $expected.Arguments) 'quoted checkout VBS'
    Assert (Test-RevitGptSamePath $script:mockTask.Actions[0].WorkingDirectory $expected.WorkingDirectory) 'working directory'
    Assert ($script:mockTask.Triggers[0].Delay -eq 'PT10S') 'delay'
    Assert ($script:mockTask.Principal.LogonType -eq 'Interactive') 'principal interactive'
    Assert ($script:mockTask.Settings.MultipleInstances -eq 'IgnoreNew') 'no task duplicate'
    $info = Get-RevitGptStartupTaskDiagnostics $launcher
    Assert ($info.LastTaskResult -eq 0 -and $info.LastRunTime) 'read last task result and last run time'
    Install-RevitGptStartupTask -LauncherPath $launcher
    Assert ($script:registeredCount -eq 1) 'reinstall idempotent'

    # Owned task with invalid trigger, principal, state, or settings can be repaired.
    $script:mockTask.Triggers[0].UserId = 'invalid-user'
    Assert ((Get-RevitGptTaskSnapshot $launcher).Reason -match 'LOGON_USER_INVALID') 'detect wrong trigger user'
    Install-RevitGptStartupTask -LauncherPath $launcher
    Assert ((Get-RevitGptStartupTaskStatus $launcher) -eq 'INSTALLED') 'repair trigger'
    $script:mockTask.Principal.LogonType = 'Password'
    Assert ((Get-RevitGptTaskSnapshot $launcher).Reason -match 'PRINCIPAL_LOGON_INVALID') 'detect principal type'
    Install-RevitGptStartupTask -LauncherPath $launcher
    $script:mockTask.Settings.MultipleInstances = 'Parallel'
    Assert ((Get-RevitGptTaskSnapshot $launcher).Reason -match 'MULTIPLE_INSTANCES_INVALID') 'detect parallel tasks'
    Install-RevitGptStartupTask -LauncherPath $launcher
    $script:mockTask.State = 'Disabled'
    Assert ((Get-RevitGptTaskSnapshot $launcher).Reason -match 'TASK_DISABLED') 'detect disabled task'
    Install-RevitGptStartupTask -LauncherPath $launcher
    Assert ((Get-RevitGptStartupTaskStatus $launcher) -eq 'INSTALLED') 'repair task'
    $script:mockTask.Triggers[0].Type = 'Daily'
    Assert ((Get-RevitGptTaskSnapshot $launcher).Reason -match 'LOGON_TRIGGER_INVALID') 'reject schedule other than logon'
    Install-RevitGptStartupTask -LauncherPath $launcher
    $script:mockTask.Principal.UserId = 'other-user'
    Assert ((Get-RevitGptTaskSnapshot $launcher).Reason -match 'PRINCIPAL_USER_INVALID') 'detect foreign principal'
    Install-RevitGptStartupTask -LauncherPath $launcher

    # The previous RevitGPT checkout is owned, but migration requires approval.
    $script:mockTask.Actions[0].Arguments = '"' + $oldLauncher + '"'
    Assert ((Get-RevitGptStartupTaskStatus $launcher) -eq 'OWNED_OTHER_CHECKOUT') 'old checkout owned'
    Expect-Failure { Install-RevitGptStartupTask -LauncherPath $launcher } 'STARTUP_TASK_MIGRATION_REQUIRES_APPROVAL'
    Install-RevitGptStartupTask -LauncherPath $launcher -AllowOwnedMigration
    Assert ((Get-RevitGptStartupTaskStatus $launcher) -eq 'INSTALLED') 'approved owned migration'

    # Never modify a foreign task, even with the same Windows task name.
    $script:mockTask.Actions[0].Execute = 'notepad.exe'
    Assert ((Get-RevitGptStartupTaskStatus $launcher) -eq 'CONFLICT') 'foreign task detected'
    $beforeCount = $script:registeredCount
    Expect-Failure { Install-RevitGptStartupTask -LauncherPath $launcher -AllowOwnedMigration } 'STARTUP_TASK_CONFLICT'
    Expect-Failure { Remove-RevitGptStartupTask $launcher } 'STARTUP_TASK_REMOVE_REFUSED'
    Assert ($script:registeredCount -eq $beforeCount) 'foreign task not overwritten'

    $script:mockTask = $null
    $script:corruptOnRegister = $true
    Expect-Failure { Install-RevitGptStartupTask -LauncherPath $launcher } 'STARTUP_TASK_READBACK_FAILED'
    $script:corruptOnRegister = $false
    $script:mockTask = $null

    # Exercise the production install/fallback logic with real isolated registry
    # functions, mocked task service, and sentinel entries for other applications.
    $traySource = Get-Content -LiteralPath (Join-Path $root 'revitgpt-tray.ps1') -Raw
    $m = [regex]::Match($traySource, '(?s)(function Install-StartupRegistration \{.*?\r?\n\})\r?\n\r?\nfunction Remove-StartupRegistration')
    Assert $m.Success 'production startup flow extractable'
    Invoke-Expression $m.Groups[1].Value
    $StartupKey = $key
    $StartupName = 'RevitGPT'
    $TrayLauncherPath = $launcher
    # -Force is confined to this unique disposable test key, never the real Run key.
    New-Item -Path $key -Force -ErrorAction Stop | Out-Null
    New-ItemProperty -Path $key -Name CadGPT -Value 'cadgpt-preserve' -PropertyType String | Out-Null
    New-ItemProperty -Path $key -Name GPTWorker -Value 'worker-preserve' -PropertyType String | Out-Null
    New-ItemProperty -Path $key -Name OtherApp -Value 42 -PropertyType DWord | Out-Null
    function Assert-Siblings {
        $values = Get-ItemProperty -LiteralPath $key
        Assert ($values.CadGPT -eq 'cadgpt-preserve') 'CadGPT value preserved'
        Assert ($values.GPTWorker -eq 'worker-preserve') 'GPTWorker value preserved'
        Assert ($values.OtherApp -eq 42) 'OtherApp preserved'
        Assert ((Get-Item -LiteralPath $key).GetValueKind('OtherApp').ToString() -eq 'DWord') 'OtherApp type preserved'
    }
    $script:throwOnRegister = $true
    Install-StartupRegistration | Out-Null
    Assert ((Get-RevitGptStartupRegistration -RegistryPath $key -LauncherPath $launcher).Status -eq 'INSTALLED') 'registry fallback installed'
    Assert ((Get-RevitGptStartupTaskStatus $launcher) -eq 'MISSING') 'no duplicate task with fallback'
    Assert-Siblings

    $script:throwOnRegister = $false
    Install-StartupRegistration | Out-Null
    Assert ((Get-RevitGptStartupTaskStatus $launcher) -eq 'INSTALLED') 'primary task after scheduler recovered'
    Assert ((Get-RevitGptStartupRegistration -RegistryPath $key -LauncherPath $launcher).Status -eq 'MISSING') 'only RevitGPT Run value removed'
    Assert-Siblings
    Install-StartupRegistration | Out-Null
    Assert-Siblings
    Assert ((Get-RevitGptStartupTaskStatus $launcher) -eq 'INSTALLED') 'repeated install'

    $script:mockTask.Actions[0].Execute = 'notepad.exe'
    Expect-Failure { Install-StartupRegistration } 'STARTUP_TASK_UNSAFE'
    Assert ((Get-RevitGptStartupRegistration -RegistryPath $key -LauncherPath $launcher).Status -eq 'MISSING') 'no unsafe fallback on foreign task'
    Assert-Siblings

    # A locked log must not terminate the tray: exercise real production function.
    $logMatch = [regex]::Match($traySource, '(?s)(function Write-TrayLog\(\[string\]\$Message\) \{.*?\r?\n\})')
    Assert $logMatch.Success 'logging implementation extractable'
    Invoke-Expression $logMatch.Groups[1].Value
    $TrayLog = Join-Path $dir 'locked.log'
    [IO.File]::WriteAllText($TrayLog, 'occupied')
    $lock = [IO.File]::Open($TrayLog, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try { Write-TrayLog 'test locked log' } finally { $lock.Dispose() }
    Assert ((Get-Content $TrayLog -Raw) -eq 'occupied') 'locked log does not cause crash or corruption'

    foreach ($stage in @('powershell_entered','preflight_verified','mutex_acquired','tray_initialized',
                          'runtime_started','runtime_failed','tunnel_started','tunnel_failed')) {
        Assert ($traySource.Contains("Set-StartupStage '$stage'")) "trace stage $stage"
    }
    Assert ($traySource.Contains('Local\RevitGPTTray')) 'existing tray mutex retained'
    Write-Host '[PASS] RevitGPT autostart: task ownership, trigger, principal, settings, migration, diagnostics, fallback, coexistence, log failure.'
} finally {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $key -Recurse -Force -ErrorAction SilentlyContinue
}
