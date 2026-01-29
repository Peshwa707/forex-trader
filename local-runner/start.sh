#!/bin/bash
#
# Forex Trader - One-Click Launcher (macOS/Linux)
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════╗"
echo "║         FOREX TRADER - LOCAL SETUP         ║"
echo "╚════════════════════════════════════════════╝"
echo -e "${NC}"

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Check for Node.js
echo -e "${YELLOW}[1/5] Checking Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js not found!${NC}"
    echo ""
    echo "Please install Node.js from: https://nodejs.org/"
    echo "Recommended: Node.js 18 LTS or higher"
    echo ""
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "Or install via Homebrew: brew install node"
    else
        echo "Or install via your package manager:"
        echo "  Ubuntu/Debian: sudo apt install nodejs npm"
        echo "  Fedora: sudo dnf install nodejs"
    fi
    exit 1
fi

NODE_VERSION=$(node -v)
echo -e "${GREEN}Found Node.js $NODE_VERSION${NC}"

# Check for npm
echo -e "${YELLOW}[2/5] Checking npm...${NC}"
if ! command -v npm &> /dev/null; then
    echo -e "${RED}npm not found! Please install Node.js with npm.${NC}"
    exit 1
fi
NPM_VERSION=$(npm -v)
echo -e "${GREEN}Found npm $NPM_VERSION${NC}"

# Install dependencies
echo -e "${YELLOW}[3/5] Installing dependencies...${NC}"
npm install --legacy-peer-deps

# Create .env if it doesn't exist
echo -e "${YELLOW}[4/5] Setting up environment...${NC}"
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "${GREEN}Created .env from .env.example${NC}"
        echo -e "${YELLOW}Note: Using default development settings (SIMULATION mode)${NC}"
    else
        cat > .env << 'ENVEOF'
NODE_ENV=development
PORT=3000
TRADING_MODE=SIMULATION
ALLOW_LIVE_TRADING=false
ENVEOF
        echo -e "${GREEN}Created default .env file${NC}"
    fi
else
    echo -e "${GREEN}.env already exists${NC}"
fi

# Build frontend
echo -e "${YELLOW}[5/5] Building frontend...${NC}"
npm run build

# Start the server
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║            STARTING SERVER                 ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Opening browser in 3 seconds...${NC}"
echo -e "App URL: ${GREEN}http://localhost:3000${NC}"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop the server${NC}"
echo ""

# Open browser after delay (background)
(sleep 3 && open "http://localhost:3000" 2>/dev/null || xdg-open "http://localhost:3000" 2>/dev/null || true) &

# Start server
npm start
