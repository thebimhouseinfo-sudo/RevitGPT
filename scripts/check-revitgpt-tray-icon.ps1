param(
    [string]$IconPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "assets\revitgpt-tray.png"),
    [switch]$SkipWiring
)
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath $IconPath -PathType Leaf)) {
    throw "RevitGPT tray icon missing: $IconPath"
}
$bytes = [System.IO.File]::ReadAllBytes($IconPath)
$signature = [byte[]](137,80,78,71,13,10,26,10)
if ($bytes.Length -lt 32) { throw "Tray icon is truncated." }
for ($i=0; $i -lt 8; $i++) {
    if ($bytes[$i] -ne $signature[$i]) { throw "Tray icon has invalid PNG signature." }
}
Add-Type -AssemblyName System.Drawing
$stream = New-Object System.IO.MemoryStream(,$bytes)
$image = $null
try {
    $image = [System.Drawing.Image]::FromStream($stream)
    if ($image.Width -lt 64 -or $image.Height -lt 64) {
        throw "Tray icon is too small: $($image.Width)x$($image.Height)"
    }
} finally {
    if ($image) { $image.Dispose() }
    $stream.Dispose()
}
if (-not $SkipWiring) {
    $traySource = Get-Content -LiteralPath (Join-Path $repoRoot "revitgpt-tray.ps1") -Raw
    $setupSource = Get-Content -LiteralPath (Join-Path $repoRoot "setup.bat") -Raw
    if ($traySource -notmatch 'assets\\revitgpt-tray[.]png') {
        throw "Tray does not use the RevitGPT-owned icon."
    }
    if ($traySource -match 'Join-Path \$ScriptDir "icon[.]png"' -or
        $setupSource -match '(?i)Cadgpt\\icon[.]png') {
        throw "Legacy CadGPT icon wiring remains."
    }
}
Write-Host "[PASS] RevitGPT-owned tray PNG valid and independent of CadGPT."
