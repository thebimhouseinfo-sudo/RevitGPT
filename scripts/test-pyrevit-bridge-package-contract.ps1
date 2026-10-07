$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot "runtimes\Revit-mcp\bridge\pyrevit_extension\RevitMCPBridge.extension"
$checker = Join-Path $PSScriptRoot "check-pyrevit-bridge-package.ps1"
$powerShellExe = (Get-Command powershell.exe -ErrorAction Stop).Source
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("revitgpt-pyrevit-package-" + [guid]::NewGuid().ToString("N"))

function Invoke-Checker([string]$Root) {
    $output = & $powerShellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $checker -ExtensionRoot $Root 2>&1
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = @($output)
    }
}

function Assert-CheckerFails([string]$Root, [string]$CaseName) {
    $result = Invoke-Checker $Root
    if ($result.ExitCode -eq 0) {
        throw "Negative control '$CaseName' unexpectedly passed the pyRevit package validator."
    }
    Write-Host ("[RED CONTROL PASS] " + $CaseName)
}

try {
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

    $positive = Invoke-Checker $source
    if ($positive.ExitCode -ne 0) {
        $positive.Output | ForEach-Object { Write-Host $_ }
        throw "Current pyRevit package failed its positive control."
    }
    Write-Host "[POSITIVE CONTROL PASS] current pyRevit package"

    $badEngine = Join-Path $tempRoot "bad-engine"
    Copy-Item -LiteralPath $source -Destination $badEngine -Recurse
    $startup = Join-Path $badEngine "startup.py"
    $lines = @(Get-Content -LiteralPath $startup)
    $lines[0] = "#! python"
    $lines | Set-Content -LiteralPath $startup -Encoding UTF8
    Assert-CheckerFails $badEngine "wrong startup engine"

    $missingCall = Join-Path $tempRoot "missing-start-call"
    Copy-Item -LiteralPath $source -Destination $missingCall -Recurse
    $startup = Join-Path $missingCall "startup.py"
    $text = Get-Content -LiteralPath $startup -Raw
    $mutated = $text.Replace(
        "result = revit_mcp_bridge.ensure_server_started()",
        "result = {'started': False}"
    )
    if ($mutated -eq $text) {
        throw "Could not construct missing-start-call mutation fixture."
    }
    Set-Content -LiteralPath $startup -Value $mutated -Encoding UTF8
    Assert-CheckerFails $missingCall "startup call removed"

    $legacy = Join-Path $tempRoot "legacy-layout"
    Copy-Item -LiteralPath $source -Destination $legacy -Recurse
    $legacyFile = Join-Path $legacy "RevitMCPBridge.bundle\Contents\RevitMCPBridge.pushbutton\script.py"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $legacyFile) | Out-Null
    "# legacy fixture" | Set-Content -LiteralPath $legacyFile -Encoding UTF8
    Assert-CheckerFails $legacy "legacy nested pushbutton"

    $buttonMissingCall = Join-Path $tempRoot "button-missing-call"
    Copy-Item -LiteralPath $source -Destination $buttonMissingCall -Recurse
    $button = Join-Path $buttonMissingCall "RevitGPT.tab\Bridge.panel\StartBridge.pushbutton\script.py"
    $buttonText = Get-Content -LiteralPath $button -Raw
    $buttonMutated = $buttonText.Replace(
        "state = revit_mcp_bridge.ensure_server_started()",
        "state = {'ready': False}"
    )
    if ($buttonMutated -eq $buttonText) {
        throw "Could not construct button-missing-call mutation fixture."
    }
    Set-Content -LiteralPath $button -Value $buttonMutated -Encoding UTF8
    Assert-CheckerFails $buttonMissingCall "manual button call removed"

    Write-Host "[PASS] pyRevit package validator proved positive path + 4 red controls"
}
finally {
    Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
