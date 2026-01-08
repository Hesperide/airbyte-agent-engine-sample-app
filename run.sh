#!/bin/bash

# Gradio Chat Launcher

set -e

echo "=================================="
echo "Gradio Chat Launcher"
echo "=================================="
echo ""

# Check .env file
if [ ! -f .env ]; then
    echo "Error: .env file not found!"
    exit 1
fi

# Activate venv if exists
if [ -d "venv" ]; then
    source venv/bin/activate
elif [ -d ".venv" ]; then
    source .venv/bin/activate
fi

# Check dependencies
echo "Checking dependencies..."
python -c "import pydantic_ai" 2>/dev/null || {
    echo "Error: pydantic-ai not installed"
    echo "Run: pip install -r requirements.txt"
    exit 1
}

python -c "import airbyte_agent_gong" 2>/dev/null || {
    echo "Error: airbyte-agent-gong not installed"
    echo "Run: pip install -r requirements.txt"
    exit 1
}

python -c "import airbyte_agent_hubspot" 2>/dev/null || {
    echo "Error: airbyte-agent-hubspot not installed"
    echo "Run: pip install -r requirements.txt"
    exit 1
}

python -c "import gradio" 2>/dev/null || {
    echo "Error: gradio not installed"
    echo "Run: pip install -r requirements.txt"
    exit 1
}

echo ""
echo "Starting Gradio Chat..."
echo "Available at: http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop"
echo "=================================="
echo ""

# Run the app
python -m src.chat
