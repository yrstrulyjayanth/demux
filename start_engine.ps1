# DEMUXER PRO AUTOMATED SINGLE-CLICK ENGINE LAUNCHER
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "   Booting Demuxer Pro AI Media Engine..." -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan

# Determine script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Launch FastAPI Backend
Write-Host "[1/2] Starting FastAPI Backend on http://localhost:8000..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$scriptDir\backend'; python -m uvicorn main:app --reload --port 8000"

# Launch React Frontend
Write-Host "[2/2] Starting React Vite Dashboard on http://localhost:5173..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$scriptDir\frontend'; npm run dev"

Write-Host "Engine launched successfully!" -ForegroundColor Cyan
Write-Host "Open http://localhost:5173 in your browser to access the dashboard." -ForegroundColor Yellow
