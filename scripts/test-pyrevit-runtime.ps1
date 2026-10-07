$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "pyrevit-runtime.ps1")

$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("revitgpt-pyrevit-" + [guid]::NewGuid().ToString("N"))
$appData = Join-Path $temp "appdata"
$programData = Join-Path $temp "programdata"
$programFiles = Join-Path $temp "programfiles"
$programFilesX86 = Join-Path $temp "programfilesx86"

try {
    New-Item -ItemType Directory -Force -Path $appData,$programData,$programFiles,$programFilesX86 | Out-Null

    $missingCli = Find-PyRevitCli -AppData $appData -ProgramFiles $programFiles -ProgramFilesX86 $programFilesX86 -SkipPathLookup
    if ($missingCli) {
        throw "Negative control failed: empty fixture unexpectedly discovered pyRevit CLI at $missingCli"
    }
    Write-Host "[RED CONTROL PASS] missing pyRevit CLI returns no discovery"

    $expectedUserCli = Join-Path $appData "pyRevit-Master\bin\pyrevit.exe"
    New-Item -ItemType Directory -Force -Path (Split-Path $expectedUserCli -Parent) | Out-Null
    Set-Content $expectedUserCli "fake"

    $found = Find-PyRevitCli -AppData $appData -ProgramFiles $programFiles -ProgramFilesX86 $programFilesX86 -SkipPathLookup
    if ($found -ne $expectedUserCli) {
        throw "User pyRevit install discovery failed: $found"
    }
    Write-Host "[POSITIVE CONTROL PASS] user pyRevit CLI discovery"

    $paths2026 = @(Get-PyRevitAttachmentPaths -Year 2026 -AppData $appData -ProgramData $programData -ProgramFiles $programFiles)
    $expectedUser2026 = Join-Path $appData "Autodesk\Revit\Addins\2026\pyRevit.addin"
    $expectedAll2026 = Join-Path $programData "Autodesk\Revit\Addins\2026\pyRevit.addin"
    if ($expectedUser2026 -notin $paths2026 -or $expectedAll2026 -notin $paths2026) {
        throw "Revit <=2026 attachment path contract failed."
    }

    $paths2027 = @(Get-PyRevitAttachmentPaths -Year 2027 -AppData $appData -ProgramData $programData -ProgramFiles $programFiles)
    $expectedAll2027 = Join-Path $programFiles "Autodesk\Revit\Addins\2027\pyRevit.addin"
    if ($expectedAll2027 -notin $paths2027) {
        throw "Revit 2027+ all-users attachment path contract failed."
    }
    if ((Join-Path $programData "Autodesk\Revit\Addins\2027\pyRevit.addin") -in $paths2027) {
        throw "Legacy ProgramData all-users path must not be used for Revit 2027+."
    }
    Write-Host "[RED CONTROL PASS] Revit 2027+ rejects legacy ProgramData attachment path"

    $loader = Join-Path $temp "loader\pyRevitLoader.dll"
    New-Item -ItemType Directory -Force -Path (Split-Path $loader -Parent) | Out-Null
    Set-Content $loader "fake"

    New-Item -ItemType Directory -Force -Path (Split-Path $expectedUser2026 -Parent) | Out-Null
    @"
<?xml version="1.0" encoding="utf-8"?>
<RevitAddIns>
  <AddIn Type="Application">
    <Name>PyRevitLoader</Name>
    <Assembly>$loader</Assembly>
    <AddInId>B39107C3-A1D7-47F4-A5A1-532DDF6EDB5D</AddInId>
    <FullClassName>PyRevitLoader.PyRevitLoaderApplication</FullClassName>
    <VendorId>eirannejad</VendorId>
  </AddIn>
</RevitAddIns>
"@ | Set-Content $expectedUser2026

    $info = Get-PyRevitAttachmentInfo -Year 2026 -AppData $appData -ProgramData $programData -ProgramFiles $programFiles
    if (-not $info -or -not $info.AssemblyExists -or $info.AssemblyPath -ne $loader -or $info.ParseError) {
        throw "pyRevit attachment manifest validation failed."
    }
    Write-Host "[POSITIVE CONTROL PASS] valid attachment + existing loader"

    $badManifest = Join-Path $appData "Autodesk\Revit\Addins\2025\pyRevit.addin"
    New-Item -ItemType Directory -Force -Path (Split-Path $badManifest -Parent) | Out-Null
    "<RevitAddIns><AddIn>" | Set-Content $badManifest
    $badInfo = Get-PyRevitAttachmentInfo -Year 2025 -AppData $appData -ProgramData $programData -ProgramFiles $programFiles
    if (-not $badInfo -or [string]::IsNullOrWhiteSpace($badInfo.ParseError) -or $badInfo.AssemblyExists) {
        throw "Negative control failed: malformed attachment manifest was not rejected."
    }
    Write-Host "[RED CONTROL PASS] malformed attachment manifest"

    $missingAssemblyManifest = Join-Path $appData "Autodesk\Revit\Addins\2024\pyRevit.addin"
    New-Item -ItemType Directory -Force -Path (Split-Path $missingAssemblyManifest -Parent) | Out-Null
    $missingAssembly = Join-Path $temp "missing\pyRevitLoader.dll"
    @"
<?xml version="1.0" encoding="utf-8"?>
<RevitAddIns>
  <AddIn Type="Application">
    <Name>PyRevitLoader</Name>
    <Assembly>$missingAssembly</Assembly>
    <AddInId>B39107C3-A1D7-47F4-A5A1-532DDF6EDB5D</AddInId>
    <FullClassName>PyRevitLoader.PyRevitLoaderApplication</FullClassName>
    <VendorId>eirannejad</VendorId>
  </AddIn>
</RevitAddIns>
"@ | Set-Content $missingAssemblyManifest
    $missingAssemblyInfo = Get-PyRevitAttachmentInfo -Year 2024 -AppData $appData -ProgramData $programData -ProgramFiles $programFiles
    if (-not $missingAssemblyInfo -or $missingAssemblyInfo.ParseError -or $missingAssemblyInfo.AssemblyExists) {
        throw "Negative control failed: missing loader assembly was not detected."
    }
    Write-Host "[RED CONTROL PASS] missing loader assembly"

    Write-Host "[PASS] pyRevit runtime/attachment discovery contract with positive + negative controls"
}
finally {
    Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
