param(
    [string]$ExtensionRoot
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ExtensionRoot)) {
    $ExtensionRoot = Join-Path $repoRoot "runtimes\Revit-mcp\bridge\pyrevit_extension\RevitMCPBridge.extension"
}
$extRoot = $ExtensionRoot

$startup = Join-Path $extRoot "startup.py"
$module = Join-Path $extRoot "RevitMCPBridge.bundle\Contents\revit_mcp_bridge.py"
$button = Join-Path $extRoot "RevitGPT.tab\Bridge.panel\StartBridge.pushbutton\script.py"
$bundle = Join-Path $extRoot "RevitGPT.tab\Bridge.panel\StartBridge.pushbutton\bundle.yaml"
$legacyButton = Join-Path $extRoot "RevitMCPBridge.bundle\Contents\RevitMCPBridge.pushbutton\script.py"
$legacyConfig = Join-Path $extRoot "RevitMCPBridge.bundle\Contents\RevitMCPBridge.pushbutton\config.toml"

foreach ($path in @($startup,$module,$button,$bundle)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Missing pyRevit bridge package artifact: $path"
    }
}

$startupFirst = Get-Content -LiteralPath $startup -TotalCount 1
if ($startupFirst -ne "#! python3") {
    throw "startup.py must select pyRevit CPython with '#! python3'."
}

$buttonFirst = Get-Content -LiteralPath $button -TotalCount 1
if ($buttonFirst -ne "#! python3") {
    throw "StartBridge.pushbutton/script.py must select pyRevit CPython with '#! python3'."
}

if (Test-Path -LiteralPath $legacyButton) {
    throw "Legacy nested RevitMCPBridge.pushbutton remains under non-standard .bundle/Contents hierarchy."
}
if (Test-Path -LiteralPath $legacyConfig) {
    throw "Legacy config.toml remains; pyRevit button metadata must use bundle.yaml in the standard hierarchy."
}

$startupText = Get-Content -LiteralPath $startup -Raw
if ($startupText -notmatch '(?m)^\s*import\s+revit_mcp_bridge\s*$') {
    throw "startup.py no longer imports the packaged RevitGPT bridge on its executable path."
}
if ($startupText -notmatch '(?m)^\s*result\s*=\s*revit_mcp_bridge\.ensure_server_started\(\)\s*$') {
    throw "startup.py no longer executes ensure_server_started() on its startup path."
}

$buttonText = Get-Content -LiteralPath $button -Raw
if ($buttonText -notmatch '(?m)^\s*import\s+revit_mcp_bridge\s*$') {
    throw "Manual Start Bridge button no longer imports the packaged bridge."
}
if ($buttonText -notmatch '(?m)^\s*state\s*=\s*revit_mcp_bridge\.ensure_server_started\(\)\s*$') {
    throw "Manual Start Bridge button no longer executes ensure_server_started()."
}

Write-Host "[PASS] STATIC_PACKAGE_CONTRACT: pyRevit bridge layout, engine selectors and startup call markers are present"
Write-Host "[INFO] Runtime startup behavior is proven separately by Python execution tests and real-host E-PY evidence."
