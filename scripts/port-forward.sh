#!/bin/bash

# Port forwarding script for WSL -> Windows
# Usage: ./port-forward.sh [port] [--remove]

PORT=${1:-5173}
REMOVE=${2:-""}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PS_SCRIPT="$(wslpath -w "$SCRIPT_DIR/port-forward.ps1")"

if [ "$REMOVE" == "--remove" ] || [ "$PORT" == "--remove" ]; then
    if [ "$PORT" == "--remove" ]; then
        PORT=5173
    fi
    echo "Removing port forwarding for port $PORT..."
    powershell.exe -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-ExecutionPolicy Bypass -File \"$PS_SCRIPT\" -Port $PORT -Remove'"
else
    echo "Setting up port forwarding for port $PORT..."
    echo "Note: This requires Administrator privileges. A UAC prompt will appear."
    powershell.exe -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-ExecutionPolicy Bypass -File \"$PS_SCRIPT\" -Port $PORT'"
fi
