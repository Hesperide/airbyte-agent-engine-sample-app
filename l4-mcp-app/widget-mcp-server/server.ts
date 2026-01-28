#!/usr/bin/env node
/**
 * Airbyte Widget MCP App Server
 *
 * MCP server that provides the Airbyte Embedded Widget as an MCP App.
 * Uses AC_ prefixed environment variables for configuration.
 * Supports both stdio and HTTP transports.
 *
 * Environment Configuration:
 * - Set AIRBYTE_WIDGET_MCP_ENV_FILE to path of .env file to load
 * - Or set AC_AIRBYTE_CLIENT_ID, AC_AIRBYTE_CLIENT_SECRET directly
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Simple .env file parser (avoids dotenv bundling issues with esbuild)
 */
function loadEnvFile(filePath: string): void {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      // Skip comments and empty lines
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Parse KEY=VALUE
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();

        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        // Only set if not already in environment
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  } catch (error) {
    // Logging disabled in stdio mode to avoid JSON parsing errors
    // console.error(`[MCP Server] Error loading env file: ${error}`);
  }
}

// Load environment file if AIRBYTE_WIDGET_MCP_ENV_FILE is set
const envFilePath = process.env.AIRBYTE_WIDGET_MCP_ENV_FILE;
if (envFilePath) {
  if (existsSync(envFilePath)) {
    // Logging disabled in stdio mode to avoid JSON parsing errors
    // console.error(`[MCP Server] Loading environment from: ${envFilePath}`);
    loadEnvFile(envFilePath);
  } else {
    // console.error(`[MCP Server] Warning: Environment file not found: ${envFilePath}`);
  }
}

// Map AIRBYTE_* variables to AC_AIRBYTE_* if not already set
if (!process.env.AC_AIRBYTE_CLIENT_ID && process.env.AIRBYTE_CLIENT_ID) {
  process.env.AC_AIRBYTE_CLIENT_ID = process.env.AIRBYTE_CLIENT_ID;
}
if (!process.env.AC_AIRBYTE_CLIENT_SECRET && process.env.AIRBYTE_CLIENT_SECRET) {
  process.env.AC_AIRBYTE_CLIENT_SECRET = process.env.AIRBYTE_CLIENT_SECRET;
}
if (!process.env.AC_EXTERNAL_USER_ID && process.env.EXTERNAL_USER_ID) {
  process.env.AC_EXTERNAL_USER_ID = process.env.EXTERNAL_USER_ID;
}

import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import express from "express";
import cors from "cors";

const AIRBYTE_API_BASE = "https://api.airbyte.ai/api/v1";

// Hardcoded credentials (for development only - used as fallback)
const HARDCODED_CLIENT_ID = "8512844f-d22b-47bf-8a74-f3f6bfefb5cb";
const HARDCODED_CLIENT_SECRET = "dtdXV61f9AYAvOx3MuYVIeOBfikdKdTt";
const HARDCODED_EXTERNAL_USER_ID = "default-workspace";

// Read the bundled MCP App HTML at startup
const APP_HTML = readFileSync(join(__dirname, "mcp-app.html"), "utf-8");

async function fetchApplicationToken(): Promise<string> {
  // Use hardcoded values as fallback
  const clientId = process.env.AC_AIRBYTE_CLIENT_ID || HARDCODED_CLIENT_ID;
  const clientSecret = process.env.AC_AIRBYTE_CLIENT_SECRET || HARDCODED_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing AC_AIRBYTE_CLIENT_ID or AC_AIRBYTE_CLIENT_SECRET environment variables");
  }

  const response = await fetch(`${AIRBYTE_API_BASE}/account/applications/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
  });

  if (!response.ok) {
    throw new Error(`Authentication failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as Record<string, unknown>;
  const token = data.token ?? data.access_token;

  if (typeof token !== "string") {
    throw new Error(`Unexpected API response format: ${Object.keys(data).join(", ")}`);
  }

  return token;
}

async function fetchWidgetToken(appToken: string): Promise<string> {
  const externalUserId = process.env.AC_EXTERNAL_USER_ID || HARDCODED_EXTERNAL_USER_ID;
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "null";

  const response = await fetch(`${AIRBYTE_API_BASE}/embedded/widget-token`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${appToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      workspace_name: externalUserId,
      allowed_origin: allowedOrigin,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch widget token: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as Record<string, unknown>;
  const token = data.token ?? data.access_token;

  if (typeof token !== "string") {
    throw new Error(`Unexpected widget token response format: ${Object.keys(data).join(", ")}`);
  }

  return token;
}

async function getWidgetToken(): Promise<string> {
  const appToken = await fetchApplicationToken();
  return fetchWidgetToken(appToken);
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "Airbyte Widget MCP App",
    version: "1.0.0",
  });

  const resourceUri = "ui://airbyte/widget.html";

  registerAppTool(
    server,
    "open-airbyte-widget",
    {
      title: "Open Airbyte Widget",
      description: "Opens the Airbyte embedded widget to add or manage data source integrations. Call this when the user wants to add a new connector, set up an integration, or manage their data sources.",
      inputSchema: {},
      outputSchema: z.object({
        widgetToken: z.string().describe("Token for initializing the Airbyte widget"),
      }),
      _meta: { ui: { resourceUri } },
    },
    async (): Promise<CallToolResult> => {
      try {
        const widgetToken = await getWidgetToken();

        return {
          content: [
            {
              type: "text",
              text: "The Airbyte widget is now open. Use it to add or manage your data source integrations."
            }
          ],
          structuredContent: { widgetToken },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Failed to open widget: ${message}` }],
          isError: true,
        };
      }
    },
  );

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: APP_HTML,
            // CSP metadata to allow loading external scripts for the Airbyte widget
            // Uses the McpUiResourceCsp format expected by the sandbox
            // Note: ext-apps SDK is bundled, so we only need cdn.jsdelivr.net for the Airbyte widget
            _meta: {
              ui: {
                csp: {
                  resourceDomains: ["https://cdn.jsdelivr.net"],
                  connectDomains: ["https://api.airbyte.ai", "https://cdn.jsdelivr.net"],
                  frameDomains: ["https://cloud.airbyte.com", "https://app.airbyte.ai"],
                },
              },
            },
          },
        ],
      };
    },
  );

  return server;
}

const MCP_PORT = parseInt(process.env.MCP_PORT || "3001", 10);

async function main() {
  const transportMode = process.argv.includes("--stdio") ? "stdio" : "http";

  if (transportMode === "stdio") {
    // Don't log in stdio mode - stdout is used for JSON-RPC messages
    const server = createServer();
    await server.connect(new StdioServerTransport());
  } else {
    console.log(`[MCP Server] Starting HTTP server on port ${MCP_PORT}...`);

    const app = express();
    app.use(cors());
    app.use(express.json());

    // Handle POST requests - stateless mode (new server per request)
    // This is the recommended pattern from the MCP SDK for HTTP servers
    app.post("/mcp", async (req, res) => {
      try {
        // Create a new server and transport for each request (stateless mode)
        const server = createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // Stateless mode - no session management
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);

        // Clean up after request completes
        res.on("close", () => {
          transport.close();
          server.close();
        });
      } catch (error) {
        console.error("[MCP Server] Error:", error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal server error",
            },
            id: null,
          });
        }
      }
    });

    // Handle GET requests - not supported in stateless mode
    app.get("/mcp", async (req, res) => {
      res.status(405).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed in stateless mode",
        },
        id: null,
      });
    });

    // Handle DELETE requests - not supported in stateless mode
    app.delete("/mcp", async (req, res) => {
      res.status(405).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed in stateless mode",
        },
        id: null,
      });
    });

    app.listen(MCP_PORT, () => {
      console.log(`[MCP Server] HTTP server listening at http://localhost:${MCP_PORT}/mcp (stateless mode)`);
    });
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
