#!/bin/bash
# MCP Apps Chat Launcher
# Full TypeScript implementation with MCP Apps host protocol

set -e

cd "$(dirname "$0")"

echo "=================================="
echo "MCP Apps Chat"
echo "=================================="

# Load environment variables from parent directory
if [ -f "../.env" ]; then
    set -a
    source "../.env"
    set +a
else
    echo "Warning: .env file not found at ../.env"
    echo "Please copy .env.example to .env and configure it"
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Build widget-mcp-server if needed
if [ ! -f "widget-mcp-server/dist/server.mjs" ]; then
    echo "Building widget-mcp-server..."
    cd widget-mcp-server
    npm install
    npm run build
    cd ..
fi

# No need to build main server - using tsx to run TypeScript directly

echo ""
echo "Starting MCP Apps Chat server..."
echo "Available at: http://localhost:8000"
echo "Press Ctrl+C to stop"
echo "=================================="
echo ""

npm run serve
