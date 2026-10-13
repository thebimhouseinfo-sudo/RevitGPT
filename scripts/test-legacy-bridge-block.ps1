$ErrorActionPreference="Stop"
$root=Split-Path -Parent $PSScriptRoot
$target=Join-Path $root "scripts\install-revit-bridge-addin.ps1"
$psi=New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName="powershell.exe"
$psi.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $target + '"'
$psi.UseShellExecute=$false
$psi.CreateNoWindow=$true
$psi.RedirectStandardOutput=$true
$psi.RedirectStandardError=$true
$p=[System.Diagnostics.Process]::Start($psi)
try {
  $stdout=$p.StandardOutput.ReadToEndAsync()
  $stderr=$p.StandardError.ReadToEndAsync()
  if(-not $p.WaitForExit(15000)){$p.Kill();throw "Installer watchdog"}
  $output=$stdout.GetAwaiter().GetResult()+[Environment]::NewLine+$stderr.GetAwaiter().GetResult()
  if($p.ExitCode -eq 0 -or $output -notmatch "LEGACY_UNSAFE_NATIVE_BRIDGE_BLOCKED"){throw "Legacy negative control failed"}
  Write-Host "[RED CONTROL PASS] Unsafe legacy installer refused activation."
}finally{$p.Dispose()}
