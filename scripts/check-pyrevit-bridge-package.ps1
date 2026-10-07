$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$extRoot = Join-Path $repoRoot "runtimes\Revit-mcp\bridge\pyrevit_extension\RevitMCPBridge.extension"

$startup = Join-Path $extRoot "startup.py"
$module = Join-Path $extRoot "RevitMCPBridge.bundle\Contents\revit_mcp_bridge.py"
$button = Join-Path $extRoot "RevitGPT.tab\Bridge.panel\StartBridge.pushbutton\script.py"
$bundle = Join-Path $extRoot "RevitGPT.tab\Bridge.panel\StartBridge.pushbutton\bundle.yaml"
$legacyButton = Join-Path $extRoot "RevitMCPBridge.bundle\Contents\RevitMCPBridge.pushbutton\script.py"
$legacyConfig = Join-Path $extRoot "RevitMCPBridge.bundle\Contents\RevitMCPBridge.pushbutton\config.toml"

foreach ($path in @($startup,$module,$button,$bundle)) {
    if (-not (Test-Path $path)) {
        throw "Missing pyRevit bridge package artifact: $path"
    }
}

$startupFirst = Get-Content $startup -TotalCount 1
if ($startupFirst -ne "#! python3") {
    throw "startup.py must select pyRevit CPython with '#! python3' because revit_mcp_bridge.py uses Python 3 syntax."
}

$buttonFirst = Get-Content $button -TotalCount 1
if ($buttonFirst -ne "#! python3") {
    throw "StartBridge.pushbutton/script.py must select pyRevit CPython with '#! python3'."
}

if (Test-Path $legacyButton) {
    throw "Legacy nested RevitMCPBridge.pushbutton remains under non-standard .bundle/Contents hierarchy."
}
if (Test-Path $legacyConfig) {
    throw "Legacy config.toml remains; pyRevit button metadata must use bundle.yaml in the standard hierarchy."
}

$startupText = Get-Content $startup -Raw
if ($startupText -notmatch 'RevitMCPBridge\.bundle' -or $startupText -notmatch 'ensure_server_started') {
    throw "startup.py no longer imports/starts the packaged RevitGPT bridge."
}

$buttonText = Get-Content $button -Raw
if ($buttonText -notmatch 'RevitMCPBridge\.bundle' -or $buttonText -notmatch 'ensure_server_started') {
    throw "Manual Start Bridge button no longer imports/starts the packaged RevitGPT bridge."
}

Write-Host "[PASS] pyRevit bridge package uses CPython startup and standard tab/panel/pushbutton layout"
