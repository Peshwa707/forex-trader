# Forex Trader - One-Click Launcher (Windows PowerShell)

$Host.UI.RawUI.WindowTitle = "Forex Trader - Local Setup"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "     FOREX TRADER - LOCAL SETUP" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get project directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir

Set-Location $ProjectDir

# Check for Node.js
Write-Host "[1/5] Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node -v
    Write-Host "Found Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "ERROR: Node.js not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Node.js from: https://nodejs.org/"
    Write-Host "Recommended: Node.js 18 LTS or higher"
    Write-Host ""
    Write-Host "Or install via winget: winget install OpenJS.NodeJS.LTS"
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

# Check for npm
Write-Host "[2/5] Checking npm..." -ForegroundColor Yellow
try {
    $npmVersion = npm -v
    Write-Host "Found npm $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: npm not found!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Install dependencies
Write-Host "[3/5] Installing dependencies..." -ForegroundColor Yellow
npm install --legacy-peer-deps
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to install dependencies" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Create .env if it doesn't exist
Write-Host "[4/5] Setting up environment..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "Created .env from .env.example" -ForegroundColor Green
        Write-Host "Note: Using default development settings (SIMULATION mode)" -ForegroundColor Yellow
    } else {
        @"
NODE_ENV=development
PORT=3000
TRADING_MODE=SIMULATION
ALLOW_LIVE_TRADING=false
"@ | Out-File -FilePath ".env" -Encoding UTF8
        Write-Host "Created default .env file" -ForegroundColor Green
    }
} else {
    Write-Host ".env already exists" -ForegroundColor Green
}

# Build frontend
Write-Host "[5/5] Building frontend..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to build frontend" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Start the server
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "         STARTING SERVER" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Opening browser in 3 seconds..." -ForegroundColor Cyan
Write-Host "App URL: http://localhost:3000" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow
Write-Host ""

# Open browser after delay (background job)
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 3
    Start-Process "http://localhost:3000"
} | Out-Null

# Start server
npm start
