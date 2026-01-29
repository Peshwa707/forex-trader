# Forex Trader - One-Click Local Setup

Run the Forex Trader app locally on any device with a single click.

## Prerequisites

- **Node.js 18+** - Download from [nodejs.org](https://nodejs.org/)

## Quick Start

### macOS / Linux

1. Open Terminal
2. Navigate to this folder
3. Run:
   ```bash
   chmod +x start.sh
   ./start.sh
   ```

Or double-click `start.command` (macOS only)

### Windows

1. Double-click `start.bat`

Or open Command Prompt and run:
```cmd
start.bat
```

## What It Does

1. Checks for Node.js installation
2. Installs npm dependencies
3. Creates `.env` file with safe defaults (SIMULATION mode)
4. Builds the frontend
5. Starts the server
6. Opens your browser to http://localhost:3000

## Default Configuration

The app runs in **SIMULATION mode** by default:
- No real money involved
- No broker connection required
- Safe for testing and learning

## Customization

Edit the `.env` file in the project root to customize:

```env
# Trading Mode
TRADING_MODE=SIMULATION  # SIMULATION, PAPER, or LIVE

# Server Port
PORT=3000

# For IB Gateway connection (optional)
IB_HOST=localhost
IB_PORT=7497
```

## Troubleshooting

### "Node.js not found"
Install Node.js from https://nodejs.org/

### Port 3000 already in use
Edit `.env` and change `PORT=3001` (or another free port)

### Dependencies fail to install
Try: `npm install --legacy-peer-deps --force`

### Windows: "execution of scripts is disabled"
Run PowerShell as Admin and execute:
```powershell
Set-ExecutionPolicy RemoteSigned
```

## Stopping the App

Press `Ctrl+C` in the terminal/command prompt window.
