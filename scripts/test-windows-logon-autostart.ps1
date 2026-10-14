# Isolated Windows autorun E2E. Never writes the actual HKCU Run RevitGPT value.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "revitgpt-startup-registration.ps1")
function Assert([bool]$Condition, [string]$Why) {
    if (-not $Condition) { throw "TEST_FAILED: $Why" }
}
function Expect-Failure([scriptblock]$Operation, [string]$Code) {
    $failed = $false
    try { & $Operation | Out-Null } catch {
        $failed = $_.Exception.Message -match [regex]::Escape($Code)
    }
    Assert $failed "Expected failure $Code"
}
function Write-FakeOwnedCheckout([string]$Dir) {
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null
    Set-Content -LiteralPath (Join-Path $Dir "revitgpt-tray.vbs") -Encoding ASCII -Value "' RevitGPT silent tray launcher for Windows."
    Set-Content -LiteralPath (Join-Path $Dir "revitgpt-tray.ps1") -Encoding UTF8 -Value "# RevitGPT Windows tray host."
    return (Join-Path $Dir "revitgpt-tray.vbs")
}
$guid = [guid]::NewGuid().ToString("N")
$temp = Join-Path $env:TEMP ("rg autostart $guid")
$key = "HKCU:\Software\RevitGPT\AutostartTestRuns\$guid"
$oldLocalAppData = $env:LOCALAPPDATA
$oldMarker = $env:REVITGPT_AUTOSTART_TEST_MARKER
try {
    New-Item -ItemType Directory -Force -Path $temp | Out-Null
    $one = Write-FakeOwnedCheckout (Join-Path $temp "One checkout")
    $two = Write-FakeOwnedCheckout (Join-Path $temp "Two checkout")
    $initial = Get-RevitGptStartupRegistration -RegistryPath $key -LauncherPath $one
    Assert ($initial.Status -eq "MISSING") "fresh isolated Run value absent"

    $installed = Install-RevitGptStartupRegistration -RegistryPath $key -LauncherPath $one
    Assert ($installed.Status -eq "INSTALLED") "fresh install + readback"
    $before = (Get-ItemProperty -LiteralPath $key).RevitGPT
    $repeat = Install-RevitGptStartupRegistration -RegistryPath $key -LauncherPath $one
    Assert ($repeat.Status -eq "INSTALLED") "idempotent registration"
    Assert ((Get-ItemProperty -LiteralPath $key).RevitGPT -eq $before) "no changes on repeat"

    $other = Get-RevitGptStartupRegistration -RegistryPath $key -LauncherPath $two
    Assert ($other.Status -eq "OWNED_OTHER_CHECKOUT") "owned other checkout"
    Expect-Failure { Install-RevitGptStartupRegistration -RegistryPath $key -LauncherPath $two } "STARTUP_OWNED_MIGRATION_REQUIRES_APPROVAL"
    $migrated = Install-RevitGptStartupRegistration -RegistryPath $key -LauncherPath $two -AllowOwnedMigration
    Assert ($migrated.Status -eq "INSTALLED") "explicit owned migration"
    Expect-Failure { Remove-RevitGptStartupRegistration -RegistryPath $key -LauncherPath $one } "STARTUP_REMOVE_REFUSED"
    Assert ((Get-ItemProperty -LiteralPath $key).RevitGPT -eq $migrated.Expected) "old checkout cannot remove new owner"

    $foreign = 'notepad.exe'
    New-ItemProperty -Path $key -Name RevitGPT -Value $foreign -PropertyType String -Force | Out-Null
    Expect-Failure { Install-RevitGptStartupRegistration -RegistryPath $key -LauncherPath $one -AllowOwnedMigration } "STARTUP_REGISTRATION_CONFLICT"
    Expect-Failure { Remove-RevitGptStartupRegistration -RegistryPath $key -LauncherPath $one } "STARTUP_REMOVE_REFUSED"
    Assert ((Get-ItemProperty -LiteralPath $key).RevitGPT -eq $foreign) "foreign value preserved"

    New-ItemProperty -Path $key -Name RevitGPT -Value $migrated.Expected -PropertyType String -Force | Out-Null
    Remove-Item -LiteralPath $two -Force
    $stale = Get-RevitGptStartupRegistration -RegistryPath $key -LauncherPath $two
    Assert ($stale.Status -eq "STALE") "matching value but missing launcher"
    $null = Remove-RevitGptStartupRegistration -RegistryPath $key -LauncherPath $two
    Assert ((Get-RevitGptStartupRegistration -RegistryPath $key -LauncherPath $two).Status -eq "MISSING") "owned stale removal"

    $longPath = "C:\" + (("x" * 232) + "\revitgpt-tray.vbs")
    Expect-Failure { Get-RevitGptStartupCommand $longPath } "STARTUP_COMMAND_TOO_LONG"

    # Actual tracked VBS -> PowerShell using only a disposable fake tray script.
    $testDir = Join-Path $temp "VBS path with spaces"
    New-Item -ItemType Directory -Force -Path $testDir | Out-Null
    Copy-Item -LiteralPath (Join-Path $root "revitgpt-tray.vbs") -Destination (Join-Path $testDir "revitgpt-tray.vbs")
    $marker = Join-Path $temp "marker.txt"
    $env:LOCALAPPDATA = Join-Path $temp "isolated_appdata"
    $env:REVITGPT_AUTOSTART_TEST_MARKER = $marker
    $stub = @'
# RevitGPT Windows tray host.
[IO.File]::WriteAllText($env:REVITGPT_AUTOSTART_TEST_MARKER, "LAUNCHED")
'@
    Set-Content -LiteralPath (Join-Path $testDir "revitgpt-tray.ps1") -Value $stub -Encoding UTF8
    & cscript.exe //nologo (Join-Path $testDir "revitgpt-tray.vbs") | Out-Null
    Assert ($LASTEXITCODE -eq 0) "VBS dispatch"
    $deadline = (Get-Date).AddSeconds(12)
    while (-not (Test-Path -LiteralPath $marker) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 200
    }
    Assert (Test-Path -LiteralPath $marker) "stub PowerShell launched"
    Assert ((Get-Content -LiteralPath $marker -Raw).Trim() -eq "LAUNCHED") "stub marker"
    $launchLog = Join-Path $env:LOCALAPPDATA "RevitGPT\logs\startup-launch.log"
    $logDeadline = (Get-Date).AddSeconds(8)
    $launchText = ""
    do {
        if (Test-Path -LiteralPath $launchLog) {
            $launchText = Get-Content -LiteralPath $launchLog -Raw
        }
        if ($launchText -match 'wscript_invoked' -and $launchText -match 'powershell_dispatched') { break }
        Start-Sleep -Milliseconds 150
    } while ((Get-Date) -lt $logDeadline)
    Assert (Test-Path -LiteralPath $launchLog) "launcher log exists"
    Assert ($launchText -match 'wscript_invoked') "launcher invocation logged"
    Assert ($launchText -match 'powershell_dispatched') "dispatch logged"

    Remove-Item -LiteralPath (Join-Path $testDir "revitgpt-tray.ps1") -Force
    & cscript.exe //nologo (Join-Path $testDir "revitgpt-tray.vbs") | Out-Null
    Assert ($LASTEXITCODE -eq 3) "missing tray fails closed"
    Assert ((Get-Content $launchLog -Raw) -match 'startup_failed: TRAY_SCRIPT_MISSING') "launcher failure logged"

    # Execute the actual production Self-Heal function with fake health probes.
    $traySource = Get-Content -LiteralPath (Join-Path $root "revitgpt-tray.ps1") -Raw
    $m = [regex]::Match($traySource, '(?s)(function Self-Heal \{.*?\r?\n\})\r?\n\r?\n\$restartItem[.]Add_Click')
    Assert $m.Success "Self-Heal source boundary"
    $script:runtimeUp = $false
    $script:tunnelUp = $false
    $script:runtimeAttempts = 0
    $script:tunnelAttempts = 0
    $script:failureLog = @()
    function Get-RevitGptHealth { if ($script:runtimeUp) { return @{ status="ok"; name="revitgpt" } }; return $null }
    function Test-TunnelHealthy { return [bool]$script:tunnelUp }
    function Start-RevitGptRuntime {
        $script:runtimeAttempts++
        if ($script:runtimeAttempts -eq 1) { throw "dependency not ready" }
        $script:runtimeUp = $true
    }
    function Start-RevitGptTunnel { $script:tunnelAttempts++; $script:tunnelUp = $true }
    function Write-TrayLog([string]$Message) { $script:failureLog += $Message }
    Invoke-Expression $m.Groups[1].Value
    Self-Heal
    Assert ($script:runtimeAttempts -eq 1 -and -not $script:runtimeUp) "first failure"
    Assert ($script:failureLog.Count -eq 1) "failure logged"
    Self-Heal
    Assert ($script:runtimeAttempts -eq 2 -and $script:runtimeUp -and $script:tunnelUp) "delayed self heal"
    Self-Heal
    Assert ($script:runtimeAttempts -eq 2 -and $script:tunnelAttempts -eq 1) "no duplicate healthy startup"
    $script:tunnelUp = $false
    Self-Heal
    Assert ($script:runtimeAttempts -eq 2 -and $script:tunnelAttempts -eq 2) "recover tunnel only"

    Write-Host "[PASS] Windows logon: isolated registry, migration, collision, VBS launch, failure negative and delayed self-heal."
}
finally {
    $env:LOCALAPPDATA = $oldLocalAppData
    $env:REVITGPT_AUTOSTART_TEST_MARKER = $oldMarker
    Remove-Item -Path $key -Force -Recurse -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $temp -Force -Recurse -ErrorAction SilentlyContinue
}
