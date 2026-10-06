$ErrorActionPreference = "Stop"

$roots = @(
    Get-ChildItem -Path "." -File -Filter "*.ps1" -ErrorAction SilentlyContinue
    Get-ChildItem -Path "scripts" -Recurse -File -Filter "*.ps1" -ErrorAction SilentlyContinue
)

$files = $roots | Sort-Object FullName -Unique
if ($files.Count -eq 0) {
    throw "No PowerShell scripts found."
}

foreach ($file in $files) {
    try {
        [void][scriptblock]::Create((Get-Content $file.FullName -Raw))
    }
    catch {
        Write-Host "PowerShell syntax failure: $($file.FullName)"
        throw
    }
}

Write-Host "[PASS] PowerShell syntax scan: $($files.Count) files"
