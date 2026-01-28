#!/bin/bash
# MCP Apps Host Launcher
# Uses the basic-host pattern from @modelcontextprotocol/ext-apps

set -e

cd "$(dirname "$0")"

echo "=================================="
echo "MCP Apps Host - Airbyte Connectors"
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

export ALLOWED_ORIGIN="http://localhost:8081"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing host dependencies..."
    npm install
fi

# Install connector-mcp-server dependencies if needed
if [ ! -d "connector-mcp-server/node_modules" ]; then
    echo "Installing connector-mcp-server dependencies..."
    cd connector-mcp-server
    npm install
    cd ..
fi

# Build everything
echo "Building..."
npm run build

# Start the connector-mcp-server in the background (HTTP mode)
echo ""
echo "Starting connector-mcp-server on port 3001..."
cd connector-mcp-server
node dist/server.mjs &
MCP_SERVER_PID=$!
cd ..

# Trap to cleanup background process on exit
cleanup() {
    echo ""
    echo "Shutting down..."
    kill $MCP_SERVER_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

# Wait a moment for the MCP server to start
sleep 1

echo ""
echo "Starting MCP Apps Host..."
echo "Host server:    http://localhost:8080"
echo "Sandbox server: http://localhost:8081"
echo "MCP server:     http://localhost:3001/mcp"
echo ""
echo "Press Ctrl+C to stop"
echo "=================================="
echo ""

npm run serve

# Wait for background process
wait $MCP_SERVER_PID
