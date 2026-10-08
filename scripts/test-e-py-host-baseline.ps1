$ErrorActionPreference = "Stop"

# All manifest changes below occur ONLY in isolated temporary AppData roots.
# No live Revit API, bridge HTTP request or real add-in manifest is changed.
$repoRoot = Split-Path -Parent $PSScriptRoot
$baseline = Join-Path $PSScriptRoot "e-py-host-baseline.ps1"
$extensionSource = Join-Path $repoRoot "runtimes\Revit-mcp\bridge\pyrevit_extension\RevitMCPBridge.extension"
$temp = Join-Path ([IO.Path]::GetTempPath()) ("revitgpt-e-py-host-" + [guid]::NewGuid().ToString("N"))
$savedAppData = $env:APPDATA
$savedLocalAppData = $env:LOCALAPPDATA
$savedProgramData = $env:ProgramData
$savedWinDir = $env:WINDIR

function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "ASSERTION_FAILED: $Message" }
}

function Invoke-ExpectFailure([string]$EvidenceFile, [string]$ExpectedMessage) {
    $failed = $false
    try {
        & $baseline -Mode PreparePyRevit -EvidencePath $EvidenceFile
    } catch {
        $failed = $true
        if ($_.Exception.Message -notmatch $ExpectedMessage) {
            throw ("Unexpected error: " + $_.Exception.Message)
        }
    }
    Assert $failed "Negative control unexpectedly passed: $ExpectedMessage"
    Assert (Test-Path -LiteralPath $EvidenceFile -PathType Leaf) "Failure evidence not written"
}

try {
    New-Item -ItemType Directory -Path $temp -Force | Out-Null
    $env:APPDATA = Join-Path $temp "Roaming"
    $env:LOCALAPPDATA = Join-Path $temp "Local"
    $env:ProgramData = Join-Path $temp "ProgramData"
    New-Item -ItemType Directory -Path $env:APPDATA,$env:LOCALAPPDATA,$env:ProgramData -Force | Out-Null

    $nativePath = Join-Path $env:APPDATA "Autodesk\Revit\Addins\2024\RevitMCPBridge.addin"
    $nativeFolder = Split-Path -Parent $nativePath
    New-Item -ItemType Directory -Path $nativeFolder -Force | Out-Null
    @'
<?xml version="1.0" encoding="utf-8"?>
<RevitAddIns>
  <AddIn Type="Application">
    <Name>RevitMCPBridge</Name>
    <FullClassName>RevitMCPBridge.BridgeApplication</FullClassName>
    <Assembly>C:\Fake\RevitMCPBridge.dll</Assembly>
  </AddIn>
</RevitAddIns>
'@ | Set-Content -LiteralPath $nativePath -Encoding UTF8
    $nativeHash = (Get-FileHash -LiteralPath $nativePath -Algorithm SHA256).Hash
    $disabledPath = $nativePath + ".e-py-disabled"

    $installed = Join-Path $env:APPDATA "pyRevit\Extensions\RevitMCPBridge.extension"
    New-Item -ItemType Directory -Path (Split-Path -Parent $installed) -Force | Out-Null
    Copy-Item -LiteralPath $extensionSource -Destination $installed -Recurse -Force

    # Positive control: prepare on an isolated manifest and restore exactly.
    $preparedEvidence = Join-Path $temp "prepared.json"
    & $baseline -Mode PreparePyRevit -EvidencePath $preparedEvidence
    $prepared = Get-Content -LiteralPath $preparedEvidence -Raw | ConvertFrom-Json
    Assert $prepared.pyrevit_evidence_ready "Prepared fixture did not produce ready evidence"
    Assert $prepared.port_8765.checked "Port preflight did not complete"
    Assert (-not $prepared.port_8765.listening) "Port 8765 is busy in test runner"
    Assert (-not (Test-Path -LiteralPath $nativePath)) "Native manifest remained enabled"
    Assert (Test-Path -LiteralPath $disabledPath) "Native manifest was not reversibly disabled"
    Assert ((Get-FileHash -LiteralPath $disabledPath -Algorithm SHA256).Hash -eq $nativeHash) "Manifest hash changed"

    & $baseline -Mode PreparePyRevit -EvidencePath (Join-Path $temp "repeat.json")
    Assert (Test-Path -LiteralPath $disabledPath) "Repeat prepare damaged disabled manifest"

    & $baseline -Mode RestoreNative -EvidencePath (Join-Path $temp "restored.json")
    Assert (Test-Path -LiteralPath $nativePath) "Restore did not restore original manifest"
    Assert (-not (Test-Path -LiteralPath $disabledPath)) "Disabled manifest was left after restore"
    Assert ((Get-FileHash -LiteralPath $nativePath -Algorithm SHA256).Hash -eq $nativeHash) "Restore changed manifest hash"
    Write-Host "[PASS] Isolated prepare/idempotence/restore + exact hash"

    # Red control: installed extension does not match source => no mutation.
    $installedStartup = Join-Path $installed "startup.py"
    $startupOriginal = Get-Content -LiteralPath $installedStartup -Raw
    "#! python2`n" + $startupOriginal | Set-Content -LiteralPath $installedStartup -Encoding UTF8
    Invoke-ExpectFailure (Join-Path $temp "bad-engine.json") "No installed pyRevit bridge matches"
    Assert (Test-Path -LiteralPath $nativePath) "Bad-engine preflight mutated manifest"
    Assert (-not (Test-Path -LiteralPath $disabledPath)) "Bad-engine preflight left manifest disabled"
    Set-Content -LiteralPath $installedStartup -Value $startupOriginal -Encoding UTF8
    Write-Host "[RED CONTROL PASS] installed extension mismatch blocks before mutation"

    # Red control: a blocked netstat child must time out, write UNKNOWN port
    # evidence, and preserve the existing manifest. This compiles only a fake
    # executable in the temporary test root; the real netstat is untouched.
    $fakeSystem32 = Join-Path $temp "FakeWindows\System32"
    New-Item -ItemType Directory -Path $fakeSystem32 -Force | Out-Null
    $fakeNetstat = Join-Path $fakeSystem32 "netstat.exe"
    $fakeSource = @'
using System;
using System.Threading;
public static class HangingNetstat {
    public static int Main(string[] args) {
        Thread.Sleep(30000);
        return 0;
    }
}
'@
    Add-Type -TypeDefinition $fakeSource -OutputAssembly $fakeNetstat -OutputType ConsoleApplication
    $env:WINDIR = Join-Path $temp "FakeWindows"
    $watch = [Diagnostics.Stopwatch]::StartNew()
    Invoke-ExpectFailure (Join-Path $temp "port-timeout.json") "exceeded 8 seconds"
    $watch.Stop()
    $timeoutEvidence = Get-Content -LiteralPath (Join-Path $temp "port-timeout.json") -Raw | ConvertFrom-Json
    Assert (-not $timeoutEvidence.port_8765.checked) "Timeout was falsely reported as checked"
    Assert (-not $timeoutEvidence.pyrevit_evidence_ready) "Timeout was falsely reported ready"
    Assert (Test-Path -LiteralPath $nativePath) "Timeout preflight mutated native manifest"
    Assert ($watch.Elapsed.TotalSeconds -lt 22) "Port timeout watchdog was too slow"
    Write-Host ("[RED CONTROL PASS] netstat hang terminates fail-closed ({0:N1} sec)" -f $watch.Elapsed.TotalSeconds)

    Write-Host "[PASS] E-PY host baseline positive + negative controls"
}
finally {
    $env:APPDATA = $savedAppData
    $env:LOCALAPPDATA = $savedLocalAppData
    $env:ProgramData = $savedProgramData
    $env:WINDIR = $savedWinDir
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}

exit 0
