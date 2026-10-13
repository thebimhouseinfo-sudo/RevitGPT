$ErrorActionPreference="Stop"
$root=Split-Path -Parent $PSScriptRoot
$legacy=Get-Content (Join-Path $root "runtimes\Revit-mcp\bridge\standalone_addin\StartBridgeCommand.cs") -Raw
if($legacy -notmatch '_pendingMutateAction' -or $legacy -notmatch 'Thread.Sleep'){ throw "Old unsafe source fingerprint drifted; re-review required" }
$installer=Get-Content (Join-Path $root "scripts\install-revit-bridge-addin.ps1") -Raw
$run=Get-Content (Join-Path $root "run.bat") -Raw
if($installer -notmatch '(?m)^throw "LEGACY_UNSAFE_NATIVE_BRIDGE_BLOCKED:' -or $installer -match 'Copy-Item|Invoke-WebRequest|Set-Content'){throw "Old installer not fail closed"}
if($run -notmatch '\[BLOCKED\] Legacy unsafe RevitMCPBridge' -or $run -notmatch '\[BLOCKED\] Legacy pyRevit bridge retired'){throw "Old run shortcuts not blocked"}
if(-not (Test-Path (Join-Path $root "runtimes\Revit-mcp\bridge\unified_native\BridgeDispatchQueue.cs"))){throw "Native source missing"}
Write-Host "[PASS] Unsafe legacy bridge activation is blocked; new native dispatch core tracked."
