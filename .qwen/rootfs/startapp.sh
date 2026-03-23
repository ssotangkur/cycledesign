#!/bin/sh
# CycleDesign Development Sandbox Startup Script
# This script runs when the container starts

set -e

echo "=== CycleDesign Development Sandbox ==="
echo "Starting at $(date)"

# ============================================
# Git Credential Configuration
# ============================================
if [ -n "$SANDBOX_GITHUB_TOKEN" ]; then
    echo "Configuring git credentials for automated push..."
    git config --global credential.helper store
    echo "https://ssotangkur:${SANDBOX_GITHUB_TOKEN}@github.com" > ~/.git-credentials
    chmod 600 ~/.git-credentials
    echo "Git credentials configured successfully."
else
    echo "WARNING: SANDBOX_GITHUB_TOKEN not set. Git push will require manual authentication."
fi

# ============================================
# Display Configuration
# ============================================
echo "Display resolution: ${DISPLAY_WIDTH:-1920}x${DISPLAY_HEIGHT:-1080}"

# ============================================
# Start Chromium with Remote Debugging
# ============================================
echo "Starting Chromium with remote debugging on port 9222..."
# Launch Chromium in background with remote debugging enabled
# --no-sandbox: Required for running in Docker container
# --disable-dev-shm-usage: Prevents /dev/shm space issues
# --remote-debugging-port=9222: Enables Chrome DevTools MCP connection
# --user-data-dir: Uses a separate profile for debugging
chromium \
    --no-sandbox \
    --disable-dev-shm-usage \
    --disable-gpu \
    --remote-debugging-port=9222 \
    --user-data-dir=/tmp/chrome-profile \
    --headless=new \
    &
CHROME_PID=$!
echo "Chromium started with PID: $CHROME_PID"

# Wait a moment for Chrome to fully start
sleep 2

# Verify Chrome is running and accepting connections
if wget -q --spider http://127.0.0.1:9222/json/version 2>/dev/null; then
    echo "Chromium remote debugging is ready at http://127.0.0.1:9222"
else
    echo "WARNING: Chromium remote debugging may not be ready yet"
fi

# ============================================
# Dependency Installation
# ============================================
cd /app

# Always reinstall node_modules when running on Alpine Linux
# This is required because Rollup has platform-specific binaries
# and npm may install the wrong optional dependencies from Windows
if [ -f "package.json" ]; then
    echo "Installing npm dependencies for Alpine Linux..."
    # Remove all node_modules directories (they contain Windows-specific binaries)
    rm -rf node_modules apps/*/node_modules packages/*/node_modules tests/*/node_modules
    # Keep package-lock.json for faster resolution
    # npm will reinstall and get the correct platform-specific packages
    npm install
    echo "Dependencies installed successfully."
else
    echo "WARNING: package.json not found. Is /app mounted correctly?"
fi

# ============================================
# Start Development Servers
# ============================================
echo ""
echo "=== Starting Development Servers ==="
echo "Web server:  http://localhost:3000"
echo "API server:  http://localhost:3001"
echo "VNC web:     http://localhost:5800"
echo "VNC client:  localhost:5900"
echo ""
echo "Press Ctrl+C to stop all servers."
echo "==================================="

# Run the dev servers (this command keeps the container running)
exec npm run dev
