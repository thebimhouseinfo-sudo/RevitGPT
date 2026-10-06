$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path ".").Path
$junction = Join-Path $env:RUNNER_TEMP "RevitGPT Runtime With Spaces"
$port = 33991
$stdout = Join-Path $env:RUNNER_TEMP "revitgpt-smoke.out.log"
$stderr = Join-Path $env:RUNNER_TEMP "revitgpt-smoke.err.log"
$proc = $null

Remove-Item $junction -Force -Recurse -ErrorAction SilentlyContinue
New-Item -ItemType Junction -Path $junction -Target $repoRoot | Out-Null

try {
    $env:HOST = "127.0.0.1"
    $env:PORT = "$port"
    $env:MCP_TOKEN = "ci-smoke-token"
    $env:REVIT_BRIDGE_URL = "http://127.0.0.1:65530"
    $env:REVITGPT_DEV_MODE = "0"

    $indexPath = Join-Path $junction "src\index.mjs"
    $proc = Start-Process -FilePath "node.exe" -ArgumentList @("`"$indexPath`"") -WorkingDirectory $junction -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr

    $health = $null
    foreach ($i in 1..40) {
        if ($proc.HasExited) { break }
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 1
            if ($health.status -eq "ok") { break }
        } catch {}
        Start-Sleep -Milliseconds 250
    }

    if ($proc.HasExited -or -not $health) {
        Write-Host "=== slim MCP stderr ==="
        Get-Content $stderr -ErrorAction SilentlyContinue
        Write-Host "=== slim MCP stdout ==="
        Get-Content $stdout -ErrorAction SilentlyContinue
        throw "Slim MCP failed to start from a path containing spaces."
    }

    if ($health.name -ne "revitgpt") { throw "Unexpected health name: $($health.name)" }
    if ($health.revit_mcp.running) { throw "Full Revit MCP must not auto-start while Revit is absent." }

    Write-Host "[PASS] Slim MCP real startup from Windows path with spaces"
}
finally {
    if ($proc -and -not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        try { $proc.WaitForExit(5000) | Out-Null } catch {}
    }
    foreach ($name in @("HOST","PORT","MCP_TOKEN","REVIT_BRIDGE_URL","REVITGPT_DEV_MODE")) {
        Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    }
    Remove-Item $junction -Force -Recurse -ErrorAction SilentlyContinue
}
