$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot "runtimes\Revit-mcp\bridge\pyrevit_extension\RevitMCPBridge.extension"
if (-not (Test-Path $source)) {
    throw "RevitMCPBridge source is missing: $source"
}

$roots = @(
    (Join-Path $env:APPDATA "pyRevit\Extensions"),
    (Join-Path $env:LOCALAPPDATA "pyRevit\Extensions"),
    "C:\ProgramData\pyRevit\Extensions"
) | Select-Object -Unique

$targets = @()
foreach ($root in $roots) {
    $installed = Join-Path $root "RevitMCPBridge.extension"
    if (Test-Path $installed) {
        $targets += $installed
    }
}

if ($targets.Count -eq 0) {
    $root = Join-Path $env:APPDATA "pyRevit\Extensions"
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    $targets = @(Join-Path $root "RevitMCPBridge.extension")
}

foreach ($target in $targets) {
    if (Test-Path $target) {
        Remove-Item $target -Recurse -Force
    }
    Copy-Item $source $target -Recurse -Force
    Write-Host "[OK] Synced RevitGPT pyRevit bridge:"
    Write-Host "     $target"
}

if (@(Get-Process -Name Revit -ErrorAction SilentlyContinue).Count -gt 0) {
    Write-Host "[INFO] Revit is running. Restart Revit (or reload pyRevit) so startup.py executes the synced bridge."
}
