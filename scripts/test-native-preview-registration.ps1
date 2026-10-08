# Execute ONLY on Windows CI with a disposable env:APPDATA and env:ProgramData.
# Never touches the real user's Autodesk/Revit manifests.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$scriptPath = Join-Path $PSScriptRoot "manage-native-revitgpt-preview.ps1"
$repoRoot = Split-Path -Parent $PSScriptRoot
$package = Join-Path $repoRoot "artifacts\RevitGPT.Native.2024.preview"
$temp = Join-Path ([IO.Path]::GetTempPath()) ("RevitGPT-manifest-e2e-" + [Guid]::NewGuid().ToString("N"))
$saveApp = $env:APPDATA
$saveProgram = $env:ProgramData
$saveLocal = $env:LOCALAPPDATA
function Assert([bool]$state, [string]$message) { if (-not $state) { throw $message } }
function Must-Fail([scriptblock]$action, [string]$why) {
    $failed = $false
    try { & $action } catch { $failed = $true }
    Assert $failed $why
}
try {
    New-Item -ItemType Directory -Path $temp -Force | Out-Null
    $env:APPDATA = Join-Path $temp "AppData"
    $env:ProgramData = Join-Path $temp "ProgramData"
    $env:LOCALAPPDATA = Join-Path $temp "LocalAppData"
    New-Item -ItemType Directory -Path $env:APPDATA,$env:ProgramData,$env:LOCALAPPDATA -Force | Out-Null
    $manifestDir = Join-Path $env:APPDATA "Autodesk\Revit\Addins\2024"
    $machineDir = Join-Path $env:ProgramData "Autodesk\Revit\Addins\2024"
    $manifest = Join-Path $manifestDir "RevitGPT.preview.addin"
    Must-Fail { & $scriptPath -Action Install -PackageDirectory $package } "Install without approval must fail"
    Assert (-not (Test-Path $manifest)) "Install without approval wrote a manifest"
    & $scriptPath -Action Validate -PackageDirectory $package
    & $scriptPath -Action Install -PackageDirectory $package -ApproveHostChange
    Assert (Test-Path -LiteralPath $manifest -PathType Leaf) "Preview manifest not registered"
    [xml]$xml = Get-Content -LiteralPath $manifest -Raw
    Assert ($xml.RevitAddIns.AddIn.FullClassName -eq "RevitGPT.Native.RevitGptApplication") "Wrong host class"
    Must-Fail { & $scriptPath -Action Install -PackageDirectory $package -ApproveHostChange } "Repeated install overwrote manifest"
    & $scriptPath -Action Uninstall -ApproveHostChange -PackageDirectory $package
    Assert (-not (Test-Path -LiteralPath $manifest)) "Uninstall left the registered manifest"
    $backups = @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA "RevitGPT\preview-uninstall-backups") -File)
    Assert ($backups.Count -eq 1) "Uninstall backup missing"
    $backupSha = (Get-FileHash -LiteralPath $backups[0].FullName -Algorithm SHA256).Hash
    $stagedSha = (Get-FileHash -LiteralPath (Join-Path $package "RevitGPT.preview.addin") -Algorithm SHA256).Hash
    Assert ($backupSha -eq $stagedSha) "Backup differs from source"

    # Collision: do not replace unknown/legacy RevitMCPBridge manifests.
    New-Item -ItemType Directory -Path $machineDir -Force | Out-Null
    $legacy = Join-Path $machineDir "RevitMCPBridge.addin"
    [IO.File]::WriteAllText($legacy, "<RevitAddIns>Legacy</RevitAddIns>")
    Must-Fail { & $scriptPath -Action Install -PackageDirectory $package -ApproveHostChange } "Competing bridge not blocked"
    Assert (-not (Test-Path -LiteralPath $manifest)) "Collision installed preview anyway"
    Remove-Item -LiteralPath $legacy -Force

    # Wrong identity in the reserved target must never be overwritten/deleted.
    New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null
    [IO.File]::WriteAllText($manifest, "<RevitAddIns><AddIn>Foreign</AddIn></RevitAddIns>")
    Must-Fail { & $scriptPath -Action Install -PackageDirectory $package -ApproveHostChange } "Foreign manifest overwritten"
    Must-Fail { & $scriptPath -Action Uninstall -PackageDirectory $package -ApproveHostChange } "Foreign manifest deleted"
    Assert ((Get-Content $manifest -Raw) -match "Foreign") "Foreign manifest changed"
    Remove-Item -LiteralPath $manifest -Force

    # Package tampering should fail before registering anything.
    $tampered = Join-Path $temp "tampered"
    Copy-Item -LiteralPath $package -Destination $tampered -Recurse
    [IO.File]::AppendAllText((Join-Path $tampered "RevitGPT.Native.dll"), "tamper")
    Must-Fail { & $scriptPath -Action Install -PackageDirectory $tampered -ApproveHostChange } "Tampered DLL not blocked"
    Assert (-not (Test-Path -LiteralPath $manifest)) "Tampered package got registered"
    Write-Host "[PASS] Native preview manifest validate/install/uninstall/backup and negative controls."
} finally {
    $env:APPDATA = $saveApp
    $env:ProgramData = $saveProgram
    $env:LOCALAPPDATA = $saveLocal
    if (Test-Path -LiteralPath $temp) {
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    }
}
