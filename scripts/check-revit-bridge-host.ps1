$ErrorActionPreference = "Stop"

# P3: the official RevitGPT Native host supersedes legacy RevitMCPBridge
# and pyRevit. A valid registered assembly proves installation, NOT that
# Revit has loaded the add-in (Revit may be closed).
$officialName = "RevitGPT.addin"
$officialClass = "RevitGPT.Native.RevitGptApplication"
$officialGuid = "9FE9A6D0-E4C9-4B8F-88F8-50E726EC0D02"
foreach ($folder in @(
  (Join-Path $env:APPDATA "Autodesk\\Revit\\Addins\\2024"),
  (Join-Path $env:ProgramData "Autodesk\\Revit\\Addins\\2024")
)) {
  $manifest = Join-Path $folder $officialName
  if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { continue }
  try {
    [xml]$xml = Get-Content -LiteralPath $manifest -Raw
    $addins = @($xml.RevitAddIns.AddIn)
    if ($addins.Count -ne 1) { throw "Unexpected add-in count" }
    $addin = $addins[0]
    if ([string]$addin.Type -ne "Application" -or
        [string]$addin.FullClassName -ne $officialClass -or
        [string]$addin.AddInId -ne $officialGuid -or
        [string]$addin.VendorId -ne "TBH" -or
        [string]$addin.Name -ne "RevitGPT") {
      throw "Official RevitGPT Native identity mismatch"
    }
    $assembly = [string]$addin.Assembly
    if (-not [IO.Path]::IsPathRooted($assembly) -or
        [IO.Path]::GetFileName($assembly) -ne "RevitGPT.Native.dll" -or
        -not (Test-Path -LiteralPath $assembly -PathType Leaf)) {
      throw "Official Native DLL missing or invalid path: $assembly"
    }
    Write-Host ("[OK] Official RevitGPT Native 2024 installed: " + $manifest)
    Write-Host ("[INFO] Native assembly: " + $assembly)
    Write-Host "[INFO] This confirms registration only; host readiness requires Revit running and bridge health."
    exit 0
  } catch {
    Write-Host ("[FAIL] Official RevitGPT manifest invalid: " + $_.Exception.Message)
    exit 2
  }
}

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
$pyPackage = $pyRoots | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($pyPackage) {
  . (Join-Path $PSScriptRoot "pyrevit-runtime.ps1")
  $runtimeReady = [bool](Find-PyRevitCli)
  if (-not $runtimeReady) {
    foreach ($year in @(Get-RunningRevitYears)) {
      $attachment = Get-PyRevitAttachmentInfo -Year $year
      if ($attachment -and -not $attachment.ParseError -and $attachment.AssemblyExists) {
        $runtimeReady = $true
        break
      }
    }
  }
  if ($runtimeReady) {
    Write-Host ("[OK] pyRevit bridge fallback package + runtime: " + $pyPackage)
    Write-Host "[INFO] Native standalone add-in is preferred; pyRevit remains optional fallback."
    exit 0
  }
  Write-Host ("[INFO] pyRevit bridge folder exists but no usable pyRevit runtime/loader was found: " + $pyPackage)
}

Write-Host "[FAIL] No usable Revit MCP bridge host is installed."
Write-Host "[INFO] Preferred: run .\run.bat install-bridge to install the native CAD-Agent-derived Revit add-in."
exit 2
