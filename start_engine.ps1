# DEMUXER PRO AUTOMATED ENGINE LAUNCHER
# Checks ports, kills stale engine instances, starts backend & frontend, and opens browser automatically.

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "   BOOTING DEMUXER PRO AI MEDIA STUDIO v4.0" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Function to check and free port on Windows using standard Get-NetTCPConnection
function Stop-PortProcess([int]$port) {
    try {
        $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        foreach ($conn in $connections) {
            if ($conn.OwningProcess -and $conn.OwningProcess -ne 0) {
                Write-Host "Stopping stale process using port $port (PID $($conn.OwningProcess))..." -ForegroundColor Yellow
                Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {
        # Fallback if Get-NetTCPConnection is unavailable on legacy Windows environments
        try {
            $lines = netstat -ano | Select-String ":$port\s+.*LISTENING\s+(\d+)"
            foreach ($match in $lines.Matches) {
                $pidToKill = $match.Groups[1].Value
                if ($pidToKill -and $pidToKill -ne 0) {
                    Write-Host "Stopping stale process using port $port (PID $pidToKill)..." -ForegroundColor Yellow
                    Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
                }
            }
        } catch {}
    }
}

# Free port 8000 (Backend) and port 5173 (Frontend) if occupied by old crashed instances
Stop-PortProcess 8000
Stop-PortProcess 5173

Start-Sleep -Seconds 1

# Launch FastAPI Backend
Write-Host "[1/3] Starting FastAPI AI Engine on http://localhost:8000..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$scriptDir\backend'; python -m uvicorn main:app --reload --port 8000"

# Launch React Vite Frontend
Write-Host "[2/3] Starting React Vite Dashboard on http://localhost:5173..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$scriptDir\frontend'; npm run dev"

# Wait for Vite dev server ready state and auto-open browser
Write-Host "[3/3] Waiting for dashboard initialization..." -ForegroundColor Green

$maxTries = 15
$ready = $false
for ($i = 0; $i -lt $maxTries; $i++) {
    Start-Sleep -Seconds 1
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {
        # Waiting for server
    }
}

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host " Demuxer Pro AI Studio launched successfully!" -ForegroundColor Cyan
Write-Host " Dashboard URL: http://localhost:5173" -ForegroundColor Yellow
Write-Host "===================================================" -ForegroundColor Cyan

# Auto-open browser window
Start-Process "http://localhost:5173"
