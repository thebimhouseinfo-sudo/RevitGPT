$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path ".").Path
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$junction = Join-Path $tempRoot "RevitGPT Runtime With Spaces"
$stdout = Join-Path $tempRoot "revitgpt-smoke.out.log"
$stderr = Join-Path $tempRoot "revitgpt-smoke.err.log"
$proc = $null

$envNames = @("HOST","PORT","MCP_TOKEN","REVIT_BRIDGE_URL","REVITGPT_DEV_MODE")
$savedEnv = @{}
foreach ($name in $envNames) {
    $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

$envPath = Join-Path $repoRoot ".env"
$createdEnv = $false

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

if (Test-Path $junction) {
    & cmd.exe /d /c ('rmdir "' + $junction + '"') | Out-Null
}
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

    if (-not (Test-Path $envPath)) {
        Copy-Item (Join-Path $repoRoot ".env.example") $envPath
        $createdEnv = $true
    }

    $statusOut = & cmd.exe /d /c ('"' + (Join-Path $junction "run.bat") + '" status') 2>&1
    if ($LASTEXITCODE -ne 0) {
        $statusOut | ForEach-Object { Write-Host $_ }
        throw "run.bat status failed through a Windows path containing spaces."
    }
    if (($statusOut -join "`n") -notmatch "Tray\s+:") {
        throw "run.bat status did not produce expected status output."
    }

    Write-Host "[PASS] Slim MCP real startup + run.bat status from Windows path with spaces"
}
finally {
    if ($proc -and -not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        try { $proc.WaitForExit(5000) | Out-Null } catch {}
    }

    if ($createdEnv -and (Test-Path $envPath)) {
        Remove-Item $envPath -Force -ErrorAction SilentlyContinue
    }

    foreach ($name in $envNames) {
        $previous = $savedEnv[$name]
        if ($null -eq $previous) {
            Remove-Item "Env:$name" -ErrorAction SilentlyContinue
        } else {
            [Environment]::SetEnvironmentVariable($name, $previous, "Process")
        }
    }

    if (Test-Path $junction) {
        & cmd.exe /d /c ('rmdir "' + $junction + '"') | Out-Null
    }
}
