param(
  [switch]$Init,
  [switch]$Doctor,
  [switch]$Force
)

$ErrorActionPreference="Stop"
$ScriptDir=Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$TunnelVersion="v0.0.14"
$BinDir=Join-Path $ScriptDir "bin"
$TunnelExe=[System.IO.Path]::GetFullPath((Join-Path $BinDir "tunnel-client.exe"))
$ProfileDir=[System.IO.Path]::GetFullPath((Join-Path $ScriptDir "profiles"))
$ProfileFile=[System.IO.Path]::GetFullPath((Join-Path $ProfileDir "revitgpt.yaml"))
$ZipName="tunnel-client-$TunnelVersion-windows-amd64.zip"
$DownloadUrl="https://github.com/openai/tunnel-client/releases/download/$TunnelVersion/$ZipName"
$ExpectedSha256="784ab8da7b5a88f0109f1fd8aaf0a1c86067430b896dddf307ef7e3cc49fa1a5"

function Get-EnvValue([string]$Name){
  if(-not (Test-Path ".env")){return $null}
  $line=Get-Content ".env"|Where-Object{$_ -match "^\s*$Name\s*=" -and -not $_.TrimStart().StartsWith("#")}|Select-Object -First 1
  if(-not $line){return $null}
  return (($line -split "=",2)[1].Trim()).Trim("'").Trim('"')
}
function Set-EnvValue([string]$Name,[string]$Value){
  if(-not (Test-Path ".env")){Copy-Item ".env.example" ".env"}
  $lines=@(Get-Content ".env");$found=$false
  $out=foreach($line in $lines){
    if($line -match "^\s*$Name\s*=" -and -not $line.TrimStart().StartsWith("#")){$found=$true;"$Name=$Value"}else{$line}
  }
  if(-not $found){$out+="$Name=$Value"}
  Set-Content ".env" -Value $out -Encoding UTF8
}
function Ensure-Token{
  $token=Get-EnvValue "MCP_TOKEN"
  if(-not $token -or $token -eq "replace-with-a-random-private-token"){
    $token=[guid]::NewGuid().ToString("N")+[guid]::NewGuid().ToString("N")
    Set-EnvValue "MCP_TOKEN" $token
    Write-Host "[OK] Generated private MCP path token."
  }
  return $token
}
function Install-Tunnel{
  $target=$TunnelVersion.TrimStart("v")
  if(Test-Path $TunnelExe){
    try{$line=& $TunnelExe --version 2>$null|Select-Object -First 1;if($line -match '(\d+\.\d+\.\d+)'){if($Matches[1] -eq $target){return}}}catch{}
    Remove-Item $TunnelExe -Force
  }
  New-Item -ItemType Directory -Force -Path $BinDir|Out-Null
  $zip=Join-Path $env:TEMP ("revitgpt-"+[guid]::NewGuid().ToString("N")+"-"+$ZipName)
  try{
    $curl=Get-Command curl.exe -ErrorAction SilentlyContinue
    if($curl){& $curl.Source -fL --retry 2 --retry-delay 2 -o $zip $DownloadUrl;if($LASTEXITCODE -ne 0){throw "Tunnel download failed"}}else{Invoke-WebRequest -Uri $DownloadUrl -OutFile $zip -UseBasicParsing}
    $actual=(Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
    if($actual -ne $ExpectedSha256){throw "Tunnel ZIP SHA256 mismatch"}
    Expand-Archive $zip $BinDir -Force
    $candidate=Get-ChildItem $BinDir -Recurse -Filter "tunnel-client.exe"|Select-Object -First 1
    if(-not $candidate){throw "tunnel-client.exe missing after extract"}
    if($candidate.FullName -ne $TunnelExe){Move-Item $candidate.FullName $TunnelExe -Force}
  }finally{Remove-Item $zip -Force -ErrorAction SilentlyContinue}
}
function Ensure-Profile([string]$TunnelId){
  $port=if(Get-EnvValue "PORT"){[int](Get-EnvValue "PORT")}else{3300}
  $health=if(Get-EnvValue "OPENAI_TUNNEL_HEALTH_PORT"){[int](Get-EnvValue "OPENAI_TUNNEL_HEALTH_PORT")}else{8280}
  $token=Ensure-Token
  New-Item -ItemType Directory -Force -Path $ProfileDir|Out-Null
  $yaml=@"
config_version: 1
control_plane:
  tunnel_id: $TunnelId
  api_key: env:OPENAI_TUNNEL_API_KEY
log:
  level: info
  format: struct-text
health:
  listen_addr: 127.0.0.1:$health
mcp:
  server_urls:
    - channel: main
      url: http://127.0.0.1:$port/mcp/$token
"@
  Set-Content $ProfileFile -Value $yaml -Encoding UTF8
}
Install-Tunnel
if(-not (Get-EnvValue "PORT")){Set-EnvValue "PORT" "3300"}
if(-not (Get-EnvValue "OPENAI_TUNNEL_HEALTH_PORT")){Set-EnvValue "OPENAI_TUNNEL_HEALTH_PORT" "8280"}
$null=Ensure-Token

if($Init){
  $id=Get-EnvValue "OPENAI_TUNNEL_ID";if(-not $id){$id=Read-Host "OPENAI_TUNNEL_ID (tunnel_...)"}
  $key=Get-EnvValue "OPENAI_TUNNEL_API_KEY";if(-not $key){$key=Read-Host "OPENAI_TUNNEL_API_KEY (Runtime API key)"}
  if(-not $id -or $id -notmatch '^tunnel_[0-9a-fA-F]{32}$'){throw "Invalid OPENAI_TUNNEL_ID"}
  if(-not $key){throw "OPENAI_TUNNEL_API_KEY is required"}
  Set-EnvValue "OPENAI_TUNNEL_ID" $id
  Set-EnvValue "OPENAI_TUNNEL_API_KEY" $key
  Ensure-Profile $id
  Write-Host "[OK] RevitGPT Secure MCP Tunnel configured."
  exit 0
}

$id=Get-EnvValue "OPENAI_TUNNEL_ID";$key=Get-EnvValue "OPENAI_TUNNEL_API_KEY"
if(-not $id -or -not $key){throw "Tunnel not configured. Run openai-tunnel.ps1 -Init"}
Ensure-Profile $id
$env:OPENAI_TUNNEL_API_KEY=$key
if($Doctor){& $TunnelExe doctor --profile-file $ProfileFile --explain;exit $LASTEXITCODE}
& $TunnelExe run --profile-file $ProfileFile
exit $LASTEXITCODE
