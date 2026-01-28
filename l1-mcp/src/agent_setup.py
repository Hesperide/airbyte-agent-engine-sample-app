"""
Agent Setup Module

Handles agent initialization and tool registration.
"""

import os
from pathlib import Path
from typing import Union
from dotenv import load_dotenv
from pydantic_ai import Agent
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.mcp import load_mcp_servers
from langsmith import traceable

# Load environment variables
load_dotenv()

ANTHROPIC_API_KEY = os.getenv("AC_ANTHROPIC_API_KEY")


def _load_system_prompt() -> str:
    """Load system prompt from file."""
    prompt_path = Path(__file__).parent / "system_prompt.txt"
    return prompt_path.read_text().strip()


def create_agent() -> Agent:
    """
    Create and configure the Pydantic AI agent.

    Returns:
        Agent: Configured Pydantic AI agent
    """
    provider = AnthropicProvider(api_key=ANTHROPIC_API_KEY)
    model = AnthropicModel("claude-sonnet-4-5-20250929", provider=provider)
    system_prompt = _load_system_prompt()

    # Load MCP servers from configuration with graceful fallback
    mcp_servers = load_mcp_servers('.mcp.json')

    agent = Agent(
        model=model,
        system_prompt=system_prompt,
        toolsets=mcp_servers,  # Add MCP server tools
        retries=10
    )

    return agent
