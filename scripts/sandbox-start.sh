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

# Configure sandbox environment variables
export QWEN_SANDBOX=true
export QWEN_SANDBOX_IMAGE="cycledesign-sandbox:gui"

# Mount host's ~/.qwen to /root/.qwen in container for auth tokens
# Pass GH_TOKEN into container for GitHub auth
# Also expose ports for VNC/noVNC (Chrome DevTools runs inside container only)
HOST_QWEN_DIR="$HOME/.qwen"
export SANDBOX_FLAGS="-p 0.0.0.0:5900:5900 -p 0.0.0.0:6080:6080 -v \"$HOST_QWEN_DIR:/root/.qwen\" -e GH_TOKEN"

echo ""
echo "============================================"
echo "  CycleDesign Qwen Sandbox"
echo "============================================"
echo ""
echo "Image: $QWEN_SANDBOX_IMAGE"
echo "Sandbox: enabled"
echo "SANDBOX_FLAGS: $SANDBOX_FLAGS"
echo ""
echo "Access URLs:"
echo "  - noVNC (Browser): http://localhost:6080"
echo "  - VNC Client:      localhost:5900"
echo ""
echo "Note: Chrome DevTools runs inside the container for Qwen Code"
echo ""
echo "Starting qwen..."
echo ""

qwen "$@"
