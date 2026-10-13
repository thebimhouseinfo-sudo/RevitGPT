# Test staged preview packaging using a real built .NET output + negative controls.
# Never touches the host's Revit add-in directories or starts Revit.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$prepare = Join-Path $PSScriptRoot "prepare-native-revitgpt-preview.ps1"
$source = Join-Path $root "runtimes\Revit-mcp\bridge\unified_native\bin\Release\net48"
$temp = Join-Path ([IO.Path]::GetTempPath()) ("RevitGPT-preview-test-" + [Guid]::NewGuid().ToString("N"))

function Assert([bool]$ok, [string]$message) {
    if (-not $ok) { throw $message }
}
function MustFail([scriptblock]$run, [string]$message) {
    $failed = $false
    try { & $run } catch { $failed = $true }
    Assert $failed $message
}
try {
    New-Item -ItemType Directory -Path $temp -Force | Out-Null
    $success = Join-Path $temp "staged"
    & $prepare -SourceDirectory $source -OutputDirectory $success
    Assert (Test-Path (Join-Path $success "RevitGPT.Native.dll") -PathType Leaf) "Missing compiled DLL"
    Assert (Test-Path (Join-Path $success "x64\WebView2Loader.dll") -PathType Leaf) "Missing x64 loader"
    $manifest = Get-Content -LiteralPath (Join-Path $success "RevitGPT.preview.addin") -Raw
    [xml]$xml = $manifest
    $app = $xml.RevitAddIns.AddIn
    Assert ($app.FullClassName -eq "RevitGPT.Native.RevitGptApplication") "Wrong Revit add-in class"
    Assert ($app.Assembly -eq (Join-Path $success "RevitGPT.Native.dll")) "Staged absolute assembly path mismatch"
    Assert ($manifest -notmatch "RevitMCPBridge") "Legacy host sneaked into staged manifest"
    $evidence = Get-Content -LiteralPath (Join-Path $success "package-evidence.json") -Raw | ConvertFrom-Json
    Assert (-not $evidence.installed) "Staging was marked installed"
    Assert (-not $evidence.model_mutations_enabled) "Mutations were not disabled"
    Assert (@($evidence.files).Count -eq 4) "Expected four packaged runtime files"
    foreach ($file in $evidence.files) {
        $onDisk = Join-Path $success ($file.path -replace '/', '\')
        $hash = (Get-FileHash -LiteralPath $onDisk -Algorithm SHA256).Hash.ToLowerInvariant()
        Assert ($hash -eq $file.sha256) "Hash mismatch: $onDisk"
    }
    MustFail { & $prepare -SourceDirectory $source -OutputDirectory $success } "Overwrite existing payload was not blocked"

    # Work only with a temporary copy of actual build artifacts; never alter build output.
    $fakeSource = Join-Path $temp "fake-build"
    New-Item -ItemType Directory -Path $fakeSource -Force | Out-Null
    foreach ($name in @("RevitGPT.Native.dll", "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.Wpf.dll")) {
        Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $fakeSource $name)
    }
    New-Item -ItemType Directory -Path (Join-Path $fakeSource "x64") | Out-Null
    Copy-Item -LiteralPath (Join-Path $success "x64\WebView2Loader.dll") -Destination (Join-Path $fakeSource "x64\WebView2Loader.dll")
    Remove-Item -LiteralPath (Join-Path $fakeSource "Microsoft.Web.WebView2.Core.dll")
    $missingDll = Join-Path $temp "missing-dependency"
    MustFail { & $prepare -SourceDirectory $fakeSource -OutputDirectory $missingDll } "Missing WebView2 Core DLL did not fail closed"
    Assert (-not (Test-Path -LiteralPath $missingDll)) "Created payload despite missing WebView2 DLL"
    Copy-Item -LiteralPath (Join-Path $source "Microsoft.Web.WebView2.Core.dll") -Destination (Join-Path $fakeSource "Microsoft.Web.WebView2.Core.dll")
    Remove-Item -LiteralPath (Join-Path $fakeSource "x64\WebView2Loader.dll")
    MustFail { & $prepare -SourceDirectory $fakeSource -OutputDirectory (Join-Path $temp "missing-loader") } "Missing x64 loader did not fail closed"
    Copy-Item -LiteralPath (Join-Path $success "x64\WebView2Loader.dll") -Destination (Join-Path $fakeSource "x64\WebView2Loader.dll")
    [IO.File]::WriteAllText((Join-Path $fakeSource "RevitAPI.dll"), "forbidden host-owned reference")
    MustFail { & $prepare -SourceDirectory $fakeSource -OutputDirectory (Join-Path $temp "bundled-autodesk") } "Bundled RevitAPI.dll did not fail closed"

    # A spoofed destination within the real Revit auto-load search directory is forbidden.
    $installDir = Join-Path $env:APPDATA "Autodesk\Revit\Addins\2024\RevitGPT-Preview"
    MustFail { & $prepare -SourceDirectory $source -OutputDirectory $installDir } "Staging inside live Revit Addins was allowed"
    Write-Host "[PASS] Preview packaging, dependency hashes and four fail-closed controls."
}
finally {
    if (Test-Path -LiteralPath $temp) {
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    }
}
