$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "pyrevit-runtime.ps1")

$cli = Find-PyRevitCli
if (-not $cli) {
    Write-Host "[FAIL] pyRevit runtime was not found."
    Write-Host "[INFO] RevitGPT requires the full pyRevit runtime, not only a RevitGPT bridge folder."
    Write-Host "[INFO] Official installer: https://github.com/pyrevitlabs/pyRevit/releases/latest"
    exit 2
}

Write-Host ("[OK] pyRevit runtime: " + $cli)
try {
    $version = & $cli version 2>&1 | Select-Object -First 5
    if ($version) {
        $version | ForEach-Object { Write-Host ("[INFO] " + $_) }
    }
} catch {}

exit 0
