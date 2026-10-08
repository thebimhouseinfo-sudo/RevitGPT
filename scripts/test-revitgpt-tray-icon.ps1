$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$checker = Join-Path $PSScriptRoot "check-revitgpt-tray-icon.ps1"
$real = Join-Path $repoRoot "assets\revitgpt-tray.png"
$fake = Join-Path ([System.IO.Path]::GetTempPath()) ("invalid-rg-icon-" + [guid]::NewGuid().ToString("N") + ".png")
try {
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $checker -IconPath $real
    if ($LASTEXITCODE -ne 0) { throw "Valid RevitGPT tray icon rejected" }
    [System.IO.File]::WriteAllText($fake, "not a real PNG")
    # Windows PowerShell 5.1 may wrap expected native stderr in
    # NativeCommandError when ErrorActionPreference is Stop.
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $checker -IconPath $fake -SkipWiring 2>&1 | Out-Null
        $negativeExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($negativeExitCode -eq 0) { throw "Negative control unexpectedly accepted invalid icon" }
    Write-Host "[RED CONTROL PASS] corrupt PNG rejected"
    Write-Host "[PASS] RevitGPT icon positive and negative controls"
} finally {
    Remove-Item -LiteralPath $fake -Force -ErrorAction SilentlyContinue
}
exit 0
