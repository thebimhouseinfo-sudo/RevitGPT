# RevitGPT per-user Windows logon registration. No executable is launched here.
# Callers supply the HKCU key for isolated tests; production always supplies HKCU Run.

function Get-RevitGptStartupCommand([string]$LauncherPath) {
    if ([string]::IsNullOrWhiteSpace($LauncherPath)) { throw "STARTUP_LAUNCHER_PATH_REQUIRED" }
    $full = [IO.Path]::GetFullPath($LauncherPath)
    if ($full.Contains('"')) { throw "STARTUP_PATH_INVALID" }
    $command = 'wscript.exe "' + $full + '"'
    # Windows Run/RunOnce values have a documented 260-character command limit.
    if ($command.Length -gt 260) { throw "STARTUP_COMMAND_TOO_LONG" }
    return $command
}

function Test-RevitGptOwnedLauncher([string]$LauncherPath) {
    try {
        if (-not (Test-Path -LiteralPath $LauncherPath -PathType Leaf)) { return $false }
        $ps = Join-Path (Split-Path -Parent $LauncherPath) 'revitgpt-tray.ps1'
        if (-not (Test-Path -LiteralPath $ps -PathType Leaf)) { return $false }
        $launcherHead = Get-Content -LiteralPath $LauncherPath -TotalCount 5 -ErrorAction Stop | Out-String
        $psHead = Get-Content -LiteralPath $ps -TotalCount 5 -ErrorAction Stop | Out-String
        return ($launcherHead.Contains('RevitGPT silent tray launcher for Windows') -and
            $psHead.Contains('RevitGPT Windows tray host'))
    } catch { return $false }
}

function Get-RevitGptStartupRegistration {
    param(
        [Parameter(Mandatory=$true)][string]$RegistryPath,
        [Parameter(Mandatory=$true)][string]$LauncherPath,
        [string]$Name = 'RevitGPT'
    )
    $expected = Get-RevitGptStartupCommand $LauncherPath
    $full = [IO.Path]::GetFullPath($LauncherPath)
    $exists = Test-Path -LiteralPath $RegistryPath
    $value = $null
    if ($exists) {
        try {
            $key = Get-ItemProperty -LiteralPath $RegistryPath -ErrorAction Stop
            $field = $key.PSObject.Properties[$Name]
            if ($null -ne $field) { $value = [string]$field.Value }
        } catch {
            return [pscustomobject]@{ Status='UNVERIFIED'; Reason='REGISTRY_UNREADABLE'; Value=$null; Expected=$expected }
        }
    }
    if ([string]::IsNullOrEmpty($value)) {
        return [pscustomobject]@{ Status='MISSING'; Reason='VALUE_ABSENT'; Value=$null; Expected=$expected }
    }
    if ([string]::Equals($value, $expected, [StringComparison]::OrdinalIgnoreCase)) {
        $ok = Test-RevitGptOwnedLauncher $full
        return [pscustomobject]@{
            Status= $(if ($ok) { 'INSTALLED' } else { 'STALE' })
            Reason= $(if ($ok) { 'OWNED_LAUNCHER_PRESENT' } else { 'EXPECTED_LAUNCHER_MISSING_OR_INVALID' })
            Value=$value; Expected=$expected
        }
    }
    # A different RevitGPT installation is recognized only by the actual
    # launcher + companion source marker, never by filename alone.
    $m = [regex]::Match($value, '^wscript(?:[.]exe)?\s+"([^"]+\\revitgpt-tray[.]vbs)"$', 'IgnoreCase')
    if ($m.Success) {
        $previousLauncher = $m.Groups[1].Value
        if (Test-RevitGptOwnedLauncher $previousLauncher) {
            return [pscustomobject]@{ Status='OWNED_OTHER_CHECKOUT'; Reason='MANUAL_MIGRATION_REQUIRED'; Value=$value; Expected=$expected }
        }
        if (-not (Test-Path -LiteralPath $previousLauncher)) {
            # Exact RevitGPT-named Run launcher now absent: repair only after
            # explicit runtime install, not from a read/status probe.
            return [pscustomobject]@{ Status='STALE_OTHER_CHECKOUT'; Reason='MISSING_OLD_LAUNCHER_REQUIRES_EXPLICIT_INSTALL'; Value=$value; Expected=$expected }
        }
        return [pscustomobject]@{ Status='CONFLICT'; Reason='UNVERIFIED_OTHER_LAUNCHER'; Value=$value; Expected=$expected }
    }
    return [pscustomobject]@{ Status='CONFLICT'; Reason='FOREIGN_VALUE'; Value=$value; Expected=$expected }
}

function Install-RevitGptStartupRegistration {
    param(
        [Parameter(Mandatory=$true)][string]$RegistryPath,
        [Parameter(Mandatory=$true)][string]$LauncherPath,
        [string]$Name = 'RevitGPT',
        [switch]$AllowOwnedMigration,
        [switch]$AllowStaleMigration
    )
    if (-not (Test-RevitGptOwnedLauncher $LauncherPath)) { throw 'STARTUP_LAUNCHER_INVALID' }
    $before = Get-RevitGptStartupRegistration -RegistryPath $RegistryPath -LauncherPath $LauncherPath -Name $Name
    if ($before.Status -eq 'INSTALLED') { return $before }
    if ($before.Status -eq 'CONFLICT' -or $before.Status -eq 'UNVERIFIED') {
        throw ('STARTUP_REGISTRATION_' + $before.Status + ': ' + $before.Reason)
    }
    if ($before.Status -eq 'OWNED_OTHER_CHECKOUT' -and -not $AllowOwnedMigration) {
        throw 'STARTUP_OWNED_MIGRATION_REQUIRES_APPROVAL'
    }
    if ($before.Status -eq 'STALE_OTHER_CHECKOUT' -and -not $AllowStaleMigration) {
        throw 'STARTUP_STALE_MIGRATION_REQUIRES_APPROVAL'
    }
    if ($before.Status -notin @('MISSING','STALE','OWNED_OTHER_CHECKOUT','STALE_OTHER_CHECKOUT')) {
        throw ('STARTUP_STATE_UNSUPPORTED: ' + $before.Status)
    }
    $hadValue = ($null -ne $before.Value)
    try {
        New-Item -Path $RegistryPath -Force | Out-Null
        New-ItemProperty -Path $RegistryPath -Name $Name -Value $before.Expected -PropertyType String -Force -ErrorAction Stop | Out-Null
        $after = Get-RevitGptStartupRegistration -RegistryPath $RegistryPath -LauncherPath $LauncherPath -Name $Name
        if ($after.Status -ne 'INSTALLED') { throw ('STARTUP_READBACK_FAILED: ' + $after.Status) }
        return $after
    } catch {
        # Restore the exact prior value after partial registry mutation.
        if ($hadValue) {
            New-ItemProperty -Path $RegistryPath -Name $Name -Value $before.Value -PropertyType String -Force -ErrorAction Stop | Out-Null
        } else {
            Remove-ItemProperty -LiteralPath $RegistryPath -Name $Name -ErrorAction SilentlyContinue
        }
        throw
    }
}

function Remove-RevitGptStartupRegistration {
    param(
        [Parameter(Mandatory=$true)][string]$RegistryPath,
        [Parameter(Mandatory=$true)][string]$LauncherPath,
        [string]$Name = 'RevitGPT'
    )
    $before = Get-RevitGptStartupRegistration -RegistryPath $RegistryPath -LauncherPath $LauncherPath -Name $Name
    if ($before.Status -eq 'MISSING') { return $before }
    if ($before.Status -notin @('INSTALLED','STALE')) {
        throw ('STARTUP_REMOVE_REFUSED: ' + $before.Status)
    }
    Remove-ItemProperty -LiteralPath $RegistryPath -Name $Name -ErrorAction Stop
    $after = Get-RevitGptStartupRegistration -RegistryPath $RegistryPath -LauncherPath $LauncherPath -Name $Name
    if ($after.Status -ne 'MISSING') { throw 'STARTUP_REMOVE_READBACK_FAILED' }
    return $after
}
