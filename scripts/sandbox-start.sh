#!/bin/bash
# CycleDesign Qwen Code Sandbox Launcher
# Usage: ./scripts/sandbox-start.sh [qwen args...]

set -e

# Check if GH_TOKEN is set (gh CLI native env var)
if [ -z "$GH_TOKEN" ]; then
    echo "ERROR: GH_TOKEN environment variable is not set."
    echo ""
    echo "Please set it first:"
    echo "  export GH_TOKEN=your_github_token_here"
    echo ""
    echo "Or run with token directly:"
    echo "  GH_TOKEN=your_token_here ./scripts/sandbox-start.sh"
    exit 1
fi

# Load custom port configuration if .env.sandbox exists
ENV_SANDBOX_PATH="$(dirname "$0")/../.qwen/.env.sandbox"
if [ -f "$ENV_SANDBOX_PATH" ]; then
    echo "Loading port configuration from .qwen/.env.sandbox..."
    export $(grep -v '^#' "$ENV_SANDBOX_PATH" | xargs)
    echo ""
fi

# Use configured ports with defaults
NOVNC_PORT=${NOVNC_PORT:-6080}
VNC_PORT=${VNC_PORT:-5900}
CHROME_PORT=${CHROME_PORT:-9222}

# Check for port conflicts before starting
echo "Checking for port conflicts..."
port_conflict=false

for port in $NOVNC_PORT $VNC_PORT $CHROME_PORT; do
    if command -v lsof &> /dev/null; then
        if lsof -i :$port > /dev/null 2>&1; then
            echo "  Port $port is IN USE"
            port_conflict=true
        else
            echo "  Port $port is available"
        fi
    elif command -v netstat &> /dev/null; then
        if netstat -tuln | grep -q ":$port "; then
            echo "  Port $port is IN USE"
            port_conflict=true
        else
            echo "  Port $port is available"
        fi
    else
        echo "  Port $port (checking skipped - no lsof/netstat)"
    fi
done

if [ "$port_conflict" = true ]; then
    echo ""
    echo "ERROR: One or more configured ports are already in use."
    echo "Please choose different ports or stop the existing sandbox."
    echo ""
    echo "To configure alternate ports, edit .qwen/.env.sandbox:"
    echo "  NOVNC_PORT=6081"
    echo "  VNC_PORT=5901"
    echo "  CHROME_PORT=9223"
    echo ""
    exit 1
fi

echo ""

# Configure sandbox environment variables
export QWEN_SANDBOX=true
export QWEN_SANDBOX_IMAGE="cycledesign-sandbox:gui"

# Mount host's ~/.qwen to /root/.qwen in container for auth tokens
# Pass GH_TOKEN into container for GitHub auth
# Also expose ports for VNC/noVNC/Chrome DevTools
HOST_QWEN_DIR="$HOME/.qwen"
export SANDBOX_FLAGS="-p 0.0.0.0:$VNC_PORT:5900 -p 0.0.0.0:$NOVNC_PORT:6080 -p 0.0.0.0:$CHROME_PORT:9222 -v \"$HOST_QWEN_DIR:/root/.qwen\" -e GH_TOKEN"

echo ""
echo "============================================"
echo "  CycleDesign Qwen Sandbox"
echo "============================================"
echo ""
echo "Image: $QWEN_SANDBOX_IMAGE"
echo "Sandbox: enabled"
echo ""
echo "Access URLs:"
echo "  - noVNC (Browser): http://localhost:$NOVNC_PORT"
echo "  - VNC Client:      localhost:$VNC_PORT"
echo ""
echo "Note: Chrome DevTools runs inside the container for Qwen Code"
echo ""
echo "Starting qwen..."
echo ""

qwen "$@"

# After qwen exits, validate that the container was using the correct ports
# (This is a post-run check to help catch configuration issues)
echo ""
echo "Shutting down..."

# Try to find the most recent sandbox container
CONTAINER=$(docker ps -a --filter "name=cycledesign-sandbox-gui" --format "{{.ID}}" --latest 2>/dev/null || true)
if [ -n "$CONTAINER" ]; then
    echo "Validating port bindings..."
    
    # Verify noVNC port using docker port command
    ACTUAL_NOVNC_OUTPUT=$(docker port "$CONTAINER" 6080/tcp 2>/dev/null || true)
    if [ -n "$ACTUAL_NOVNC_OUTPUT" ]; then
        ACTUAL_NOVNC=$(echo "$ACTUAL_NOVNC_OUTPUT" | cut -d: -f2)
        
        if [ "$ACTUAL_NOVNC" = "$NOVNC_PORT" ]; then
            echo "  ✓ Port validation passed: noVNC bound to $NOVNC_PORT"
        else
            echo "  ⚠ Port mismatch: expected $NOVNC_PORT, got $ACTUAL_NOVNC"
            echo "    This may indicate the container used different port configuration."
        fi
    fi
fi

echo ""
echo "Sandbox session ended."
echo ""
