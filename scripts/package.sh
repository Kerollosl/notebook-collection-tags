#!/usr/bin/env bash
# Builds dist/<name>-<version>.zip containing only shipping files.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
out="dist/collection-tags-for-notebooklm-$version.zip"
mkdir -p dist && rm -f "$out"
zip -X -q "$out" manifest.json content.js content.css icons/icon16.png icons/icon48.png icons/icon128.png
echo "Created $out"
unzip -l "$out"
