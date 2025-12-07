#!/bin/bash

# Local test script - starts dev server for testing
# Uses dev/vite.config.ts with dev/ as root (doesn't touch root index.html)

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Kill any existing dev servers on port 5173
echo "Stopping old dev servers..."
pkill -f "vite" 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true

# Wait a moment for ports to be released
sleep 1

# Start new dev server from dev/ directory
echo "Starting new dev server..."
cd "$PROJECT_DIR/dev"
npx vite --host
