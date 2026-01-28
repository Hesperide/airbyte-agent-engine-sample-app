"""
Agent Setup Module

Handles agent initialization and tool registration with dependency injection.
"""

import os
import json
from dataclasses import dataclass
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.messages import FunctionToolCallEvent
from langsmith import traceable
from airbyte_agent_gong import GongConnector
from airbyte_agent_hubspot import HubspotConnector
from airbyte_agent_linear import LinearConnector

# Load environment variables
load_dotenv()

# Airbyte configuration constants
AIRBYTE_CLIENT_ID = os.getenv("AC_AIRBYTE_CLIENT_ID")
AIRBYTE_CLIENT_SECRET = os.getenv("AC_AIRBYTE_CLIENT_SECRET")
EXTERNAL_USER_ID = os.getenv("AC_EXTERNAL_USER_ID", "customer-workspace")
ANTHROPIC_API_KEY = os.getenv("AC_ANTHROPIC_API_KEY")


# ============== Dependencies ==============

@dataclass
class AgentDeps:
    gong: GongConnector | None = None
    hubspot: HubspotConnector | None = None
    linear: LinearConnector | None = None


def create_deps(
    include_gong: bool = True,
    include_hubspot: bool = True,
    include_linear: bool = True) -> AgentDeps:
    
    gong = None
    hubspot = None
    linear = None

    if include_gong and AIRBYTE_CLIENT_ID and AIRBYTE_CLIENT_SECRET:
        gong = GongConnector(
            external_user_id=EXTERNAL_USER_ID,
            airbyte_client_id=AIRBYTE_CLIENT_ID,
            airbyte_client_secret=AIRBYTE_CLIENT_SECRET
        )

    if include_hubspot and AIRBYTE_CLIENT_ID and AIRBYTE_CLIENT_SECRET:
        hubspot = HubspotConnector(
            external_user_id=EXTERNAL_USER_ID,
            airbyte_client_id=AIRBYTE_CLIENT_ID,
            airbyte_client_secret=AIRBYTE_CLIENT_SECRET
        )

    if include_linear and AIRBYTE_CLIENT_ID and AIRBYTE_CLIENT_SECRET:
        linear = LinearConnector(
            external_user_id=EXTERNAL_USER_ID,
            airbyte_client_id=AIRBYTE_CLIENT_ID,
            airbyte_client_secret=AIRBYTE_CLIENT_SECRET
        )

    return AgentDeps(gong=gong, hubspot=hubspot, linear=linear)

def _load_system_prompt() -> str:
    """Load system prompt from file."""
    prompt_path = Path(__file__).parent / "system_prompt.txt"
    return prompt_path.read_text().strip()

def create_agent() -> Agent[AgentDeps, str]:
    """
    Create and configure the Pydantic AI agent with dependency injection.

    Returns:
        Agent[AgentDeps, str]: Configured Pydantic AI agent with dependency type specified
    """
    provider = AnthropicProvider(api_key=ANTHROPIC_API_KEY)
    model = AnthropicModel("claude-sonnet-4-5-20250929", provider=provider)
    system_prompt = _load_system_prompt()

    agent = Agent(
        model=model,
        deps_type=AgentDeps,
        system_prompt=system_prompt,
        retries=10,  # Allow up to 10 tool call iterations before stopping
        event_stream_handler=log_tool_calls  # Log tool calls to terminal
    )

    return agent

def register_tools(agent: Agent[AgentDeps, str]) -> None:
    """Register all tools on the agent."""

    # ============== Generic Tools ==============

    @agent.tool_plain
    def get_current_date() -> str:
        """
        Get the current date and time.

        Returns:
            str: Current date and time in ISO format
        """
        return datetime.now().isoformat()

    # ============== Gong Tools ==============

    @agent.tool
    @GongConnector.tool_utils
    async def gong_execute(
        ctx: RunContext[AgentDeps],
        entity: str,
        action: str,
        params: dict | None = None
    ):
        """Execute Gong API operations."""
        if ctx.deps.gong is None:
            return {"error": "Gong connector is not configured. Please set up the Gong integration."}
        return await ctx.deps.gong.execute(entity, action, params or {})

    # ============== Linear Tools ==============

    @agent.tool
    @LinearConnector.tool_utils
    async def linear_execute(
        ctx: RunContext[AgentDeps],
        entity: str,
        action: str,
        params: dict | None = None
    ):
        """Execute Linear API operations."""
        if ctx.deps.linear is None:
            return {"error": "Linear connector is not configured. Please set up the Linear integration."}
        return await ctx.deps.linear.execute(entity, action, params or {})

    # ============== HubSpot Tools ==============

    @agent.tool
    @HubspotConnector.tool_utils
    async def hubspot_execute(
        ctx: RunContext[AgentDeps],
        entity: str,
        action: str,
        params: dict | None = None
    ):
        """Execute HubSpot API operations."""
        if ctx.deps.hubspot is None:
            return {"error": "HubSpot connector is not configured. Please set up the HubSpot integration."}
        return await ctx.deps.hubspot.execute(entity, action, params or {})


############### 

async def log_tool_calls(ctx, events):
    """
    Event stream handler that logs tool calls to the terminal.

    Displays tool name and parameters in an easy-to-read format with colors.
    """
    # ANSI color codes
    CYAN = "\033[96m"
    MAGENTA = "\033[95m"
    YELLOW = "\033[93m"
    GREEN = "\033[92m"
    RESET = "\033[0m"
    BOLD = "\033[1m"

    async for event in events:
        if isinstance(event, FunctionToolCallEvent):
            # Extract tool name and args
            tool_name = event.part.tool_name
            args = event.part.args_as_dict() if event.part.args else {}

            # Pretty print to terminal with colors
            print(f"\n{CYAN}{'='*50}{RESET}")
            print(f"{BOLD}{MAGENTA}🔧 [TOOL CALL]{RESET} {BOLD}{GREEN}{tool_name}{RESET}")
            print(f"{CYAN}{'-'*50}{RESET}")
            print(f"{YELLOW}Parameters:{RESET}")
            print(json.dumps(args, indent=2))
            print(f"{CYAN}{'='*50}{RESET}\n")
