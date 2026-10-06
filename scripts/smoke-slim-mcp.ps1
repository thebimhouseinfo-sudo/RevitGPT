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

    $mcpUri = "http://127.0.0.1:$port/mcp/ci-smoke-token"
    $initBody = @{
        jsonrpc = "2.0"
        id = 1
        method = "initialize"
        params = @{
            protocolVersion = "2025-03-26"
            capabilities = @{}
            clientInfo = @{ name = "revitgpt-ci-smoke"; version = "1.0.0" }
        }
    } | ConvertTo-Json -Depth 8
    try {
        $init = Invoke-WebRequest $mcpUri -Method Post -ContentType "application/json" -Headers @{
            Accept = "application/json, text/event-stream"
        } -Body $initBody -UseBasicParsing -TimeoutSec 5
    } catch {
        Write-Host "=== slim MCP stderr ==="
        Get-Content $stderr -ErrorAction SilentlyContinue
        Write-Host "=== slim MCP stdout ==="
        Get-Content $stdout -ErrorAction SilentlyContinue
        throw "RevitGPT MCP initialize failed: $($_.Exception.Message)"
    }
    if ($init.StatusCode -ne 200) { throw "MCP initialize HTTP $($init.StatusCode)" }
    $sessionId = $init.Headers["Mcp-Session-Id"]
    if (-not $sessionId) { throw "MCP initialize missing Mcp-Session-Id" }

    $toolsBody = @{
        jsonrpc = "2.0"
        id = 2
        method = "tools/list"
        params = @{}
    } | ConvertTo-Json -Depth 8
    $tools = Invoke-WebRequest $mcpUri -Method Post -ContentType "application/json" -Headers @{
        Accept = "application/json, text/event-stream"
        "Mcp-Session-Id" = $sessionId
        "Mcp-Protocol-Version" = "2025-03-26"
    } -Body $toolsBody -UseBasicParsing -TimeoutSec 5
    if ($tools.StatusCode -ne 200) { throw "tools/list HTTP $($tools.StatusCode)" }
    $toolsJson = $tools.Content | ConvertFrom-Json
    if (-not ($toolsJson.result.tools.name -contains "revitgpt_admission")) {
        throw "revitgpt_admission not present in tools/list"
    }

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

    Write-Host "[PASS] Slim MCP startup + MCP initialize/tools-list + run.bat status from Windows path with spaces"
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
