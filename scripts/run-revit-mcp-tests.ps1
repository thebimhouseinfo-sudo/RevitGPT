$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $repoRoot "runtimes\Revit-mcp"
$testRoot = Join-Path $runtimeRoot "tests"

$offlineTests = @(
    "test_bridge.py",
    "test_pyrevit_bridge_startup.py",
    "test_real_connection_gate.py",
    "test_native_route_contract.py",
    "test_requested_parameters.py",
    "test_ui_selection_contract.py",
    "test_dynamo_preflight.py",
    "test_annotation_readback.py",
    "test_batch_tag_contract.py",
    "test_view_filters_contract.py",
    "test_view_create_contract.py",
    "test_native_host_preview.py",
    "test_native_pane_shell.py"
)
$liveHostTests = @(
    "test_real_connection.py"
)

$actual = @(
    Get-ChildItem -LiteralPath $testRoot -File -Filter "test_*.py" |
        Select-Object -ExpandProperty Name |
        Sort-Object
)
$known = @(($offlineTests + $liveHostTests) | Sort-Object -Unique)

$unknown = @($actual | Where-Object { $_ -notin $known })
$missing = @($known | Where-Object { $_ -notin $actual })
if ($unknown.Count -gt 0 -or $missing.Count -gt 0) {
    if ($unknown.Count -gt 0) {
        Write-Host ("Unclassified test files: " + ($unknown -join ", "))
    }
    if ($missing.Count -gt 0) {
        Write-Host ("Expected classified test files missing: " + ($missing -join ", "))
    }
    throw "Test inventory changed. Reviewer must classify each test as offline TESTABLE or live-host TEST_BLOCKED before CI may pass."
}

$python = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $python) {
    $python = Get-Command python -ErrorAction Stop
}

Push-Location $runtimeRoot
try {
    foreach ($testFile in $offlineTests) {
        Write-Host ("[TESTABLE] offline unit test: " + $testFile)
        & $python.Source -m unittest discover -s tests -p $testFile -v
        if ($LASTEXITCODE -ne 0) {
            throw "Offline unit test failed: $testFile"
        }
    }
}
finally {
    Pop-Location
}

foreach ($testFile in $liveHostTests) {
    Write-Host ("[TEST_BLOCKED] " + $testFile + " requires a real Revit + pyRevit host, explicit E-PY-5B safe-dispatch confirmation, and is intentionally NOT counted toward GitHub Actions PASS.")
}

Write-Host "[PASS] Offline Revit MCP unit tests completed; live-host evidence remains explicitly blocked outside CI."
