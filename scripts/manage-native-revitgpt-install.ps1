# RevitGPT local *installed* host (not a distributable package/EXE/MSI).
# Builds stay separate; only a verified source snapshot is copied to LOCALAPPDATA.
# Install/Upgrade/Migrate/Uninstall require Revit stopped and human approval.
[CmdletBinding()]
param(
    [ValidateSet("Validate","Install","Uninstall")][string]$Action = "Validate",
    [string]$SourceDirectory = "",
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._-]{0,60}$')][string]$Version = "development",
    [switch]$ApproveHostChange,
    [switch]$MigratePreview
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if (-not $SourceDirectory) {
    $SourceDirectory = Join-Path $repo "runtimes\Revit-mcp\bridge\unified_native\bin\Release\net48"
}
$source = [IO.Path]::GetFullPath($SourceDirectory)
$userAddins = Join-Path $env:APPDATA "Autodesk\Revit\Addins\2024"
$machineAddins = Join-Path $env:ProgramData "Autodesk\Revit\Addins\2024"
$root = Join-Path $env:LOCALAPPDATA "RevitGPT\host\2024"
$installed = Join-Path $root ("versions\" + $Version)
$official = Join-Path $userAddins "RevitGPT.addin"
$preview = Join-Path $userAddins "RevitGPT.preview.addin"
$backupRoot = Join-Path $env:LOCALAPPDATA "RevitGPT\install-backups\2024"
$identity = "RevitGPT.Native.RevitGptApplication"
$guid = "9FE9A6D0-E4C9-4B8F-88F8-50E726EC0D02"
$dependencies = @("RevitGPT.Native.dll", "Microsoft.Web.WebView2.Core.dll",
                  "Microsoft.Web.WebView2.Wpf.dll", "x64\WebView2Loader.dll")
function Is-Our([string]$manifest, [bool]$isPreview) {
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { return $false }
    try {
        [xml]$x = Get-Content -LiteralPath $manifest -Raw
        $addins = @($x.RevitAddIns.AddIn)
        if ($addins.Count -ne 1) { return $false }
        $xadd = $addins[0]
        return ([string]$xadd.Type -eq "Application" -and
                [string]$xadd.FullClassName -eq $identity -and
                [string]$xadd.AddInId -eq $guid -and
                [string]$xadd.VendorId -eq "TBH" -and
                [string]$xadd.Name -eq $(if ($isPreview) {"RevitGPT Native Preview"} else {"RevitGPT"}) -and
                [IO.Path]::GetFileName([string]$xadd.Assembly) -eq "RevitGPT.Native.dll")
    } catch { return $false }
}
function Save-Copy([string]$manifest, [string]$label) {
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { return $null }
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    $dst = Join-Path $backupRoot ($label + "." +
      (Get-Date -Format "yyyyMMdd-HHmmss") + "." + [Guid]::NewGuid().ToString("N") + ".addin.bak")
    Copy-Item -LiteralPath $manifest -Destination $dst -ErrorAction Stop
    if ((Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash) {
        throw "Cannot verify manifest backup: $manifest"
    }
    return $dst
}
function Source-Artifact([string]$name) {
    if ($name -eq "x64\WebView2Loader.dll") {
        foreach ($candidate in @(
          (Join-Path $source "x64\WebView2Loader.dll"),
          (Join-Path $source "runtimes\win-x64\native\WebView2Loader.dll"),
          (Join-Path $source "WebView2Loader.dll")
        )) {
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
        }
        throw "Missing WebView2Loader.dll for x64."
    }
    $p = Join-Path $source $name
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "Missing compiled dependency: $name" }
    return $p
}
function Refuse-Collisions() {
    foreach ($folder in @($userAddins, $machineAddins)) {
        if (-not (Test-Path -LiteralPath $folder)) { continue }
        foreach ($file in @(Get-ChildItem -LiteralPath $folder -Filter "*.addin" -File)) {
            if ($file.FullName -eq $official) {
                if (-not (Is-Our $official $false)) { throw "Foreign official manifest: $official" }
                continue
            }
            if ($file.FullName -eq $preview) {
                if (-not (Is-Our $preview $true)) { throw "Foreign preview manifest: $preview" }
                if (-not $MigratePreview) { throw "Preview is installed. Specify -MigratePreview explicitly." }
                continue
            }
            if ($file.Name -match '(?i)RevitGPT|RevitMCPBridge' -or
                (Get-Content -LiteralPath $file.FullName -Raw) -match
                    '(?i)RevitGPT|RevitMCPBridge') {
                throw "Competing add-in: $($file.FullName)"
            }
        }
    }
}
if ($Action -ne "Validate") {
    if (-not $ApproveHostChange) { throw "Explicit -ApproveHostChange required." }
    if (Get-Process -Name Revit -ErrorAction SilentlyContinue) {
        throw "Close all Revit sessions before install/uninstall."
    }
}
if ($Action -eq "Uninstall") {
    if (-not (Test-Path -LiteralPath $official)) {
        Write-Host "[OK] RevitGPT official manifest not installed."; return
    }
    if (-not (Is-Our $official $false)) { throw "Refusing to remove foreign manifest." }
    $copy = Save-Copy $official "official-uninstall"
    Remove-Item -LiteralPath $official
    Write-Host "[PASS] Unregistered official RevitGPT. Backup: $copy"
    return
}
Refuse-Collisions
$sourceFiles = @{}
foreach ($name in $dependencies) { $sourceFiles[$name] = Source-Artifact $name }
foreach ($hostDll in @("RevitAPI.dll","RevitAPIUI.dll","Newtonsoft.Json.dll")) {
    if (Test-Path -LiteralPath (Join-Path $source $hostDll)) {
        throw "Host-owned DLL must not be installed: $hostDll"
    }
}
if ($Action -eq "Validate") {
    Write-Host "[PASS] RevitGPT source/install manifest validation."
    Write-Host "[INFO] Local installation only. No distributable package created."
    return
}
# Immutable version folder: upgrading requires a NEW Version, never overwrite
# in-use/previous binaries. The user is responsible for releasing host QA.
if (Test-Path -LiteralPath $installed) { throw "Version directory already exists. Use a new -Version." }
New-Item -ItemType Directory -Path (Split-Path -Parent $installed) -Force | Out-Null
$stage = $installed + ".stage-" + [guid]::NewGuid().ToString("N")
$beforeOfficial = $null
$beforePreview = $null
$manifestChanged = $false
try {
    New-Item -ItemType Directory -Path (Join-Path $stage "x64") -Force | Out-Null
    foreach ($name in $dependencies) {
        $target = Join-Path $stage $name
        Copy-Item -LiteralPath $sourceFiles[$name] -Destination $target -ErrorAction Stop
        if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne
            (Get-FileHash -LiteralPath $sourceFiles[$name] -Algorithm SHA256).Hash) {
            throw "Source/build hash mismatch: $name"
        }
    }
    Move-Item -LiteralPath $stage -Destination $installed -ErrorAction Stop
    New-Item -ItemType Directory -Path $userAddins -Force | Out-Null
    $beforeOfficial = Save-Copy $official "official-upgrade"
    if ($MigratePreview) { $beforePreview = Save-Copy $preview "preview-migration" }
    $dll = [Security.SecurityElement]::Escape((Join-Path $installed "RevitGPT.Native.dll"))
    $xml = @"
<?xml version="1.0" encoding="utf-8"?>
<RevitAddIns>
  <AddIn Type="Application">
    <Name>RevitGPT</Name>
    <Assembly>$dll</Assembly>
    <AddInId>$guid</AddInId>
    <FullClassName>$identity</FullClassName>
    <VendorId>TBH</VendorId>
    <VendorDescription>RevitGPT native dockable panel and MCP bridge</VendorDescription>
  </AddIn>
</RevitAddIns>
"@
    $temp = $official + ".pending-" + [Guid]::NewGuid().ToString("N")
    [IO.File]::WriteAllText($temp, $xml, (New-Object System.Text.UTF8Encoding($false)))
    try {
        if (-not (Is-Our $temp $false)) { throw "Prepared official manifest invalid." }
        $manifestChanged = $true
        if (Test-Path -LiteralPath $official) { Remove-Item -LiteralPath $official }
        Move-Item -LiteralPath $temp -Destination $official
        if ($beforePreview -and (Test-Path -LiteralPath $preview)) {
            Remove-Item -LiteralPath $preview
        }
    } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp } }
    Write-Host "[PASS] Official RevitGPT 2024 locally registered: $official"
    Write-Host "[INFO] Version: $Version; no installer package created."
} catch {
    if ($manifestChanged) {
        if (Test-Path -LiteralPath $official) { Remove-Item -LiteralPath $official -Force }
        if ($beforeOfficial) { Copy-Item -LiteralPath $beforeOfficial -Destination $official }
        if ($beforePreview -and -not (Test-Path -LiteralPath $preview)) {
            Copy-Item -LiteralPath $beforePreview -Destination $preview
        }
    }
    throw
} finally {
    if (Test-Path -LiteralPath $stage) {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
}
