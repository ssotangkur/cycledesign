#!/bin/bash
# CycleDesign Qwen Sandbox Stopper
# Usage: ./scripts/sandbox-stop.sh

set -e

echo ""
echo "============================================"
echo "  Stopping CycleDesign Qwen Sandbox"
echo "============================================"
echo ""

# Find and stop the sandbox container
CONTAINER=$(docker ps --filter "ancestor=cycledesign-sandbox:gui" --format "{{.ID}}")

if [ -n "$CONTAINER" ]; then
    echo "Stopping sandbox container..."
    docker stop "$CONTAINER" > /dev/null
    echo "Container stopped."
else
    echo "No running sandbox container found."
fi

# Optional: Remove the container (uncomment if you want auto-cleanup)
# if [ -n "$CONTAINER" ]; then
#     echo "Removing container..."
#     docker rm "$CONTAINER" > /dev/null
#     echo "Container removed."
# fi

echo ""
echo "Sandbox stopped."
echo ""
