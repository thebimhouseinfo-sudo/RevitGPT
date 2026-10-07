$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$addinRoot = Join-Path $repoRoot "runtimes\Revit-mcp\bridge\standalone_addin"
$source = Join-Path $addinRoot "StartBridgeCommand.cs"
$project = Join-Path $addinRoot "RevitMCPBridge.csproj"
$installer = Join-Path $repoRoot "scripts\install-revit-bridge-addin.ps1"
$hostCheck = Join-Path $repoRoot "scripts\check-revit-bridge-host.ps1"

foreach ($path in @($source,$project,$installer,$hostCheck)) {
  if (-not (Test-Path $path)) { throw "Missing native bridge artifact: $path" }
}

$cs = Get-Content $source -Raw
foreach ($pattern in @(
  'class BridgeApplication : IExternalApplication',
  'class StartBridgeCommand : IExternalCommand',
  'ExternalEvent.Create',
  'http://127.0.0.1:8765/',
  'path == "/health"',
  'path == "/document/active"',
  'path == "/delete"'
)) {
  if ($cs -notmatch [regex]::Escape($pattern)) {
    throw "Native bridge lost static source marker: $pattern"
  }
}

$installerText = Get-Content $installer -Raw
foreach ($pattern in @(
  'Autodesk\Revit\Addins',
  'RevitMCPBridge.addin',
  'RevitMCPBridge.dll',
  'cddac4f78278e647c16c2bb79c888dd7adf6f181'
)) {
  if ($installerText -notmatch [regex]::Escape($pattern)) {
    throw "Native bridge installer static contract missing: $pattern"
  }
}

$hostText = Get-Content $hostCheck -Raw
if ($hostText -notmatch 'RevitMCPBridge\.BridgeApplication') {
  throw "Bridge host check does not recognize the native Revit add-in."
}

Write-Host "[PASS] STATIC_CONTRACT: native Revit bridge source/package markers are present"
Write-Host "[INFO] This check does NOT prove Revit runtime/threading behavior."
