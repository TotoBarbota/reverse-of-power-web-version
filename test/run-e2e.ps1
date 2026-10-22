# Plays one scripted game end to end: fake console + built relay + headless Chrome phone.
# Usage: powershell -ExecutionPolicy Bypass -File test\run-e2e.ps1 -Ip <this PC's LAN IP> [-Mode kip|decades] [-Script kip|decades|offline]
param([Parameter(Mandatory = $true)][string]$Ip, [string]$Mode = 'kip', [string]$Script = '', [int]$Port = 8099)
$ErrorActionPreference = 'Stop'
if (-not $Script) { $Script = $Mode }
$root = Split-Path -Parent $PSScriptRoot
$test = $PSScriptRoot
$shots = "$test\shots-$Script"
Remove-Item -Recurse -Force $shots -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $shots | Out-Null
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'kip-relay|fake-console' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Milliseconds 500
$fake = Start-Process node -ArgumentList "$test\fake-console.mjs", $Ip, $Mode, $Script -RedirectStandardOutput "$shots\fake.log" -RedirectStandardError "$shots\fake.err" -PassThru -WindowStyle Hidden
$relay = Start-Process node -ArgumentList "$root\dist\kip-relay.mjs", '--port', $Port, '--console', $Ip, '--no-elevate', '--single' -WorkingDirectory $shots -RedirectStandardOutput "$shots\relay.log" -RedirectStandardError "$shots\relay.err" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3
$driver = Start-Process node -ArgumentList "$test\e2e.mjs", "http://${Ip}:$Port/", $Script, $shots -WorkingDirectory $root -RedirectStandardOutput "$shots\driver.log" -RedirectStandardError "$shots\driver.err" -PassThru -WindowStyle Hidden
$deadline = (Get-Date).AddSeconds(290)
while ((Get-Date) -lt $deadline -and -not $driver.HasExited) {
  if ((Get-Content "$shots\fake.log" -ErrorAction SilentlyContinue) -match '"ev":"done"') { Start-Sleep -Seconds 4; New-Item -ItemType File "$shots\STOP" -Force | Out-Null; break }
  Start-Sleep -Seconds 2
}
$driver.WaitForExit(20000) | Out-Null
foreach ($p in @($driver, $fake, $relay)) { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match 'headless' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
"=== phone messages ==="
Get-Content "$shots\fake.log" | Select-String '"ev":"(in|step|done|error)"' | ForEach-Object { $l = $_.Line; if ($l.Length -gt 330) { $l.Substring(0, 330) } else { $l } } | Where-Object { $_ -notmatch 'ImageResource|DeviceInfo|RequestPlayerID|AvatarStatus|AllResources' }
"=== driver ==="
Get-Content "$shots\driver.log" | Where-Object { $_ -notmatch ' shot ' }
Get-Content "$shots\driver.err" -ErrorAction SilentlyContinue
"=== relay (tail) ==="
Get-Content "$shots\relay.log" -Tail 8
