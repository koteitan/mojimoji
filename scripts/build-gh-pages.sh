#!/bin/bash

# Build script for GitHub Pages deployment
# This script builds the app and copies built files to root directory

set -e

# Source index.html content
SOURCE_INDEX='<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>mojimoji-(.>_<)-(.>_<) nostr modular client</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>'

echo "Restoring source index.html for build..."
echo "$SOURCE_INDEX" > index.html

echo "Building..."
npm run build

echo "Removing old assets..."
rm -rf assets

echo "Copying built files to root..."
cp -r dist/* .

echo ""
echo "Build complete!"
echo "Next steps:"
echo "  git add -A && git commit -m 'Deploy' && git push"
