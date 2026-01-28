"""Airbyte Embedded Widget integration module.

This module handles token management for the Airbyte Embedded Widget,
including fetching application tokens and widget tokens from the Airbyte API.
"""

import os
import httpx
from typing import Optional


AIRBYTE_API_BASE = "https://api.airbyte.ai/api/v1"


class AirbyteWidgetError(Exception):
    """Base exception for Airbyte widget errors."""
    pass


class AirbyteAuthError(AirbyteWidgetError):
    """Authentication error with Airbyte API."""
    pass


class AirbyteConnectionError(AirbyteWidgetError):
    """Connection error with Airbyte API."""
    pass


async def fetch_application_token() -> str:
    """Fetch application token from Airbyte API.

    Returns:
        str: Application token (JWT)

    Raises:
        AirbyteAuthError: If authentication fails
        AirbyteConnectionError: If connection fails
    """
    client_id = os.getenv("AC_AIRBYTE_CLIENT_ID")
    client_secret = os.getenv("AC_AIRBYTE_CLIENT_SECRET")

    if not client_id or not client_secret:
        raise AirbyteAuthError("Missing AC_AIRBYTE_CLIENT_ID or AC_AIRBYTE_CLIENT_SECRET environment variables")

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{AIRBYTE_API_BASE}/account/applications/token",
                json={"client_id": client_id, "client_secret": client_secret},
                timeout=10.0
            )
            response.raise_for_status()
            data = response.json()
            if "token" in data:
                return data["token"]
            if "access_token" in data:
                return data["access_token"]
            raise AirbyteAuthError(f"Unexpected API response format: {list(data.keys())}")
    except httpx.HTTPStatusError as e:
        raise AirbyteAuthError(f"Authentication failed: {e.response.status_code}")
    except httpx.TimeoutException:
        raise AirbyteConnectionError("Connection timeout while fetching application token")
    except httpx.RequestError as e:
        raise AirbyteConnectionError(f"Connection error: {str(e)}")


async def fetch_widget_token(app_token: str) -> str:
    """Fetch widget token using application token.

    Args:
        app_token: Application token from fetch_application_token()

    Returns:
        str: Widget token

    Raises:
        AirbyteAuthError: If authentication fails
        AirbyteConnectionError: If connection fails
    """
    external_user_id = os.getenv("AC_EXTERNAL_USER_ID")

    if not external_user_id:
        raise AirbyteAuthError("Missing AC_EXTERNAL_USER_ID environment variable")

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{AIRBYTE_API_BASE}/embedded/widget-token",
                headers={"Authorization": f"Bearer {app_token}"},
                json={
                    "workspace_name": external_user_id,
                    "allowed_origin": "http://localhost:8000"
                },
                timeout=10.0
            )
            response.raise_for_status()
            data = response.json()
            if "token" in data:
                return data["token"]
            if "access_token" in data:
                return data["access_token"]
            raise AirbyteAuthError(f"Unexpected widget token response format: {list(data.keys())}")
    except httpx.HTTPStatusError as e:
        raise AirbyteAuthError(f"Failed to fetch widget token: {e.response.status_code}")
    except httpx.TimeoutException:
        raise AirbyteConnectionError("Connection timeout while fetching widget token")
    except httpx.RequestError as e:
        raise AirbyteConnectionError(f"Connection error: {str(e)}")


async def get_widget_token() -> str:
    """Get widget token by fetching both application and widget tokens.

    This is a convenience function that combines both API calls.

    Returns:
        str: Widget token ready to use with AirbyteEmbeddedWidget

    Raises:
        AirbyteAuthError: If authentication fails
        AirbyteConnectionError: If connection fails
    """
    app_token = await fetch_application_token()
    widget_token = await fetch_widget_token(app_token)
    return widget_token


def generate_widget_html(token: str) -> str:
    """Generate HTML for Airbyte Embedded Widget.

    Args:
        token: Widget token from get_widget_token()

    Returns:
        str: HTML string with widget script and initialization code
    """
    # Script is pre-loaded in page head; just pass token via data attribute
    # MutationObserver in head will detect this and initialize the widget
    return f'<div id="airbyte-widget-token" data-token="{token}"></div>'
