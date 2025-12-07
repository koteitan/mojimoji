#!/bin/bash

# Local test script - starts dev server for testing

# Kill any existing dev servers on port 5173
echo "Stopping old dev servers..."
pkill -f "vite" 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true

# Wait a moment for ports to be released
sleep 1

# Start new dev server with --host for external access
echo "Starting new dev server..."
npm run dev -- --host
