$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path ".").Path
$envPath = Join-Path $repoRoot ".env"
$backup = $null
$hadEnv = Test-Path $envPath
if ($hadEnv) { $backup = Get-Content $envPath -Raw }

$listener = $null
$outFile = Join-Path $env:TEMP "revitgpt-tunnel-doctor.out.log"
$errFile = Join-Path $env:TEMP "revitgpt-tunnel-doctor.err.log"

try {
    @"
HOST=127.0.0.1
PORT=3300
MCP_TOKEN=test-token
OPENAI_TUNNEL_HEALTH_PORT=8280
OPENAI_TUNNEL_ID=tunnel_0123456789abcdef0123456789abcdef
OPENAI_TUNNEL_API_KEY=test-invalid-runtime-key
"@ | Set-Content -Path $envPath -Encoding UTF8

    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 8280)
    $listener.Start()

    $proc = Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", "`"$(Join-Path $repoRoot 'openai-tunnel.ps1')`"",
        "-Doctor"
    ) -WorkingDirectory $repoRoot -Wait -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile

    $output = ((Get-Content $outFile -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content $errFile -Raw -ErrorAction SilentlyContinue))
    if ($output -notmatch "CHECK health_listener\s+PASS") {
        Write-Host $output
        throw "Tunnel doctor did not isolate its health listener from occupied port 8280."
    }
    if ($output -match "FAILED_CHECKS[^\r\n]*health_listener") {
        Write-Host $output
        throw "Tunnel doctor still reported health_listener as failed while 8280 was occupied."
    }
    if ($output -match [regex]::Escape("test-token")) {
        throw "Tunnel doctor leaked MCP_TOKEN in diagnostic output."
    }
    if ($output -match [regex]::Escape("test-invalid-runtime-key")) {
        throw "Tunnel doctor leaked Runtime API key in diagnostic output."
    }

    Write-Host "[PASS] Tunnel doctor uses an isolated health listener and redacts secrets while configured port is occupied"
}
finally {
    if ($listener) { $listener.Stop() }
    if ($hadEnv) {
        [System.IO.File]::WriteAllText($envPath, $backup, (New-Object System.Text.UTF8Encoding($false)))
    } else {
        Remove-Item $envPath -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $outFile,$errFile -Force -ErrorAction SilentlyContinue
}
