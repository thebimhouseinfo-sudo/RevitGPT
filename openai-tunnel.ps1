param(
  [switch]$Init,
  [switch]$Doctor,
  [switch]$ProbeControlPlane,
  [switch]$RuntimeDiagnostics,
  [switch]$VerifyClient,
  [switch]$Force
)

$ErrorActionPreference="Stop"
$ScriptDir=Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$TunnelVersion="v0.0.15"
$BinDir=Join-Path $ScriptDir "bin"
$TunnelExe=[System.IO.Path]::GetFullPath((Join-Path $BinDir "tunnel-client.exe"))
$ProfileDir=[System.IO.Path]::GetFullPath((Join-Path $ScriptDir "profiles"))
$ProfileFile=[System.IO.Path]::GetFullPath((Join-Path $ProfileDir "revitgpt.yaml"))
$ZipName="tunnel-client-$TunnelVersion-windows-amd64.zip"
$DownloadUrl="https://github.com/openai/tunnel-client/releases/download/$TunnelVersion/$ZipName"
$ExpectedSha256="3b53133a1e24d43f63088d843860cb1701a4c3ed6390de2e19f69089e43bddc1"

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
  if($Force -and (Test-Path $TunnelExe)){Remove-Item $TunnelExe -Force}
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

function Redact-Secret([string]$Text,[string]$Secret){
  if($null -eq $Text){return ""}
  $safe=$Text
  if($Secret){$safe=$safe.Replace($Secret,"<redacted>")}
  return $safe
}
function Get-PortOwnerInfo([int]$Port){
  try{
    $conn=Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort $Port -State Listen -ErrorAction Stop|Select-Object -First 1
    if(-not $conn){return $null}
    $proc=Get-CimInstance Win32_Process -Filter "ProcessId = $($conn.OwningProcess)" -ErrorAction SilentlyContinue
    return [pscustomobject]@{
      pid=[int]$conn.OwningProcess
      name=if($proc){$proc.Name}else{"unknown"}
      command_line=if($proc){$proc.CommandLine}else{""}
    }
  }catch{
    try{
      $line=netstat -ano|Select-String ":$Port\s"|Select-String "LISTENING"|Select-Object -First 1
      if(-not $line){return $null}
      $parts=(($line.ToString()-replace '\s+',' ').Trim().Split(' '))
      $pid=[int]$parts[-1]
      $proc=Get-CimInstance Win32_Process -Filter "ProcessId = $pid" -ErrorAction SilentlyContinue
      return [pscustomobject]@{
        pid=$pid
        name=if($proc){$proc.Name}else{"unknown"}
        command_line=if($proc){$proc.CommandLine}else{""}
      }
    }catch{return $null}
  }
}
function Show-RuntimeDiagnostics([string]$ApiKey){
  $health=if(Get-EnvValue "OPENAI_TUNNEL_HEALTH_PORT"){[int](Get-EnvValue "OPENAI_TUNNEL_HEALTH_PORT")}else{8280}
  $owner=Get-PortOwnerInfo $health
  if($owner){
    $owned=($owner.command_line -and $owner.command_line.IndexOf($ProfileFile,[System.StringComparison]::OrdinalIgnoreCase) -ge 0)
    Write-Host ("[INFO] Tunnel health port {0} owner PID={1} name={2} revitgpt_owned={3}" -f $health,$owner.pid,$owner.name,$owned)
    if($owner.command_line){Write-Host ("[INFO] Owner command: " + (Redact-Secret $owner.command_line $ApiKey))}
  }else{
    Write-Host ("[INFO] Tunnel health port {0} has no LISTENING owner." -f $health)
  }

  $appData=Get-EnvValue "REVITGPT_APPDATA_ROOT"
  if([string]::IsNullOrWhiteSpace($appData)){$appData=Join-Path $env:LOCALAPPDATA "RevitGPT"}
  elseif(-not [System.IO.Path]::IsPathRooted($appData)){$appData=[System.IO.Path]::GetFullPath((Join-Path $ScriptDir $appData))}
  foreach($name in @("tunnel.err.log","tunnel.out.log","tray.log")){
    $path=Join-Path (Join-Path $appData "logs") $name
    if(Test-Path $path){
      Write-Host ("--- " + $name + " (last 20) ---")
      Get-Content $path -Tail 20 -ErrorAction SilentlyContinue|ForEach-Object{Write-Host (Redact-Secret ([string]$_) $ApiKey)}
    }
  }
}
function Probe-ControlPlane([string]$TunnelId,[string]$ApiKey){
  $savedControl=$env:CONTROL_PLANE_API_KEY
  $savedOpenAI=$env:OPENAI_API_KEY
  $savedAdmin=$env:OPENAI_ADMIN_KEY
  try{
    $env:CONTROL_PLANE_API_KEY=$ApiKey
    $env:OPENAI_API_KEY=$null
    $env:OPENAI_ADMIN_KEY=$null
    $output=& $TunnelExe admin --json tunnels get $TunnelId 2>&1|Out-String
    $code=$LASTEXITCODE
    $safe=Redact-Secret $output $ApiKey
    if($code -eq 0){
      Write-Host ("[PASS] Live control-plane lookup succeeded for " + $TunnelId)
      try{
        $obj=$output|ConvertFrom-Json
        $orgs=@($obj.organization_ids)
        $workspaces=@($obj.workspace_ids)
        if($orgs.Count -gt 0){Write-Host ("[INFO] organization_ids=" + ($orgs -join ","))}
        if($workspaces.Count -gt 0){Write-Host ("[INFO] workspace_ids=" + ($workspaces -join ","))}
      }catch{}
      return $true
    }
    Write-Host ("[FAIL] Live control-plane lookup failed for " + $TunnelId)
    if($safe.Trim()){Write-Host $safe.Trim()}
    return $false
  }finally{
    $env:CONTROL_PLANE_API_KEY=$savedControl
    $env:OPENAI_API_KEY=$savedOpenAI
    $env:OPENAI_ADMIN_KEY=$savedAdmin
  }
}
Install-Tunnel
if($VerifyClient){
  $target=$TunnelVersion.TrimStart("v")
  $versionLine=& $TunnelExe --version 2>$null | Select-Object -First 1
  if($LASTEXITCODE -ne 0 -or $versionLine -notmatch '(\d+\.\d+\.\d+)' -or $Matches[1] -ne $target){
    throw "tunnel-client version verification failed. Expected $target, got '$versionLine'"
  }
  Write-Host "[PASS] tunnel-client $target verified."
  exit 0
}
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
if($Doctor){& $TunnelExe doctor --profile-file $ProfileFile --health.listen-addr 127.0.0.1:0 --explain;exit $LASTEXITCODE}
if($RuntimeDiagnostics){Show-RuntimeDiagnostics $key;exit 0}
if($ProbeControlPlane){
  if(Probe-ControlPlane $id $key){exit 0}else{exit 3}
}
& $TunnelExe run --profile-file $ProfileFile
exit $LASTEXITCODE
