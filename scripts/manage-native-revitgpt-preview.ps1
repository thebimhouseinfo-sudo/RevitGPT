# Isolated RevitGPT read-only preview registration. Never invoked by setup.bat.
# Default is inspection only. Installation/removal requires an explicit human action.
[CmdletBinding()]
param(
    [ValidateSet("Validate", "Install", "Uninstall")]
    [string]$Action = "Validate",
    [string]$PackageDirectory = "",
    [switch]$ApproveHostChange
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $PackageDirectory) {
    $PackageDirectory = Join-Path $root "artifacts\RevitGPT.Native.2024.preview"
}
$package = [IO.Path]::GetFullPath($PackageDirectory).TrimEnd('\')
$userAddins = [IO.Path]::GetFullPath(
    (Join-Path $env:APPDATA "Autodesk\Revit\Addins\2024")
).TrimEnd('\')
$machineAddins = [IO.Path]::GetFullPath(
    (Join-Path $env:ProgramData "Autodesk\Revit\Addins\2024")
).TrimEnd('\')
$target = Join-Path $userAddins "RevitGPT.preview.addin"
$identity = "RevitGPT.Native.RevitGptApplication"
$previewId = "9FE9A6D0-E4C9-4B8F-88F8-50E726EC0D02"
$required = @(
    "RevitGPT.Native.dll",
    "Microsoft.Web.WebView2.Core.dll",
    "Microsoft.Web.WebView2.Wpf.dll",
    "x64\WebView2Loader.dll"
)
function Is-Under([string]$child, [string]$folder) {
    return $child.Equals($folder, [StringComparison]::OrdinalIgnoreCase) -or
        $child.StartsWith($folder + '\', [StringComparison]::OrdinalIgnoreCase)
}
function Is-OurManifest([string]$path) {
    try {
        [xml]$xml = Get-Content -LiteralPath $path -Raw
        foreach ($entry in @($xml.RevitAddIns.AddIn)) {
            if ([string]$entry.FullClassName -eq $identity -and
                [string]$entry.Name -eq "RevitGPT Native Preview" -and
                [string]$entry.AddInId -eq $previewId -and
                [string]$entry.VendorId -eq "TBH" -and
                [IO.Path]::GetFileName([string]$entry.Assembly) -eq "RevitGPT.Native.dll") {
                return $true
            }
        }
    } catch { return $false }
    return $false
}
if ($Action -ne "Validate") {
    if (-not $ApproveHostChange) {
        throw "Explicit -ApproveHostChange is required for installation or removal."
    }
    if (Get-Process -Name Revit -ErrorAction SilentlyContinue) {
        throw "Close ALL Revit processes before modifying an .addin manifest."
    }
}
# Never install DLLs into Revit or the add-in discovery directories.
if ((Is-Under $package $userAddins) -or (Is-Under $package $machineAddins)) {
    throw "Preview package must remain outside Revit Addins directories."
}

if ($Action -eq "Uninstall") {
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
        Write-Host "[PASS] Native preview is not installed in the user Addins folder."
        return
    }
    if (-not (Is-OurManifest $target)) {
        throw "Refusing to remove a manifest that is not the RevitGPT native preview."
    }
    # Preserve the exact registered manifest as a recovery artifact outside Addins.
    $backupFolder = Join-Path $env:LOCALAPPDATA "RevitGPT\preview-uninstall-backups"
    if (-not (Test-Path -LiteralPath $backupFolder)) {
        New-Item -ItemType Directory -Path $backupFolder -Force | Out-Null
    }
    $backup = Join-Path $backupFolder ("RevitGPT.preview." + (Get-Date -Format "yyyyMMdd-HHmmss") +
        "." + [Guid]::NewGuid().ToString("N") + ".addin.bak")
    Copy-Item -LiteralPath $target -Destination $backup -ErrorAction Stop
    if ((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash) {
        throw "Manifest backup verification failed; uninstall was not performed."
    }
    Remove-Item -LiteralPath $target -ErrorAction Stop
    Write-Host "[PASS] RevitGPT native preview UNREGISTERED. Manifest backup: $backup"
    return
}

if (-not (Test-Path -LiteralPath $package -PathType Container)) {
    throw "Native preview package not staged: $package"
}
if (-not (Test-Path -LiteralPath (Join-Path $package "package-evidence.json") -PathType Leaf)) {
    throw "Preview package evidence not found."
}
$evidence = Get-Content -LiteralPath (Join-Path $package "package-evidence.json") -Raw |
    ConvertFrom-Json
if ($evidence.package_type -ne "UNINSTALLED_READ_ONLY_PREVIEW" -or
    $evidence.revit_target -ne "2024" -or
    $evidence.installed -ne $false -or
    $evidence.model_mutations_enabled -ne $false -or
    @($evidence.files).Count -ne $required.Count) {
    throw "Preview package is not marked safe, read-only and uninstalled."
}
foreach ($name in $required) {
    $item = @($evidence.files | Where-Object { $_.path -eq ($name -replace '\\', '/') })
    if ($item.Count -ne 1 -or [string]$item[0].sha256 -notmatch '^[0-9a-fA-F]{64}$') {
        throw "Missing or duplicate checksum entry: $name"
    }
    $file = Join-Path $package $name
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Missing preview DLL: $name"
    }
    $actualHash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    if ($actualHash -ine [string]$item[0].sha256) {
        throw "Preview DLL checksum mismatch: $name"
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $package "RevitGPT.preview.addin") -PathType Leaf)) {
    throw "Staged preview manifest missing."
}
$stagedManifest = Join-Path $package "RevitGPT.preview.addin"
if (-not (Is-OurManifest $stagedManifest)) {
    throw "Staged manifest does not match RevitGPT preview identity."
}
[xml]$stagedXml = Get-Content -LiteralPath $stagedManifest -Raw
$expectedDll = Join-Path $package "RevitGPT.Native.dll"
if ([string]$stagedXml.RevitAddIns.AddIn.Assembly -ne $expectedDll) {
    throw "Staged manifest references a different location; rebuild the preview package."
}
# Prevent stale, duplicate or competing bridge activation from either manifest scope.
foreach ($folder in @($userAddins, $machineAddins)) {
    if (-not (Test-Path -LiteralPath $folder -PathType Container)) { continue }
    foreach ($manifest in @(Get-ChildItem -LiteralPath $folder -Filter "*.addin" -File)) {
        if ($manifest.FullName -eq $target) {
            throw "RevitGPT preview is already installed; no automatic overwrite."
        }
        $content = Get-Content -LiteralPath $manifest.FullName -Raw
        if ($manifest.Name -match '(?i)RevitGPT|RevitMCPBridge' -or
            $content -match '(?i)RevitGPT|RevitMCPBridge') {
            throw "Existing RevitGPT / RevitMCPBridge add-in must be reviewed: $($manifest.FullName)"
        }
    }
}
if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) {
    throw "Bridge port 8765 is already owned; do not install a competing bridge."
}
if ($Action -eq "Validate") {
    Write-Host "[PASS] Preview package integrity and add-in collision checks."
    if (Get-Process -Name Revit -ErrorAction SilentlyContinue) {
        Write-Host "[BLOCKED] Revit is running; close it before registering the preview."
    } else {
        Write-Host "[READY] Revit is stopped; explicit Install action is allowed."
    }
    return
}
# Install touches only our user-scoped .addin; the compiled DLL stays in its
# already-staged, verified location. No Autodesk DLLs or other addins are modified.
if (-not (Test-Path -LiteralPath $userAddins)) {
    New-Item -ItemType Directory -Path $userAddins -Force | Out-Null
}
$partial = $target + ".partial-" + [Guid]::NewGuid().ToString("N")
try {
    Copy-Item -LiteralPath $stagedManifest -Destination $partial -ErrorAction Stop
    if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $stagedManifest -Algorithm SHA256).Hash) {
        throw "Staged manifest copy integrity check failed."
    }
    if (Test-Path -LiteralPath $target) { throw "Registration target unexpectedly exists." }
    Move-Item -LiteralPath $partial -Destination $target -ErrorAction Stop
    Write-Host "[PASS] Read-only RevitGPT native preview REGISTERED: $target"
    Write-Host "[INFO] Restart Revit 2024 with a disposable model for host testing."
} finally {
    if (Test-Path -LiteralPath $partial) {
        Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    }
}
