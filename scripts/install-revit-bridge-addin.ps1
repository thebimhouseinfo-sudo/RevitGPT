param(
  [int]$RevitYear = 2024,
  [switch]$PreferPinnedCadAgentBinary
)
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $repoRoot "runtimes\Revit-mcp\bridge\standalone_addin"
$project = Join-Path $sourceDir "RevitMCPBridge.csproj"
$revitDir = "C:\Program Files\Autodesk\Revit $RevitYear"
$revitApi = Join-Path $revitDir "RevitAPI.dll"
$destRoot = Join-Path $env:APPDATA "Autodesk\Revit\Addins\$RevitYear"
$destDir = Join-Path $destRoot "RevitMCPBridge"
$destDll = Join-Path $destDir "RevitMCPBridge.dll"
$manifest = Join-Path $destRoot "RevitMCPBridge.addin"
$pinnedCommit = "cddac4f78278e647c16c2bb79c888dd7adf6f181"
$pinnedUrl = "https://raw.githubusercontent.com/thebimhouseinfo-sudo/CAD-Agent/$pinnedCommit/runtimes/Revit-mcp/bridge/standalone_addin/bin/Debug/net48/RevitMCPBridge.dll"
$builtDll = Join-Path $sourceDir "bin\Release\net48\RevitMCPBridge.dll"

if (-not (Test-Path $revitApi)) {
  throw "Revit $RevitYear API not found: $revitApi"
}

New-Item -ItemType Directory -Force -Path $destDir | Out-Null

$installedFrom = $null
if (-not $PreferPinnedCadAgentBinary) {
  $dotnet = Get-Command dotnet.exe -ErrorAction SilentlyContinue
  if (-not $dotnet) { $dotnet = Get-Command dotnet -ErrorAction SilentlyContinue }
  if ($dotnet) {
    Write-Host "[INFO] Building standalone Revit bridge from RevitGPT source..."
    & $dotnet.Source build $project -c Release "-p:RevitInstallDir=$revitDir"
    if ($LASTEXITCODE -eq 0 -and (Test-Path $builtDll)) {
      Copy-Item $builtDll $destDll -Force
      $installedFrom = "RevitGPT source build"
    } else {
      Write-Host "[WARN] Source build unavailable; falling back to the pinned CAD-Agent binary that previously worked."
    }
  } else {
    Write-Host "[INFO] dotnet SDK not found; using the pinned CAD-Agent bridge binary."
  }
}

if (-not $installedFrom) {
  $tmp = Join-Path $env:TEMP "RevitMCPBridge-$pinnedCommit.dll"
  Invoke-WebRequest -Uri $pinnedUrl -OutFile $tmp -UseBasicParsing
  if ((Get-Item $tmp).Length -ne 55808) {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    throw "Pinned CAD-Agent bridge download size mismatch."
  }
  Copy-Item $tmp $destDll -Force
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  $installedFrom = "CAD-Agent pinned binary $pinnedCommit"
}

$assemblyXml = [System.Security.SecurityElement]::Escape($destDll)
$addin = @"
<?xml version="1.0" encoding="utf-8"?>
<RevitAddIns>
  <AddIn Type="Application">
    <Name>Revit MCP Bridge</Name>
    <Assembly>$assemblyXml</Assembly>
    <AddInId>A1B2C3D4-E5F6-7890-ABCD-EF1234567890</AddInId>
    <FullClassName>RevitMCPBridge.BridgeApplication</FullClassName>
    <VendorId>RevitMCP</VendorId>
    <VendorDescription>RevitGPT standalone Revit MCP Bridge</VendorDescription>
  </AddIn>
</RevitAddIns>
"@
New-Item -ItemType Directory -Force -Path $destRoot | Out-Null
Set-Content -Path $manifest -Value $addin -Encoding UTF8

Write-Host "[OK] Standalone Revit MCP Bridge installed."
Write-Host ("[INFO] DLL: " + $destDll)
Write-Host ("[INFO] Manifest: " + $manifest)
Write-Host ("[INFO] Source: " + $installedFrom)
if (@(Get-Process -Name Revit -ErrorAction SilentlyContinue).Count -gt 0) {
  Write-Host "[INFO] Revit is running. Fully restart Revit so it loads RevitMCPBridge.addin."
}
Write-Host "[INFO] After restart, use Revit ribbon panel 'Revit MCP Bridge' > 'Start Bridge'."
