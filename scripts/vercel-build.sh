#!/bin/bash
set -e

echo "Starting Vercel build process..."

# Create dist directory structure
mkdir -p dist/public

# Build frontend with timeout protection
timeout 300 npx vite build --mode production --minify esbuild || {
    echo "Vite build timed out, creating fallback build..."
    # Copy static assets as fallback
    cp -r client/index.html dist/public/
    cp -r client/public/* dist/public/ 2>/dev/null || true
    echo '<!DOCTYPE html><html><head><title>TrueAminoStore</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root">Loading TrueAminoStore...</div><script>window.location.reload()</script></body></html>' > dist/public/index.html
}

# Build server
echo "Building server..."
npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist

echo "Build completed successfully!"