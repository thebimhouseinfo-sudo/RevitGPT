# Isolated file-system test for official local install (never on user manifests).
$ErrorActionPreference="Stop"
Set-StrictMode -Version Latest
$script = Join-Path $PSScriptRoot "manage-native-revitgpt-install.ps1"
$temp = Join-Path ([IO.Path]::GetTempPath()) ("rg-installed-e2e-"+[guid]::NewGuid().ToString("N"))
$envOld=@{APPDATA=$env:APPDATA;ProgramData=$env:ProgramData;LOCALAPPDATA=$env:LOCALAPPDATA}
function Assert([bool]$condition,[string]$note){if(-not $condition){throw "FAIL: $note"}}
function Fail([scriptblock]$operation,[string]$note){
  $failed=$false
  try { & $operation | Out-Null } catch { $failed=$true }
  Assert $failed $note
}
try {
  $env:APPDATA=Join-Path $temp "Roaming"
  $env:ProgramData=Join-Path $temp "ProgramData"
  $env:LOCALAPPDATA=Join-Path $temp "LocalAppData"
  $src=Join-Path $temp "build"
  New-Item -ItemType Directory -Path (Join-Path $src "x64"),$env:APPDATA,$env:ProgramData,$env:LOCALAPPDATA -Force | Out-Null
  foreach($f in @("RevitGPT.Native.dll","Microsoft.Web.WebView2.Core.dll","Microsoft.Web.WebView2.Wpf.dll")){
    [IO.File]::WriteAllText((Join-Path $src $f),"mock-$f")
  }
  [IO.File]::WriteAllText((Join-Path $src "x64\WebView2Loader.dll"),"mock loader")
  & $script -Action Validate -SourceDirectory $src -Version "test-01" | Out-Null
  $dir=Join-Path $env:APPDATA "Autodesk\Revit\Addins\2024"
  $official=Join-Path $dir "RevitGPT.addin"
  $preview=Join-Path $dir "RevitGPT.preview.addin"
  Fail { & $script -Action Install -SourceDirectory $src -Version "test-01" } "install without approval rejected"
  Assert (-not(Test-Path $official)) "No official manifest before approval"
  & $script -Action Install -SourceDirectory $src -Version "test-01" -ApproveHostChange | Out-Null
  Assert (Test-Path $official) "Installed official manifest"
  [xml]$xml=Get-Content -LiteralPath $official -Raw
  Assert ([string]$xml.RevitAddIns.AddIn.Name -eq "RevitGPT") "Official host identity"
  Assert ([string]$xml.RevitAddIns.AddIn.Assembly -like "*test-01*") "References immutable version"
  Fail { & $script -Action Install -SourceDirectory $src -Version "test-01" -ApproveHostChange } "Version not overwritten"
  & $script -Action Install -SourceDirectory $src -Version "test-02" -ApproveHostChange | Out-Null
  Assert ((Get-Content -LiteralPath $official -Raw) -match "test-02") "Official upgrade succeeded"
  & $script -Action Uninstall -ApproveHostChange | Out-Null
  Assert (-not (Test-Path $official)) "Official unregistered"
  $backups=@(Get-ChildItem (Join-Path $env:LOCALAPPDATA "RevitGPT\install-backups\2024") -File)
  Assert ($backups.Count -ge 2) "Original manifest backups retained"

  [IO.File]::WriteAllText($official,"<RevitAddIns>foreign</RevitAddIns>")
  Fail { & $script -Action Install -SourceDirectory $src -Version "test-03" -ApproveHostChange } "Foreign official refused"
  Fail { & $script -Action Uninstall -ApproveHostChange } "Foreign official uninstall refused"
  Assert ((Get-Content -LiteralPath $official -Raw) -match "foreign") "Foreign manifest preserved"
  Remove-Item -LiteralPath $official

  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $previewXml=@"
<RevitAddIns><AddIn Type="Application">
<Name>RevitGPT Native Preview</Name>
<Assembly>C:\safe\RevitGPT.Native.dll</Assembly>
<AddInId>9FE9A6D0-E4C9-4B8F-88F8-50E726EC0D02</AddInId>
<FullClassName>RevitGPT.Native.RevitGptApplication</FullClassName>
<VendorId>TBH</VendorId></AddIn></RevitAddIns>
"@
  [IO.File]::WriteAllText($preview,$previewXml)
  Fail { & $script -Action Install -SourceDirectory $src -Version "test-03" -ApproveHostChange } "Preview migration explicit"
  & $script -Action Install -SourceDirectory $src -Version "test-03" -ApproveHostChange -MigratePreview | Out-Null
  Assert ((Test-Path $official) -and -not(Test-Path $preview)) "Preview migrated to official"
  & $script -Action Uninstall -ApproveHostChange | Out-Null
  Write-Host "[PASS] Source-based official RevitGPT install, upgrade, explicit migration, backup, collision, negative controls."
} finally {
  $env:APPDATA=$envOld.APPDATA
  $env:ProgramData=$envOld.ProgramData
  $env:LOCALAPPDATA=$envOld.LOCALAPPDATA
  if(Test-Path $temp){Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue}
}
