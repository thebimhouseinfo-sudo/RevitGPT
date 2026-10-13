$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "pyrevit-runtime.ps1")

$cli = Find-PyRevitCli
if ($cli) {
    Write-Host ("[OK] pyRevit runtime: " + $cli)
    try {
        $version = & $cli version 2>&1 | Select-Object -First 5
        if ($version) {
            $version | ForEach-Object { Write-Host ("[INFO] " + $_) }
        }
    } catch {}
    exit 0
}

$years = @()
$years += @(Get-RunningRevitYears)

foreach ($root in @(
    (Join-Path $env:APPDATA "Autodesk\Revit\Addins"),
    (Join-Path $env:ProgramData "Autodesk\Revit\Addins"),
    $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles "Autodesk\Revit\Addins" } else { $null })
) | Where-Object { $_ -and (Test-Path $_) }) {
    try {
        $years += @(Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^20\d{2}$' } |
            ForEach-Object { [int]$_.Name })
    } catch {}
}

$years = @($years | Sort-Object -Unique)
foreach ($year in $years) {
    $attachment = Get-PyRevitAttachmentInfo -Year $year
    if ($attachment -and -not $attachment.ParseError -and $attachment.AssemblyExists) {
        Write-Host ("[OK] pyRevit loader attachment found for Revit {0}: {1}" -f $year,$attachment.ManifestPath)
        Write-Host ("[INFO] Loader assembly: " + $attachment.AssemblyPath)
        exit 0
    }
}

Write-Host "[FAIL] pyRevit runtime/loader was not found."
Write-Host "[INFO] RevitGPT requires the full pyRevit runtime, not only a RevitGPT bridge folder."
Write-Host "[INFO] Official installer: https://github.com/pyrevitlabs/pyRevit/releases/latest"
exit 2
