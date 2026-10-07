$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "pyrevit-runtime.ps1")

$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("revitgpt-pyrevit-" + [guid]::NewGuid().ToString("N"))
$appData = Join-Path $temp "appdata"
$programData = Join-Path $temp "programdata"
$programFiles = Join-Path $temp "programfiles"
$programFilesX86 = Join-Path $temp "programfilesx86"

try {
    New-Item -ItemType Directory -Force -Path $appData,$programData,$programFiles,$programFilesX86 | Out-Null

    $expectedUserCli = Join-Path $appData "pyRevit-Master\bin\pyrevit.exe"
    New-Item -ItemType Directory -Force -Path (Split-Path $expectedUserCli -Parent) | Out-Null
    Set-Content $expectedUserCli "fake"

    $found = Find-PyRevitCli -AppData $appData -ProgramFiles $programFiles -ProgramFilesX86 $programFilesX86 -SkipPathLookup
    if ($found -ne $expectedUserCli) {
        throw "User pyRevit install discovery failed: $found"
    }

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
    if (-not $info -or -not $info.AssemblyExists -or $info.AssemblyPath -ne $loader) {
        throw "pyRevit attachment manifest validation failed."
    }

    Write-Host "[PASS] pyRevit runtime/attachment discovery contract"
}
finally {
    Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
