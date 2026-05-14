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

# If anything below blows up, we want the user to actually see WHY
# instead of the window snapping shut. Wrap everything in try/catch +
# a final Read-Host so a double-clicked invocation stays open.
try {
    # Locate repo root (parent of /scripts/)
    $repoRoot = Split-Path -Parent $PSScriptRoot
    Set-Location $repoRoot

    # Resolve env file path against repo root
    $envPath = Join-Path $repoRoot $EnvFile
    if (-not (Test-Path $envPath)) {
        throw "$envPath not found. Run from the repo root or pass -EnvFile <path>."
    }

    # Pull CRON_SECRET from .env.local
    $line = Get-Content $envPath | Where-Object { $_ -match '^CRON_SECRET=' } | Select-Object -First 1
    if (-not $line) {
        throw "CRON_SECRET= line not found in $envPath"
    }
    $secret = $line -replace '^CRON_SECRET=', ''
    $secret = $secret.Trim('"', "'", ' ')
    if (-not $secret) {
        throw "CRON_SECRET is empty in $envPath"
    }

    $url = "http://localhost:$Port/api/cron/self-improve?token=$secret"
    $intervalSec = $IntervalMin * 60

    Write-Host ""
    Write-Host "--- Local cron loop ---" -ForegroundColor Cyan
    Write-Host "  endpoint: http://localhost:$Port/api/cron/self-improve"
    Write-Host "  interval: $IntervalMin minute(s)"
    Write-Host "  secret:   $($secret.Substring(0, [Math]::Min(6, $secret.Length)))... (loaded from $EnvFile)"
    Write-Host "  Ctrl+C to stop"
    Write-Host ""

    $tickN = 0
    while ($true) {
        $tickN++
        $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Write-Host "[$ts] tick #$tickN -- firing... " -NoNewline -ForegroundColor DarkGray
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $resp = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 600
            $sw.Stop()
            $elapsed = $sw.Elapsed.TotalSeconds.ToString('F1')
            $okSym  = if ($resp.ok) { "OK" } else { "FAIL" }
            $color  = if ($resp.ok) { "Green" } else { "Yellow" }
            $reflections = $resp.reflectionsTotal
            $research    = if ($resp.autoResearch) { $resp.autoResearch.Count } else { 0 }
            $skipped     = if ($resp.result -and $resp.result.skipped) { ($resp.result.skipped -join ',') } else { '' }
            $line = "$okSym  ${elapsed}s  reflections:$reflections  research:$research"
            if ($skipped) { $line += "  skipped:[$skipped]" }
            Write-Host $line -ForegroundColor $color
        } catch {
            $sw.Stop()
            Write-Host "ERROR  $($_.Exception.Message)" -ForegroundColor Red
        }
        Start-Sleep -Seconds $intervalSec
    }
}
catch {
    Write-Host ""
    Write-Host "FATAL: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    # If invoked via double-click, keep the window open so the error is readable
    Read-Host "Press Enter to close"
    exit 1
}
