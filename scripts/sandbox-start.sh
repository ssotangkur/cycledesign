#!/bin/bash
# CycleDesign Sandbox Start Script (Linux/Mac)
# Usage: ./scripts/sandbox-start.sh

set -e

# Check if SANDBOX_GITHUB_TOKEN is set
if [ -z "$SANDBOX_GITHUB_TOKEN" ]; then
    echo "ERROR: SANDBOX_GITHUB_TOKEN environment variable is not set."
    echo ""
    echo Please set it first:"
    echo   export SANDBOX_GITHUB_TOKEN=your_github_token_here
    echo ""
    echo "Or run with token directly:"
    echo "  SANDBOX_GITHUB_TOKEN=your_token_here ./scripts/sandbox-start.sh"
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "ERROR: Docker is not running. Please start Docker Desktop."
    exit 1
fi

# Check if sandbox image exists
if ! docker images cycledesign-persistent --format "{{.Repository}}" | grep -q "cycledesign-persistent"; then
    echo "Sandbox image not found. Building..."
    docker build -t cycledesign-persistent -f ../.qwen/sandbox.Dockerfile.persistent ..
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to build sandbox image."
        exit 1
    fi
fi

# Stop and remove existing container if it exists
if docker ps -a --filter "name=cycledesign-sandbox" --format "{{.Names}}" | grep -q "cycledesign-sandbox"; then
    echo "Stopping existing sandbox container..."
    docker stop cycledesign-sandbox > /dev/null 2>&1
    docker rm cycledesign-sandbox > /dev/null 2>&1
fi

# Create npm cache volume if it doesn't exist
if ! docker volume inspect cycledesign-npm_cache > /dev/null 2>&1; then
    echo "Creating npm cache volume..."
    docker volume create cycledesign-npm_cache > /dev/null
fi

# Get script directory for finding project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Start the container
echo "Starting CycleDesign sandbox..."
docker run -d --name cycledesign-sandbox \
    -p 5800:5800 -p 5900:5900 \
    -e SANDBOX_GITHUB_TOKEN="$SANDBOX_GITHUB_TOKEN" \
    -e VNC_PASSWORD="${VNC_PASSWORD:-}" \
    -e DISPLAY_WIDTH=1920 \
    -e DISPLAY_HEIGHT=1080 \
    -v "$PROJECT_ROOT:/app" \
    -v cycledesign-npm_cache:/root/.npm \
    cycledesign-persistent

echo ""
echo "============================================"
echo "  CycleDesign Sandbox Started Successfully!"
echo "============================================"
echo ""
echo "Access points:"
echo "  VNC web:        http://localhost:5800"
echo "  VNC client:     localhost:5900"
echo ""
echo "Dev servers (inside container only):"
echo "  Web server:     http://localhost:3000"
echo "  API server:     http://localhost:3001"
echo ""
echo "To use Qwen Code in the sandbox:"
echo "  QWEN_SANDBOX=docker qwen"
echo ""
echo "To stop the sandbox:"
echo "  ./scripts/sandbox-stop.sh"
echo "  or: docker stop cycledesign-sandbox"
echo ""
echo "To view logs:"
echo "  docker logs cycledesign-sandbox"
echo "============================================"
