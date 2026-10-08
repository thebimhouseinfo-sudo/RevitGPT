$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "tunnel-version-contract.ps1")

foreach ($text in @(
    "0.0.15",
    "v0.0.15",
    "0.0.15+a390c168ff1b2d14e73a95991c186c6aba3ff5a0 (git main)",
    "tunnel-client 0.0.15+build.12"
)) {
    if (-not (Test-TunnelVersionContract -VersionText $text -RequiredVersion "0.0.15")) {
        throw "Valid version text rejected: $text"
    }
}

foreach ($text in @(
    "0.0.14",
    "0.0.16",
    "0.0.150",
    "v0.0.15-rc.1",
    "not a version",
    "0.0.14+git 0.0.15"
)) {
    if (Test-TunnelVersionContract -VersionText $text -RequiredVersion "0.0.15") {
        throw "Red control unexpectedly passed: $text"
    }
}

Write-Host "[PASS] tunnel-client version strict core + build metadata parser and 6 red controls"
