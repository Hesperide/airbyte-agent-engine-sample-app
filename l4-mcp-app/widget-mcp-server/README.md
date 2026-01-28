# Airbyte Widget MCP Server

An MCP server that provides the Airbyte Embedded Widget as an MCP App. This server can be used standalone with any MCP Apps-compatible host.

## Prerequisites

- Node.js 18+
- Airbyte API credentials (client ID and secret)

## Installation

```bash
npm install
npm run build
```

## Configuration

Set the following environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `AC_AIRBYTE_CLIENT_ID` | Yes | Airbyte API client ID |
| `AC_AIRBYTE_CLIENT_SECRET` | Yes | Airbyte API client secret |
| `AC_EXTERNAL_USER_ID` | No | External user/workspace identifier (default: "customer-workspace") |
| `ALLOWED_ORIGIN` | No | Allowed origin for widget token (default: "null") |
| `MCP_PORT` | No | HTTP server port (default: 3001) |

## Usage

### HTTP Transport (default)

```bash
# Set environment variables
export AC_AIRBYTE_CLIENT_ID=your_client_id
export AC_AIRBYTE_CLIENT_SECRET=your_client_secret
export ALLOWED_ORIGIN=http://localhost:8081

# Start the server
npm run serve
```

The server will listen at `http://localhost:3001/mcp` (stateless HTTP mode).

### Stdio Transport

```bash
npm run serve:stdio
```

This mode is useful for integrating with MCP clients that use stdio transport.

## MCP Tools

### `open-airbyte-widget`

Opens the Airbyte embedded widget to add or manage data source integrations.

**Input:** None required

**Output:**
- `widgetToken`: Token for initializing the Airbyte widget

## MCP Resources

### `ui://airbyte/widget.html`

The MCP App HTML resource that renders the Airbyte widget. This resource includes:
- CSP metadata allowing external scripts from `cdn.jsdelivr.net`
- Frame permissions for `cloud.airbyte.com` and `app.airbyte.ai`

## Host Requirements

When using this MCP server with a host application, the host must:

1. Support MCP Apps protocol (see [MCP Apps documentation](https://modelcontextprotocol.io/docs/extensions/apps))
2. Allow popups in sandbox iframes for OAuth flows:
   ```
   sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
   ```

## Known Limitations

- OAuth popup flows may be blocked if the Airbyte widget's internal iframe doesn't have popup permissions. This is a limitation of the Airbyte Embedded Widget when running in sandboxed environments.

## Development

```bash
# Run in development mode (with hot reload)
npm run dev
```
