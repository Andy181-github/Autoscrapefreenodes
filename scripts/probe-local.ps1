[CmdletBinding()]
param(
  [string]$InputFile = "artifacts/subs/mihomo.yaml",
  [string]$OutputDir = "artifacts/health/local",
  [string]$MihomoPath = "",
  [int]$TimeoutMs = 8000,
  [int]$Rounds = 4,
  [int]$Concurrency = 20,
  [int]$Limit = 0
)
$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $ProjectRoot
if (-not $MihomoPath) {
  if ($env:MIHOMO_BIN) { $MihomoPath = $env:MIHOMO_BIN }
  else {
    $MihomoPath = Join-Path $ProjectRoot ".tools\mihomo.exe"
    if (-not (Test-Path $MihomoPath)) {
      $Version = "v1.19.33"
      $ToolsDir = Split-Path $MihomoPath -Parent
      New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
      $ZipPath = Join-Path $env:TEMP "mihomo-windows-amd64-$Version.zip"
      $Url = "https://github.com/MetaCubeX/mihomo/releases/download/$Version/mihomo-windows-amd64-compatible-$Version.zip"
      Write-Host "Downloading pinned Mihomo $Version..."
      Invoke-WebRequest -Uri $Url -OutFile $ZipPath
      Expand-Archive -Path $ZipPath -DestinationPath $ToolsDir -Force
      Remove-Item $ZipPath -Force
      $Candidate = Get-ChildItem -Path $ToolsDir -Filter "mihomo*.exe" -Recurse | Select-Object -First 1
      if (-not $Candidate) { throw "Mihomo executable not found. Set -MihomoPath to an existing mihomo.exe." }
      if ($Candidate.FullName -ne $MihomoPath) { Copy-Item $Candidate.FullName $MihomoPath -Force }
    }
  }
}
if (-not (Test-Path $MihomoPath)) { throw "Mihomo binary not found: $MihomoPath" }
$ResolvedInput = Join-Path $ProjectRoot $InputFile
$ResolvedOutput = Join-Path $ProjectRoot $OutputDir
if (-not (Test-Path $ResolvedInput)) { throw "Input subscription not found: $ResolvedInput. Run scraper first or set -InputFile." }
Write-Host "Local probe only; FlClash configuration and processes will not be changed."
Write-Host "Input: $ResolvedInput"
Write-Host "Output: $ResolvedOutput"
$NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $NodeCommand) { $NodeCommand = Get-Command node -ErrorAction SilentlyContinue }
$NodeExecutable = if ($NodeCommand) { $NodeCommand.Source } else { "" }
if (-not $NodeExecutable -or [System.IO.Path]::GetExtension($NodeExecutable) -notin @(".exe", ".com")) {
  $Candidates = @((Join-Path $env:ProgramFiles "nodejs\node.exe"), (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe"))
  $NodeExecutable = $Candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $NodeExecutable) { throw "Node.js executable not found. Install Node.js 18+ and ensure node.exe is available." }
& $NodeExecutable (Join-Path $PSScriptRoot "probe-nodes.js") --mode local --input $ResolvedInput --output-dir $ResolvedOutput --mihomo-bin $MihomoPath --timeout $TimeoutMs --rounds $Rounds --concurrency $Concurrency --limit $Limit
$NodeExitCode = $LASTEXITCODE
if ($null -eq $NodeExitCode -or $NodeExitCode -ne 0) { throw "Local node probe failed: exit code $NodeExitCode" }
Write-Host "Done. See report.json, working.yaml and stable.yaml in $ResolvedOutput"
