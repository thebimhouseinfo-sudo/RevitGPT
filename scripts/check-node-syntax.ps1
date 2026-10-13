$ErrorActionPreference = "Stop"

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("revitgpt-node-syntax-" + [guid]::NewGuid().ToString("N"))

function Invoke-NodeCheck([string]$Path) {
    $output = & node.exe --check $Path 2>&1
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = @($output)
    }
}

try {
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

    $positive = Join-Path $tempRoot "positive.mjs"
    $negative = Join-Path $tempRoot "negative.mjs"
    'export const ok = 1;' | Set-Content -LiteralPath $positive -Encoding UTF8
    'export const broken = ;' | Set-Content -LiteralPath $negative -Encoding UTF8

    $positiveResult = Invoke-NodeCheck $positive
    if ($positiveResult.ExitCode -ne 0) {
        $positiveResult.Output | ForEach-Object { Write-Host $_ }
        throw "Node syntax positive control failed; the validator environment is not trustworthy."
    }

    $negativeResult = Invoke-NodeCheck $negative
    if ($negativeResult.ExitCode -eq 0) {
        throw "Node syntax negative control unexpectedly passed; fail-closed validation is broken."
    }

    $files = @(
        Get-ChildItem -Path "src","scripts" -Recurse -File -Filter "*.mjs" -ErrorAction SilentlyContinue |
            Sort-Object FullName
    )

    if ($files.Count -eq 0) {
        throw "No .mjs files found under src/scripts."
    }

    $failed = @()
    foreach ($file in $files) {
        $result = Invoke-NodeCheck $file.FullName
        if ($result.ExitCode -ne 0) {
            $failed += [pscustomobject]@{
                Path = $file.FullName
                Output = $result.Output
            }
        }
    }

    if ($failed.Count -gt 0) {
        Write-Host ""
        Write-Host "Node syntax failures:"
        foreach ($item in $failed) {
            Write-Host (" - " + $item.Path)
            $item.Output | ForEach-Object { Write-Host ("   " + $_) }
        }
        exit 1
    }

    Write-Host "[PASS] Node syntax validator positive + negative controls"
    Write-Host "[PASS] Node syntax scan: $($files.Count) repository files"
}
finally {
    Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
