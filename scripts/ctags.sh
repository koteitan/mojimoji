#!/bin/bash
# Generate ctags for vim
cd "$(dirname "$0")/.."
ctags -R --languages=TypeScript,JavaScript --exclude=node_modules --exclude=dist .
echo "tags file generated: $(wc -l < tags) entries"
