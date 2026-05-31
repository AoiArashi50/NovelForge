#Requires -RunAsAdministrator

param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern("^[A-Z]$")]
    [string]$TargetDrive,

    [string]$TargetPath = "",

    [switch]$SkipConfirm
)

$ErrorActionPreference = "Stop"

if ($TargetPath -eq "") {
    $TargetPath = "${TargetDrive}:\WSL\Docker"
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Docker WSL Migrate Tool" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$driveInfo = Get-PSDrive -Name $TargetDrive -ErrorAction SilentlyContinue
if (-not $driveInfo) {
    Write-Error "Target drive ${TargetDrive}: not found."
    exit 1
}

$freeSpaceGB = [math]::Round($driveInfo.Free / 1GB, 2)
Write-Host "Target Drive : ${TargetDrive}:" -ForegroundColor Yellow
Write-Host "Free Space   : ${freeSpaceGB} GB" -ForegroundColor Yellow
Write-Host "Target Path  : $TargetPath" -ForegroundColor Yellow
Write-Host ""

if ($freeSpaceGB -lt 10) {
    Write-Warning "Free space is less than 10GB. Recommend 20GB+."
    $continue = Read-Host "Continue anyway? (y/N)"
    if ($continue -ne "y" -and $continue -ne "Y") {
        Write-Host "Cancelled." -ForegroundColor Red
        exit 0
    }
}

if (-not $SkipConfirm) {
    Write-Host "WARNING: This will unregister Docker WSL instances." -ForegroundColor Red
    Write-Host "Please ensure Docker Desktop is fully quit." -ForegroundColor Red
    Write-Host ""
    $confirm = Read-Host "Continue? (y/N)"
    if ($confirm -ne "y" -and $confirm -ne "Y") {
        Write-Host "Cancelled." -ForegroundColor Red
        exit 0
    }
}

Write-Host ""
Write-Host "[1/6] Checking WSL status..." -ForegroundColor Green
$wslCheck = wsl --list --verbose 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error "WSL is not installed or not available."
    exit 1
}

$distros = (wsl --list --quiet 2>$null) -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
$hasDockerData = $distros -contains "docker-desktop-data"
$hasDocker = $distros -contains "docker-desktop"

if (-not $hasDockerData -and -not $hasDocker) {
    Write-Error "No Docker WSL distributions found."
    exit 1
}

Write-Host "  Found distributions:" -ForegroundColor Gray
if ($hasDockerData) { Write-Host "    - docker-desktop-data" -ForegroundColor Gray }
if ($hasDocker) { Write-Host "    - docker-desktop" -ForegroundColor Gray }

Write-Host ""
Write-Host "[2/6] Shutting down WSL..." -ForegroundColor Green
wsl --shutdown | Out-Null
Start-Sleep -Seconds 3
Write-Host "  WSL stopped." -ForegroundColor Gray

Write-Host ""
Write-Host "[3/6] Creating target directories..." -ForegroundColor Green
New-Item -ItemType Directory -Path $TargetPath -Force | Out-Null
$dataPath = Join-Path $TargetPath "docker-desktop-data"
$enginePath = Join-Path $TargetPath "docker-desktop"
New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
New-Item -ItemType Directory -Path $enginePath -Force | Out-Null
Write-Host "  Created: $TargetPath" -ForegroundColor Gray

$tempTarData = Join-Path $TargetPath "docker-desktop-data.tar"
$tempTarEngine = Join-Path $TargetPath "docker-desktop.tar"

if ($hasDockerData) {
    Write-Host ""
    Write-Host "[4/6] Exporting docker-desktop-data (this may take a while)..." -ForegroundColor Green
    Write-Host "  Exporting, please wait..." -ForegroundColor Yellow
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    wsl --export docker-desktop-data "$tempTarData"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Export docker-desktop-data failed."
        exit 1
    }
    $sw.Stop()
    $tarSize = [math]::Round((Get-Item $tempTarData).Length / 1MB, 2)
    Write-Host "  Done: ${tarSize} MB, took $($sw.Elapsed.TotalSeconds)s" -ForegroundColor Gray
}

if ($hasDocker) {
    Write-Host ""
    Write-Host "[5/6] Exporting docker-desktop..." -ForegroundColor Green
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    wsl --export docker-desktop "$tempTarEngine"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Export docker-desktop failed."
        exit 1
    }
    $sw.Stop()
    $tarSize = [math]::Round((Get-Item $tempTarEngine).Length / 1MB, 2)
    Write-Host "  Done: ${tarSize} MB, took $($sw.Elapsed.TotalSeconds)s" -ForegroundColor Gray
}

Write-Host ""
Write-Host "[6/6] Unregistering and re-importing..." -ForegroundColor Green

if ($hasDockerData) {
    Write-Host "  Unregister docker-desktop-data..." -ForegroundColor Gray
    wsl --unregister docker-desktop-data | Out-Null
    Write-Host "  Import to $dataPath ..." -ForegroundColor Gray
    wsl --import docker-desktop-data "$dataPath" "$tempTarData"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Import docker-desktop-data failed!"
        exit 1
    }
    Remove-Item "$tempTarData" -Force
    Write-Host "  docker-desktop-data migrated." -ForegroundColor Gray
}

if ($hasDocker) {
    Write-Host "  Unregister docker-desktop..." -ForegroundColor Gray
    wsl --unregister docker-desktop | Out-Null
    Write-Host "  Import to $enginePath ..." -ForegroundColor Gray
    wsl --import docker-desktop "$enginePath" "$tempTarEngine"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Import docker-desktop failed!"
        exit 1
    }
    Remove-Item "$tempTarEngine" -Force
    Write-Host "  docker-desktop migrated." -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Migration Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "WSL distributions:" -ForegroundColor Yellow
wsl --list --verbose
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Open Docker Desktop" -ForegroundColor White
Write-Host "  2. Wait for Docker engine to start" -ForegroundColor White
Write-Host "  3. Run: docker-compose up --build -d" -ForegroundColor White
Write-Host ""
