$ErrorActionPreference = "Stop"

$root = Join-Path $env:RUNNER_TEMP "RevitGPT Path With Spaces"
Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $root | Out-Null

try {
    $nodeProbe = Join-Path $root "node probe.mjs"
    $nodeMarker = Join-Path $root "node-ok.txt"
    @"
import fs from "node:fs";
fs.writeFileSync(process.env.REVITGPT_SIM_NODE_MARKER, "ok", "utf8");
"@ | Set-Content -Path $nodeProbe -Encoding UTF8

    $env:REVITGPT_SIM_NODE_MARKER = $nodeMarker
    $nodeOut = Join-Path $root "node.out.log"
    $nodeErr = Join-Path $root "node.err.log"
    $node = Start-Process -FilePath "node.exe" -ArgumentList @("`"$nodeProbe`"") -WorkingDirectory $root -Wait -PassThru -RedirectStandardOutput $nodeOut -RedirectStandardError $nodeErr
    if ($node.ExitCode -ne 0 -or -not (Test-Path $nodeMarker)) {
        Get-Content $nodeErr -ErrorAction SilentlyContinue
        throw "Node path-with-spaces launch simulation failed."
    }

    $profile = Join-Path $root "profiles\revitgpt profile.yaml"
    New-Item -ItemType Directory -Force -Path (Split-Path $profile -Parent) | Out-Null
    "config_version: 1" | Set-Content -Path $profile -Encoding UTF8

    $stub = Join-Path $root "tunnel probe.cmd"
    $argsOut = Join-Path $root "tunnel-args.txt"
    @"
@echo off
> "%~dp0tunnel-args.txt" echo %1^|%2^|%~3
exit /b 0
"@ | Set-Content -Path $stub -Encoding ASCII

    $tunnel = Start-Process -FilePath $stub -ArgumentList @("run", "--profile-file", "`"$profile`"") -WorkingDirectory $root -Wait -PassThru
    if ($tunnel.ExitCode -ne 0 -or -not (Test-Path $argsOut)) {
        throw "Tunnel argument launch simulation failed."
    }

    $actual = (Get-Content $argsOut -Raw).Trim()
    $expected = "run|--profile-file|$profile"
    if ($actual -ne $expected) {
        throw "Tunnel path-with-spaces argument mismatch. Expected '$expected' but got '$actual'."
    }

    Write-Host "[PASS] Windows path-with-spaces launch simulation"
}
finally {
    Remove-Item Env:REVITGPT_SIM_NODE_MARKER -ErrorAction SilentlyContinue
    Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}
