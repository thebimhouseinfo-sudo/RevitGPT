# Prepare a reviewable native preview payload; NEVER install or register with Revit.
# An installer with host rollback/duplicate checks is intentionally a separate gate.
[CmdletBinding()]
param(
    [string]$SourceDirectory = "",
    [string]$OutputDirectory = ""
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
if (-not $SourceDirectory) {
    $SourceDirectory = Join-Path $root "runtimes\Revit-mcp\bridge\unified_native\bin\Release\net48"
}
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $root "artifacts\RevitGPT.Native.2024.preview"
}
$source = [IO.Path]::GetFullPath($SourceDirectory).TrimEnd('\')
$output = [IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\')
if ($source -eq $output -or $output.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to stage inside the source build directory."
}

# A user-supplied destination may NEVER turn this prepare-only command into an install.
$protectedRoots = @(
    (Join-Path $env:APPDATA "Autodesk\Revit\Addins"),
    (Join-Path $env:ProgramData "Autodesk\Revit\Addins"),
    (Join-Path $env:ProgramFiles "Autodesk")
)
foreach ($location in $protectedRoots) {
    $protected = [IO.Path]::GetFullPath($location).TrimEnd('\')
    if ($output.Equals($protected, [StringComparison]::OrdinalIgnoreCase) -or
        $output.StartsWith($protected + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to stage into a live Autodesk installation directory: $output"
    }
}
if (Test-Path -LiteralPath $output) {
    throw "Preview destination already exists; refusing to overwrite: $output"
}
$required = @(
    "RevitGPT.Native.dll",
    "Microsoft.Web.WebView2.Core.dll",
    "Microsoft.Web.WebView2.Wpf.dll"
)
foreach ($name in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $name) -PathType Leaf)) {
        throw "Missing native preview dependency: $name. Build RevitGPT.Native.csproj first."
    }
}
# Revit API and Newtonsoft.Json MUST resolve from the matching Revit host.
foreach ($forbidden in @("RevitAPI.dll", "RevitAPIUI.dll", "Newtonsoft.Json.dll")) {
    if (Test-Path -LiteralPath (Join-Path $source $forbidden)) {
        throw "Unexpected host-owned DLL in build output: $forbidden"
    }
}
$loaderSource = @(
    (Join-Path $source "x64\WebView2Loader.dll"),
    (Join-Path $source "runtimes\win-x64\native\WebView2Loader.dll"),
    (Join-Path $source "WebView2Loader.dll")
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $loaderSource) {
    throw "Missing x64 WebView2Loader.dll. Packaging cannot pass without WebView2 native loader."
}

$parent = Split-Path -Parent $output
if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
}
$partial = $output + ".partial-" + [Guid]::NewGuid().ToString("N")
try {
    New-Item -ItemType Directory -Path $partial -ErrorAction Stop | Out-Null
    foreach ($name in $required) {
        Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $partial $name) -ErrorAction Stop
    }
    New-Item -ItemType Directory -Path (Join-Path $partial "x64") | Out-Null
    Copy-Item -LiteralPath $loaderSource -Destination (Join-Path $partial "x64\WebView2Loader.dll") -ErrorAction Stop

    $assemblyPath = Join-Path $output "RevitGPT.Native.dll"
    $escapedAssembly = [Security.SecurityElement]::Escape($assemblyPath)
    $manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<RevitAddIns>
  <AddIn Type="Application">
    <Name>RevitGPT Native Preview</Name>
    <Assembly>$escapedAssembly</Assembly>
    <AddInId>9FE9A6D0-E4C9-4B8F-88F8-50E726EC0D02</AddInId>
    <FullClassName>RevitGPT.Native.RevitGptApplication</FullClassName>
    <VendorId>TBH</VendorId>
    <VendorDescription>RevitGPT read-only host preview</VendorDescription>
  </AddIn>
</RevitAddIns>
"@
    $manifestPath = Join-Path $partial "RevitGPT.preview.addin"
    [IO.File]::WriteAllText($manifestPath, $manifest, (New-Object Text.UTF8Encoding($false)))
    # An .addin in the payload is NOT registered in Revit's startup search folders.
    $checksums = @()
    foreach ($name in ($required + @("x64\WebView2Loader.dll"))) {
        $file = Join-Path $partial $name
        $checksums += [ordered]@{
            path = ($name -replace '\\', '/')
            sha256 = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    $evidence = [ordered]@{
        package_type = "UNINSTALLED_READ_ONLY_PREVIEW"
        revit_target = "2024"
        full_class_name = "RevitGPT.Native.RevitGptApplication"
        installed = $false
        model_mutations_enabled = $false
        files = $checksums
    }
    [IO.File]::WriteAllText(
        (Join-Path $partial "package-evidence.json"),
        ($evidence | ConvertTo-Json -Depth 6),
        (New-Object Text.UTF8Encoding($false))
    )
    [IO.File]::WriteAllText(
        (Join-Path $partial "README-PREVIEW.txt"),
        "STAGED ONLY. Do not copy this manifest into Revit Addins until a separate host-install and rollback gate passes. No model mutations are supported. The manifest points to this absolute payload location; moving the folder invalidates it.",
        (New-Object Text.UTF8Encoding($false))
    )
    if (Test-Path -LiteralPath $output) { throw "Destination appeared during staging." }
    Move-Item -LiteralPath $partial -Destination $output -ErrorAction Stop
}
finally {
    if (Test-Path -LiteralPath $partial) {
        Remove-Item -LiteralPath $partial -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "[PASS] Read-only RevitGPT native preview STAGED, not installed: $output"
Write-Host "[INFO] 2024 preview manifest remains outside Revit Addins."
