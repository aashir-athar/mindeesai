# local-cron-loop.ps1
#
# Fires http://localhost:3000/api/cron/self-improve every 5 minutes.
# Reads CRON_SECRET from .env.local automatically. Keep this terminal
# open while `npm run dev` runs in another one.
#
# Press Ctrl+C to stop.
#
# Usage:
#   .\scripts\local-cron-loop.ps1                    # default: 5-min interval
#   .\scripts\local-cron-loop.ps1 -IntervalMin 1     # faster polling
#   .\scripts\local-cron-loop.ps1 -Port 3001         # if dev on different port

param(
    [int]$IntervalMin = 5,
    [int]$Port = 3000,
    [string]$EnvFile = ".env.local"
)

$ErrorActionPreference = "Stop"

# Locate repo root
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# Pull CRON_SECRET from .env.local
if (-not (Test-Path $EnvFile)) {
    Write-Host "✗ $EnvFile not found. Run from the repo root or pass -EnvFile <path>." -ForegroundColor Red
    exit 1
}
$line = Get-Content $EnvFile | Where-Object { $_ -match '^CRON_SECRET=' } | Select-Object -First 1
if (-not $line) {
    Write-Host "✗ CRON_SECRET= line not found in $EnvFile" -ForegroundColor Red
    exit 1
}
$secret = $line -replace '^CRON_SECRET=', '' -replace '^["'']', '' -replace '["'']$', ''
if (-not $secret) {
    Write-Host "✗ CRON_SECRET is empty in $EnvFile" -ForegroundColor Red
    exit 1
}

$url = "http://localhost:$Port/api/cron/self-improve?token=$secret"
$intervalSec = $IntervalMin * 60

Write-Host "─── Local cron loop ─────────────────────────────────────────" -ForegroundColor Cyan
Write-Host "  endpoint: http://localhost:$Port/api/cron/self-improve"
Write-Host "  interval: $IntervalMin minute$(if ($IntervalMin -ne 1) {'s'})"
Write-Host "  Ctrl+C to stop"
Write-Host ""

$tickN = 0
while ($true) {
    $tickN++
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$ts] tick #$tickN — firing... " -NoNewline -ForegroundColor DarkGray
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $resp = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 300
        $sw.Stop()
        $okSym = if ($resp.ok) { "✓" } else { "✗" }
        $color = if ($resp.ok) { "Green" } else { "Yellow" }
        $reflections = $resp.reflectionsTotal
        $research = if ($resp.autoResearch) { $resp.autoResearch.Count } else { 0 }
        $skipped = if ($resp.result.skipped) { ($resp.result.skipped -join ',') } else { '' }
        Write-Host "$okSym ${($sw.Elapsed.TotalSeconds.ToString('F1'))}s · reflections:$reflections · research:$research$(if ($skipped) { " · skipped:[$skipped]" })" -ForegroundColor $color
    } catch {
        $sw.Stop()
        Write-Host "✗ $($_.Exception.Message)" -ForegroundColor Red
    }
    Start-Sleep -Seconds $intervalSec
}
