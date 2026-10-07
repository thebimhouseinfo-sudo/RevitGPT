$ErrorActionPreference = "Stop"

$years = @(2024)
foreach ($proc in @(Get-CimInstance Win32_Process -Filter "Name='Revit.exe'" -ErrorAction SilentlyContinue)) {
  $samples = @([string]$proc.ExecutablePath)
  if ($proc.ExecutablePath -and (Test-Path $proc.ExecutablePath)) {
    try {
      $vi = (Get-Item $proc.ExecutablePath).VersionInfo
      $samples += @([string]$vi.ProductName,[string]$vi.FileDescription,[string]$vi.ProductVersion)
    } catch {}
  }
  foreach ($sample in $samples) {
    if ($sample -match '(20\d{2})') { $years += [int]$Matches[1]; break }
  }
}
$years = @($years | Sort-Object -Unique)

foreach ($year in $years) {
  foreach ($root in @(
    (Join-Path $env:APPDATA "Autodesk\Revit\Addins\$year"),
    (Join-Path $env:ProgramData "Autodesk\Revit\Addins\$year")
  )) {
    $manifest = Join-Path $root "RevitMCPBridge.addin"
    if (-not (Test-Path $manifest)) { continue }
    try {
      [xml]$xml = Get-Content $manifest -Raw
      $addin = @($xml.RevitAddIns.AddIn) | Where-Object { $_.FullClassName -eq "RevitMCPBridge.BridgeApplication" } | Select-Object -First 1
      if ($addin) {
        $assembly = [string]$addin.Assembly
        if ($assembly -and (Test-Path $assembly)) {
          Write-Host ("[OK] Native Revit MCP Bridge add-in: " + $manifest)
          Write-Host ("[INFO] Bridge assembly: " + $assembly)
          exit 0
        }
        Write-Host ("[WARN] RevitMCPBridge.addin exists but assembly is missing: " + $assembly)
      }
    } catch {
      Write-Host ("[WARN] Could not parse native bridge manifest: " + $_.Exception.Message)
    }
  }
}

$pyRoots = @(
  (Join-Path $env:APPDATA "pyRevit\Extensions\RevitMCPBridge.extension\startup.py"),
  (Join-Path $env:LOCALAPPDATA "pyRevit\Extensions\RevitMCPBridge.extension\startup.py"),
  "C:\ProgramData\pyRevit\Extensions\RevitMCPBridge.extension\startup.py"
)
foreach ($path in $pyRoots) {
  if (Test-Path $path) {
    Write-Host ("[OK] pyRevit bridge fallback package: " + $path)
    Write-Host "[INFO] Native standalone add-in is preferred; pyRevit remains optional fallback."
    exit 0
  }
}

Write-Host "[FAIL] No usable Revit MCP bridge host is installed."
Write-Host "[INFO] Preferred: run .\run.bat install-bridge to install the native CAD-Agent-derived Revit add-in."
exit 2
