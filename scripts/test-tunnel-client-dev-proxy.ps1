$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path ".").Path
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$stdout = Join-Path $tempRoot "revitgpt-tunnel-dev-proxy.out.log"
$stderr = Join-Path $tempRoot "revitgpt-tunnel-dev-proxy.err.log"
$serverOut = Join-Path $tempRoot "revitgpt-tunnel-target.out.log"
$serverErr = Join-Path $tempRoot "revitgpt-tunnel-target.err.log"
$server = $null

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

$token = "ci-tunnel-client-token"
$saved = @{}
foreach ($name in @("HOST","PORT","MCP_TOKEN","REVIT_BRIDGE_URL","REVITGPT_DEV_MODE")) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

try {
    $env:HOST = "127.0.0.1"
    $env:PORT = "$port"
    $env:MCP_TOKEN = $token
    $env:REVIT_BRIDGE_URL = "http://127.0.0.1:65530"
    $env:REVITGPT_DEV_MODE = "0"

    $server = Start-Process -FilePath "node.exe" -ArgumentList @("src/index.mjs") -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr

    $health = $null
    foreach ($i in 1..40) {
        if ($server.HasExited) { break }
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 1
            if ($health.status -eq "ok") { break }
        } catch {}
        Start-Sleep -Milliseconds 250
    }
    if (-not $health -or $server.HasExited) {
        Write-Host "=== RevitGPT target stderr ==="
        Get-Content $serverErr -ErrorAction SilentlyContinue
        Write-Host "=== RevitGPT target stdout ==="
        Get-Content $serverOut -ErrorAction SilentlyContinue
        throw "RevitGPT target did not become ready."
    }

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot "openai-tunnel.ps1") -VerifyClient
    if ($LASTEXITCODE -ne 0) { throw "tunnel-client verification failed." }

    $tunnelExe = Join-Path $repoRoot "bin\tunnel-client.exe"
    $target = "http://127.0.0.1:$port/mcp/$token"
    $args = @(
        "dev", "proxy",
        "--mcp-server-url", $target,
        "--listen", "127.0.0.1:0",
        "--health-listen-addr", "127.0.0.1:0",
        "--readiness-timeout", "8s",
        "--duration", "2s",
        "--print-json"
    )
    $proc = Start-Process -FilePath $tunnelExe -ArgumentList $args -WorkingDirectory $repoRoot -PassThru -Wait -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $outText = (Get-Content $stdout -Raw -ErrorAction SilentlyContinue)
    $errText = (Get-Content $stderr -Raw -ErrorAction SilentlyContinue)

    if ($proc.ExitCode -ne 0) {
        Write-Host "=== tunnel-client dev proxy stdout ==="
        Write-Host $outText
        Write-Host "=== tunnel-client dev proxy stderr ==="
        Write-Host $errText
        Write-Host "=== RevitGPT target stderr ==="
        Get-Content $serverErr -ErrorAction SilentlyContinue
        Write-Host "=== RevitGPT target stdout ==="
        Get-Content $serverOut -ErrorAction SilentlyContinue
        throw "tunnel-client 0.0.15 dev proxy failed against RevitGPT. ExitCode=$($proc.ExitCode)"
    }

    if ($outText -notmatch '"mcp_url"' -and $outText -notmatch 'MCP URL') {
        Write-Host "=== tunnel-client dev proxy stdout ==="
        Write-Host $outText
        Write-Host "=== tunnel-client dev proxy stderr ==="
        Write-Host $errText
        throw "tunnel-client dev proxy did not publish local MCP ingress."
    }

    Write-Host "[PASS] tunnel-client 0.0.15 connected to RevitGPT through exact dev-proxy runtime"
}
finally {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
        try { $server.WaitForExit(5000) | Out-Null } catch {}
    }
    foreach ($name in $saved.Keys) {
        $previous = $saved[$name]
        if ($null -eq $previous) {
            Remove-Item "Env:$name" -ErrorAction SilentlyContinue
        } else {
            [Environment]::SetEnvironmentVariable($name, $previous, "Process")
        }
    }
}
