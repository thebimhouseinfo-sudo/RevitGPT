$ErrorActionPreference = "Stop"

$tray = Get-Content "revitgpt-tray.ps1" -Raw

$required = @(
    '\$runtimePid = \$script:RuntimePid',
    'if \(\$runtimePid -and -not \(Test-OwnedRuntime -ProcessId \$runtimePid\)\) \{ \$runtimePid = \$null \}',
    'if \(Test-OwnedRuntime -ProcessId \$candidate\) \{ \$runtimePid = \$candidate \}',
    '\$candidate = Get-PortOwnerPid -TargetPort \$Port',
    '\$tunnelPid = \$script:TunnelPid',
    'if \(\$tunnelPid -and -not \(Test-OwnedTunnel -ProcessId \$tunnelPid\)\) \{ \$tunnelPid = \$null \}',
    'if \(Test-OwnedTunnel -ProcessId \$candidate\) \{ \$tunnelPid = \$candidate \}',
    '\$candidate = Get-PortOwnerPid -TargetPort \$TunnelHealthPort'
)

foreach ($pattern in $required) {
    if ($tray -notmatch $pattern) {
        throw "Missing ownership-safe stale-state fallback contract: $pattern"
    }
}

if ($tray -match 'Get-Process\s+-Name\s+["'']?tunnel-client') {
    throw "Global tunnel-client process kill/discovery is forbidden; ownership must be profile-scoped."
}

Write-Host "[PASS] Tunnel/runtime stop logic is ownership-scoped and falls back from stale state to actual port owner"
