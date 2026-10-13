$ErrorActionPreference = "Stop"

function Get-CurrentParseErrors([string]$Path) {
    $tokens = $null
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile(
        $Path,
        [ref]$tokens,
        [ref]$errors
    )
    return @($errors)
}

function Invoke-WindowsPowerShellParse([string]$Path) {
    $escaped = $Path.Replace("'", "''")
    $command = @"
`$tokens = `$null
`$errors = `$null
[void][System.Management.Automation.Language.Parser]::ParseFile('$escaped', [ref]`$tokens, [ref]`$errors)
if (`$errors.Count -gt 0) {
    `$errors | ForEach-Object { [Console]::Error.WriteLine(`$_.Message) }
    exit 1
}
exit 0
"@
    $output = & powershell.exe -NoProfile -NonInteractive -Command $command 2>&1
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = @($output)
    }
}

$winPs = Get-Command powershell.exe -ErrorAction SilentlyContinue
if (-not $winPs) {
    throw "powershell.exe is required because RevitGPT Windows scripts must remain compatible with Windows PowerShell 5.1."
}

$winMajorText = (& powershell.exe -NoProfile -NonInteractive -Command '$PSVersionTable.PSVersion.Major' 2>&1 | Select-Object -Last 1)
$winMajor = 0
if (-not [int]::TryParse([string]$winMajorText, [ref]$winMajor) -or $winMajor -ne 5) {
    throw "Expected Windows PowerShell 5.x compatibility parser, got: $winMajorText"
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("revitgpt-ps-syntax-" + [guid]::NewGuid().ToString("N"))
try {
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

    $positive = Join-Path $tempRoot "positive.ps1"
    $negative = Join-Path $tempRoot "negative.ps1"
    $ps7Only = Join-Path $tempRoot "ps7-only.ps1"

    'Write-Output "ok"' | Set-Content -LiteralPath $positive -Encoding UTF8
    'if (' | Set-Content -LiteralPath $negative -Encoding UTF8
    '$value = $true ? 1 : 0' | Set-Content -LiteralPath $ps7Only -Encoding UTF8

    if ((Get-CurrentParseErrors $positive).Count -ne 0) {
        throw "Current PowerShell positive control failed."
    }
    if ((Invoke-WindowsPowerShellParse $positive).ExitCode -ne 0) {
        throw "Windows PowerShell 5.1 positive control failed."
    }

    if ((Get-CurrentParseErrors $negative).Count -eq 0) {
        throw "Current PowerShell negative control unexpectedly parsed."
    }
    if ((Invoke-WindowsPowerShellParse $negative).ExitCode -eq 0) {
        throw "Windows PowerShell 5.1 negative control unexpectedly parsed."
    }

    $ps7OnlyWin = Invoke-WindowsPowerShellParse $ps7Only
    if ($ps7OnlyWin.ExitCode -eq 0) {
        throw "Windows PowerShell 5.1 compatibility sentinel unexpectedly accepted PS7 ternary syntax."
    }
    if ($PSVersionTable.PSVersion.Major -ge 7 -and (Get-CurrentParseErrors $ps7Only).Count -ne 0) {
        throw "PowerShell 7 compatibility sentinel was expected to parse in pwsh but did not."
    }

    $roots = @(
        Get-ChildItem -Path "." -File -Filter "*.ps1" -ErrorAction SilentlyContinue
        Get-ChildItem -Path "scripts" -Recurse -File -Filter "*.ps1" -ErrorAction SilentlyContinue
    )
    $files = @($roots | Sort-Object FullName -Unique)
    if ($files.Count -eq 0) {
        throw "No PowerShell scripts found."
    }

    $failures = @()
    foreach ($file in $files) {
        $currentErrors = @(Get-CurrentParseErrors $file.FullName)
        if ($currentErrors.Count -gt 0) {
            $failures += [pscustomobject]@{
                Engine = "current-pwsh"
                Path = $file.FullName
                Detail = (($currentErrors | ForEach-Object { $_.Message }) -join "; ")
            }
        }

        $winResult = Invoke-WindowsPowerShellParse $file.FullName
        if ($winResult.ExitCode -ne 0) {
            $failures += [pscustomobject]@{
                Engine = "windows-powershell-5.1"
                Path = $file.FullName
                Detail = (($winResult.Output | ForEach-Object { [string]$_ }) -join "; ")
            }
        }
    }

    if ($failures.Count -gt 0) {
        Write-Host "PowerShell syntax/compatibility failures:"
        foreach ($failure in $failures) {
            Write-Host (" - [{0}] {1}: {2}" -f $failure.Engine,$failure.Path,$failure.Detail)
        }
        exit 1
    }

    Write-Host "[PASS] PowerShell validator positive + negative controls"
    Write-Host "[PASS] Windows PowerShell 5.1 rejects PS7-only compatibility sentinel"
    Write-Host "[PASS] PowerShell syntax scan: $($files.Count) files on pwsh + Windows PowerShell 5.1"
}
finally {
    Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
