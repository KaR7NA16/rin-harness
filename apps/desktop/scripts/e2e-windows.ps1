$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$installer = Get-ChildItem 'apps/desktop/src-tauri/target' -Recurse -File -Filter '*.exe' |
  Where-Object { $_.FullName -match '[\\/]bundle[\\/]nsis[\\/]' } |
  Select-Object -First 1
if (-not $installer) { throw 'NSIS installer was not produced.' }

$installRoot = Join-Path $env:RUNNER_TEMP 'rin-installed'
if (Test-Path -LiteralPath $installRoot) {
  Remove-Item -LiteralPath $installRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $installRoot | Out-Null

$install = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installRoot") -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "NSIS installer exited with $($install.ExitCode)." }

$app = Join-Path $installRoot 'rin.exe'
if (-not (Test-Path -LiteralPath $app)) {
  $candidate = Get-ChildItem $installRoot -Recurse -File -Filter 'rin.exe' | Select-Object -First 1
  if (-not $candidate) { throw "Installed rin.exe was not found under $installRoot." }
  $app = $candidate.FullName
}

$logRoot = Join-Path $env:RUNNER_TEMP 'rin-desktop-e2e'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$env:RIN_HOST_LOG_PATH = Join-Path $logRoot 'host.log'
[Environment]::SetEnvironmentVariable('NODE_OPTIONS', $null, 'Process')
[Environment]::SetEnvironmentVariable('NODE_PATH', $null, 'Process')
$env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
$env:RIN_HOME = Join-Path $env:RUNNER_TEMP 'rin-home'

$gui = $null
try {
  $gui = Start-Process -FilePath $app -PassThru -RedirectStandardOutput (Join-Path $logRoot 'rin.stdout.log') -RedirectStandardError (Join-Path $logRoot 'rin.stderr.log')

  $status = $null
  for ($attempt = 0; $attempt -lt 90; $attempt += 1) {
    if ($gui.HasExited) { throw "Installed rin exited early with $($gui.ExitCode)." }
    try {
      $status = Invoke-RestMethod -Uri 'http://127.0.0.1:8320/api/status' -TimeoutSec 2
      if ($status.status -eq 'ok') { break }
    } catch {}
    Start-Sleep -Seconds 1
  }
  if ($null -eq $status -or $status.status -ne 'ok') {
    throw 'Installed rin did not expose a healthy /api/status within 90 seconds.'
  }
  $status | ConvertTo-Json -Depth 8

  Stop-Process -Id $gui.Id -Force
  $gui.WaitForExit()
  $gui = $null

  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    if (-not (Get-Process -Name 'rin-sidecar' -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Seconds 1
  }
  if (Get-Process -Name 'rin-sidecar' -ErrorAction SilentlyContinue) {
    throw 'rin-sidecar remained after the GUI was force-killed.'
  }
} catch {
  Get-ChildItem $installRoot -Recurse -File |
    Select-Object FullName, Length |
    Format-Table -AutoSize
  foreach ($log in @('rin.stdout.log', 'rin.stderr.log', 'host.log')) {
    $path = Join-Path $logRoot $log
    if (Test-Path -LiteralPath $path) {
      Write-Host "=== $log ==="
      Get-Content -LiteralPath $path
    }
  }
  throw
} finally {
  if ($null -ne $gui -and -not $gui.HasExited) {
    Stop-Process -Id $gui.Id -Force -ErrorAction SilentlyContinue
  }
  Get-Process -Name 'rin-sidecar' -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  $uninstaller = Get-ChildItem $installRoot -Recurse -File -Filter 'uninstall*.exe' |
    Select-Object -First 1
  if ($uninstaller) {
    Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait
  }
}
