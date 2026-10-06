$ErrorActionPreference = "Stop"

$files = @(
    Get-ChildItem -Path "src","scripts" -Recurse -File -Filter "*.mjs" -ErrorAction SilentlyContinue |
        Sort-Object FullName
)

if ($files.Count -eq 0) {
    throw "No .mjs files found under src/scripts."
}

$failed = @()
foreach ($file in $files) {
    & node.exe --check $file.FullName
    if ($LASTEXITCODE -ne 0) {
        $failed += $file.FullName
    }
}

if ($failed.Count -gt 0) {
    Write-Host ""
    Write-Host "Node syntax failures:"
    $failed | ForEach-Object { Write-Host " - $_" }
    exit 1
}

Write-Host "[PASS] Node syntax scan: $($files.Count) files"
