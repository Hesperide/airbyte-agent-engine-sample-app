# Requirements for l4-mcp-app MCP Apps Update

## Goal
Replace the custom host implementation in l4-mcp-app with the basic-host pattern from the official MCP Apps extension repository.

## Requirements

1. **Replace host implementation**: Remove the custom server.ts that has its own chat UI and Anthropic integration, and replace it with the basic-host pattern that properly implements the MCP Apps host protocol using AppBridge.

2. **Use proper MCP Apps architecture**:
   - Double-iframe sandbox pattern for security
   - React-based UI with Vite build system
   - Proper AppBridge from @modelcontextprotocol/ext-apps
   - HTTP transport for MCP server communication

3. **Update widget-mcp-server**: Add HTTP transport support (StreamableHTTPServerTransport) so the basic-host can connect to it.

4. **Maintain functionality**: The Airbyte widget MCP App should still work - users should be able to call the open-airbyte-widget tool and see the widget UI.

## Files to create/modify

### New files (from basic-host):
- index.html - React host entry point
- sandbox.html - Sandbox proxy HTML
- src/index.tsx - React UI host
- src/implementation.ts - Core MCP Apps host logic
- src/sandbox.ts - Sandbox proxy script
- src/global.css - Global styles
- src/index.module.css - Component styles
- src/theme.ts - Theme management
- src/host-styles.ts - MCP style variables
- vite.config.ts - Vite build configuration
- tsconfig.json - TypeScript configuration

### Modified files:
- package.json - Updated dependencies
- run.sh - Updated launch script
- widget-mcp-server/server.ts - Add HTTP transport
- widget-mcp-server/package.json - Add HTTP transport dependencies

### Removed files:
- server.ts (old custom host)
