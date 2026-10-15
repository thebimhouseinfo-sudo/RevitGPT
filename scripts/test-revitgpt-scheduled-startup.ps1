# Task Scheduler stub tests: never register or remove a real Windows task.
$ErrorActionPreference = 'Stop'
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

# Override all ScheduledTasks commands locally: no system task mutations.
$script:mockTask = $null
$script:registeredCount = 0
$script:unregisteredCount = 0
$script:corruptOnRegister = $false
function Get-ScheduledTask {
    [CmdletBinding()]
    param([string]$TaskName)
    Assert ($TaskName -eq 'RevitGPT Startup') "own task name only"
    return $script:mockTask
}
function New-ScheduledTaskAction {
    param([string]$Execute, [string]$Argument, [string]$WorkingDirectory)
    return [pscustomobject]@{ Execute=$Execute; Arguments=$Argument; WorkingDirectory=$WorkingDirectory }
}
function New-ScheduledTaskTrigger {
    param([switch]$AtLogOn, [string]$User)
    Assert ($AtLogOn -and -not [string]::IsNullOrEmpty($User)) "per-user logon trigger"
    return [pscustomobject]@{ Delay=$null }
}
function New-ScheduledTaskPrincipal {
    param([string]$UserId, [string]$LogonType, [string]$RunLevel)
    Assert ($LogonType -eq 'Interactive' -and $RunLevel -eq 'Limited') "interactive non-admin user"
    return [pscustomobject]@{ UserId=$UserId }
}
function New-ScheduledTaskSettingsSet {
    param([switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries,
          [switch]$StartWhenAvailable, [string]$MultipleInstances)
    Assert ($MultipleInstances -eq 'IgnoreNew') "duplicate task instance suppressed"
    return [pscustomobject]@{}
}
function Register-ScheduledTask {
    [CmdletBinding()]
    param([string]$TaskName, $Action, $Trigger, $Principal, $Settings, [switch]$Force)
    Assert ($TaskName -eq 'RevitGPT Startup') "registration owns only RevitGPT task"
    Assert ($Trigger.Delay -eq 'PT10S') "delayed logon trigger"
    Assert $Force "update same named task"
    $script:registeredCount++
    $registeredAction = if ($script:corruptOnRegister) {
        [pscustomobject]@{ Execute='notepad.exe'; Arguments=''; WorkingDirectory='' }
    } else { $Action }
    $script:mockTask = [pscustomobject]@{ Actions=@($registeredAction); State='Ready' }
    return $script:mockTask
}
function Unregister-ScheduledTask {
    [CmdletBinding()]
    param([string]$TaskName, [switch]$Confirm)
    Assert ($TaskName -eq 'RevitGPT Startup') "unregister owns only RevitGPT task"
    $script:unregisteredCount++
    $script:mockTask = $null
}

$dir = Join-Path $env:TEMP ('revitgpt-task-test-' + [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $dir -ErrorAction Stop | Out-Null
    $launcher = Join-Path $dir 'revitgpt-tray.vbs'
    Set-Content -LiteralPath $launcher -Value "' RevitGPT silent tray launcher for Windows." -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $dir 'revitgpt-tray.ps1') -Value '# RevitGPT Windows tray host.' -Encoding ASCII

    Assert ((Get-RevitGptStartupTaskStatus $launcher) -eq 'MISSING') 'initial task missing'
    Install-RevitGptStartupTask $launcher
    Assert ((Get-RevitGptStartupTaskStatus $launcher) -eq 'INSTALLED') 'scheduled task readback'
    Assert ($script:registeredCount -eq 1) 'task registration once'
    $expected = Get-RevitGptTaskLauncher $launcher
    Assert ($script:mockTask.Actions[0].Execute -eq $expected.Execute) 'wscript rather than PowerShell task action'
    Assert ($script:mockTask.Actions[0].Arguments -eq $expected.Arguments) 'quoted VBS path'
    Assert ($script:mockTask.Actions[0].WorkingDirectory -eq $dir) 'correct working directory'

    Install-RevitGptStartupTask $launcher
    Assert ((Get-RevitGptStartupTaskStatus $launcher) -eq 'INSTALLED') 'reinstall idempotent'
    Remove-RevitGptStartupTask $launcher
    Assert ((Get-RevitGptStartupTaskStatus $launcher) -eq 'MISSING') 'task removed'
    Assert ($script:unregisteredCount -eq 1) 'only one uninstall action'

    $script:mockTask = [pscustomobject]@{
        Actions=@([pscustomobject]@{ Execute='notepad.exe'; Arguments=''; WorkingDirectory='' })
        State='Ready'
    }
    Expect-Failure { Install-RevitGptStartupTask $launcher } 'STARTUP_TASK_CONFLICT'
    Expect-Failure { Remove-RevitGptStartupTask $launcher } 'STARTUP_TASK_REMOVE_REFUSED'
    Assert ($script:mockTask.Actions[0].Execute -eq 'notepad.exe') 'foreign task untouched'

    $script:mockTask = $null
    $script:corruptOnRegister = $true
    Expect-Failure { Install-RevitGptStartupTask $launcher } 'STARTUP_TASK_READBACK_FAILED'
    Write-Host '[PASS] RevitGPT task: silent wscript action, delay, interactive logon, idempotence, foreign-task protection, readback red control.'
} finally {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
