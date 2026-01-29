@echo off
REM Forex Trader - One-Click Launcher (Windows)

title Forex Trader - Local Setup

echo.
echo ========================================
echo     FOREX TRADER - LOCAL SETUP
echo ========================================
echo.

REM Get the directory where the script is located
set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."

cd /d "%PROJECT_DIR%"

REM Check for Node.js
echo [1/5] Checking Node.js...
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo.
    echo ERROR: Node.js not found!
    echo.
    echo Please install Node.js from: https://nodejs.org/
    echo Recommended: Node.js 18 LTS or higher
    echo.
    echo Or install via winget: winget install OpenJS.NodeJS.LTS
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo Found Node.js %NODE_VERSION%

REM Check for npm
echo [2/5] Checking npm...
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm not found! Please install Node.js with npm.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('npm -v') do set NPM_VERSION=%%i
echo Found npm %NPM_VERSION%

REM Install dependencies
echo [3/5] Installing dependencies...
call npm install --legacy-peer-deps
if %ERRORLEVEL% neq 0 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

REM Create .env if it doesn't exist
echo [4/5] Setting up environment...
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo Created .env from .env.example
        echo Note: Using default development settings (SIMULATION mode)
    ) else (
        (
            echo NODE_ENV=development
            echo PORT=3000
            echo TRADING_MODE=SIMULATION
            echo ALLOW_LIVE_TRADING=false
        ) > .env
        echo Created default .env file
    )
) else (
    echo .env already exists
)

REM Build frontend
echo [5/5] Building frontend...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo ERROR: Failed to build frontend
    pause
    exit /b 1
)

REM Start the server
echo.
echo ========================================
echo         STARTING SERVER
echo ========================================
echo.
echo Opening browser in 3 seconds...
echo App URL: http://localhost:3000
echo.
echo Press Ctrl+C to stop the server
echo.

REM Open browser after delay
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"

REM Start server
call npm start

pause
