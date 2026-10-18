[CmdletBinding()]
param([switch]$InstallNative)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
if (Get-Process -Name Revit -ErrorAction SilentlyContinue) {
  if ($InstallNative) { throw "Close Revit before upgrading the Native add-in." }
}
function Require-Ok([string]$label) {
  if ($LASTEXITCODE -ne 0) { throw "$label failed (exit $LASTEXITCODE)" }
}
Write-Host "P3 offline checks in $repo"
node --version
Require-Ok "node"
npm ci
Require-Ok "npm ci"
Get-ChildItem src -Filter *.mjs | ForEach-Object { node --check $_.FullName; Require-Ok "Node syntax: $($_.Name)" }
Get-ChildItem tests -Filter *.test.mjs | ForEach-Object { node --check $_.FullName; Require-Ok "Node test syntax: $($_.Name)" }
 $testPaths = @((Get-ChildItem -Path tests -Filter "p3-*.test.mjs").FullName) + @(Join-Path $repo "tests\m8-mcp-dev-reload.test.mjs")
node --test @testPaths
Require-Ok "P3 Node tests"
$python = Join-Path $repo "runtimes\Revit-mcp\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
  throw "Python runtime missing: run setup.bat first (with RevitGPT Native already installed)."
}
Push-Location "runtimes\Revit-mcp"
try {
  & $python -m compileall -q connection tools services tests
  Require-Ok "Python syntax"
  & $python -m unittest discover -s tests -p 'test_p3_*.py' -v
  Require-Ok "P3 Python tests"
  & $python -m unittest discover -s tests -p "test_native_route_contract.py" -v
  Require-Ok "Native/Python route parity"
} finally { Pop-Location }
dotnet build "runtimes\Revit-mcp\bridge\unified_native\RevitGPT.Native.csproj" --configuration Release --nologo
Require-Ok "Native build against local Revit 2024 API"
if ($InstallNative) {
  if (Get-Process -Name Revit -ErrorAction SilentlyContinue) {
    throw "Close Revit before changing its installed Native add-in."
  }
  $sha = (git rev-parse --short=10 HEAD).Trim()
  Require-Ok "git rev-parse"
  $version = "p3-" + $sha
  & "$PSScriptRoot\manage-native-revitgpt-install.ps1" -Action Validate
  & "$PSScriptRoot\manage-native-revitgpt-install.ps1" -Action Install -Version $version -ApproveHostChange
  Write-Host "[OK] Installed RevitGPT Native version $version"
}
Write-Host "[PASS] Offline checks/build completed."
if ($InstallNative) {
  & "$repo\run.bat" restart
  Require-Ok "runtime restart"
  & "$repo\run.bat" doctor
  Require-Ok "runtime doctor"
  Write-Host "Next: follow docs/roadmap/P3_HUMAN_TEST_BATCH.md in a disposable Revit 2024 project."
} else {
  Write-Host "Native not installed. Run with -InstallNative after confirming tests."
}
