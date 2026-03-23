#!/bin/bash
# CycleDesign Sandbox Stop Script (Linux/Mac)
# Usage: ./scripts/sandbox-stop.sh

echo "Stopping CycleDesign sandbox..."

if docker stop cycledesign-sandbox > /dev/null 2>&1; then
    echo "Container stopped successfully."
else
    echo "No running sandbox container found."
fi

echo ""
echo "To start again:"
echo "  ./scripts/sandbox-start.sh"
echo ""
echo "To remove the container completely:"
echo "  docker rm cycledesign-sandbox"
echo "  docker volume rm cycledesign-npm_cache"
