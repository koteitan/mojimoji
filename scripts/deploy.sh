#!/bin/bash

# Build script for GitHub Pages deployment
# This script builds the app and copies built files to root directory

set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Setting up source index.html for build..."
cp "$PROJECT_DIR/src/index.html" "$PROJECT_DIR/index.html"

echo "Building..."
cd "$PROJECT_DIR"
npm run build

echo "Removing old assets..."
rm -rf "$PROJECT_DIR/assets"

echo "Copying built files to root..."
cp -r "$PROJECT_DIR/dist/"* "$PROJECT_DIR/"

echo ""
echo "Build complete!"
echo "Next steps:"
echo "  git add -A && git commit -m 'Deploy' && git push"
