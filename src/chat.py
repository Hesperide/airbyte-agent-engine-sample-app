"""Gradio chat interface for Pydantic AI Agent with Gong and HubSpot Connectors"""

import os
from dotenv import load_dotenv
import gradio as gr

from airbyte_agent_gong import GongConnector
from airbyte_agent_hubspot import HubspotConnector
from src.agent_setup import create_agent, register_tools

# Load environment variables
load_dotenv()

# Global state (initialized on first message)
agent = None
message_history = []


async def chat(message, history):
    """Handle chat messages with the agent."""
    global agent, message_history

    # Lazy initialization on first message
    if agent is None:
        
        # Get Airbyte credentials from environment
        airbyte_client_id = os.getenv("AIRBYTE_CLIENT_ID")
        airbyte_client_secret = os.getenv("AIRBYTE_CLIENT_SECRET")
        external_user_id = os.getenv("EXTERNAL_USER_ID", "customer-workspace")

        # Initialize connectors
        gong_connector = GongConnector(
            external_user_id=external_user_id,
            airbyte_client_id=airbyte_client_id,
            airbyte_client_secret=airbyte_client_secret
        )

        hubspot_connector = HubspotConnector(
            external_user_id=external_user_id,
            airbyte_client_id=airbyte_client_id,
            airbyte_client_secret=airbyte_client_secret
        )

        # Create and configure the agent
        agent = create_agent()
        register_tools(agent, gong_connector, hubspot_connector)

    try:
        # Run agent with message history
        result = await agent.run(message, message_history=message_history)

        # Update message history with the full conversation
        message_history = result.all_messages()

        return result.output

    except Exception as e:
        return f"Error: {str(e)}"


# Create Gradio chat interface
demo = gr.ChatInterface(
    chat,
    title="AI Agent Chat",
    description="Ask me about anything you are looking to learn more about.",
    examples=[
        "List all users in my Gong organization",
        "Show me call transcripts from last week",
        "List all contacts in HubSpot",
        "Find companies with domain example.com"
    ]
)

if __name__ == "__main__":
    print("Starting AI Agent Chat...")
    print("Server running on http://localhost:8000")
    demo.launch(server_port=8000, server_name="0.0.0.0")
