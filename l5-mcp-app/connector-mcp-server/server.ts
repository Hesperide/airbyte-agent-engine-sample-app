#!/usr/bin/env node
/**
 * Airbyte Connector MCP App Server
 *
 * MCP server that provides a custom connector selection UI without using iframes.
 * This approach works within Claude Desktop's CSP restrictions by rendering
 * the connector list directly in the MCP App's DOM.
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
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();

        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  } catch (error) {
    // Logging disabled in stdio mode
  }
}

// Load environment file if AIRBYTE_WIDGET_MCP_ENV_FILE is set
const envFilePath = process.env.AIRBYTE_WIDGET_MCP_ENV_FILE;
if (envFilePath) {
  if (existsSync(envFilePath)) {
    loadEnvFile(envFilePath);
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

// Connector type definition
interface Connector {
  id: string;
  name: string;
  icon?: string;
  description?: string;
}

// Predefined list of popular connectors with their icons
// These are the connectors shown in the Airbyte widget
const POPULAR_CONNECTORS: Connector[] = [
  { id: "gong", name: "Gong", icon: "https://connectors.airbyte.com/files/metadata/airbyte/source-gong/latest/icon.svg", description: "Sales intelligence platform" },
  { id: "hubspot", name: "HubSpot", icon: "https://connectors.airbyte.com/files/metadata/airbyte/source-hubspot/latest/icon.svg", description: "CRM and marketing platform" },
  { id: "github", name: "GitHub", icon: "https://connectors.airbyte.com/files/metadata/airbyte/source-github/latest/icon.svg", description: "Code hosting and collaboration" },
  { id: "linear", name: "Linear", icon: "https://connectors.airbyte.com/files/metadata/airbyte/source-linear/latest/icon.svg", description: "Project management tool" },
  { id: "jira", name: "Jira", icon: "https://connectors.airbyte.com/files/metadata/airbyte/source-jira/latest/icon.svg", description: "Issue tracking and project management" },
  { id: "slack", name: "Slack", icon: "https://connectors.airbyte.com/files/metadata/airbyte/source-slack/latest/icon.svg", description: "Team communication platform" },
  { id: "salesforce", name: "Salesforce", icon: "https://connectors.airbyte.com/files/metadata/airbyte/source-salesforce/latest/icon.svg", description: "CRM platform" },
  { id: "notion", name: "Notion", icon: "https://connectors.airbyte.com/files/metadata/airbyte/source-notion/latest/icon.svg", description: "All-in-one workspace" },
  { id: "google-sheets", name: "Google Sheets", icon: "https://connectors.airbyte.com/files/metadata/airbyte/source-google-sheets/latest/icon.svg", description: "Spreadsheet application" },
  { id: "postgres", name: "PostgreSQL", icon: "https://connectors.airbyte.com/files/metadata/airbyte/source-postgres/latest/icon.svg", description: "Relational database" },
];

async function fetchApplicationToken(): Promise<string> {
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

function createServer(): McpServer {
  const server = new McpServer({
    name: "Airbyte Connector MCP App",
    version: "1.0.0",
  });

  const resourceUri = "ui://airbyte/connectors.html";

  // Tool to show the connector selection UI
  registerAppTool(
    server,
    "show-connectors",
    {
      title: "Show Airbyte Connectors",
      description: "Display available Airbyte connectors for data integration. Shows a list of popular connectors that can be configured.",
      inputSchema: {},
      outputSchema: z.object({
        connectorsJson: z.string().describe("JSON string containing list of available connectors"),
        widgetToken: z.string().optional().describe("Token for Airbyte widget authentication"),
      }),
      _meta: { ui: { resourceUri } },
    },
    async (): Promise<CallToolResult> => {
      try {
        // Get the widget token for potential future use
        const appToken = await fetchApplicationToken();
        const widgetToken = await fetchWidgetToken(appToken);

        return {
          content: [
            {
              type: "text",
              text: "Here are the available Airbyte connectors. Select one to configure your data integration."
            }
          ],
          structuredContent: {
            connectorsJson: JSON.stringify(POPULAR_CONNECTORS),
            widgetToken, // Pass token for when user selects a connector
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Failed to load connectors: ${message}` }],
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
            // CSP metadata - no frameDomains needed since we render directly in DOM
            _meta: {
              ui: {
                csp: {
                  // Allow loading connector icons from Airbyte CDN
                  resourceDomains: ["https://connectors.airbyte.com"],
                  // Allow API calls to Airbyte
                  connectDomains: ["https://api.airbyte.ai", "https://connectors.airbyte.com"],
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
    const server = createServer();
    await server.connect(new StdioServerTransport());
  } else {
    console.log(`[MCP Server] Starting HTTP server on port ${MCP_PORT}...`);

    const app = express();
    app.use(cors());
    app.use(express.json());

    app.post("/mcp", async (req, res) => {
      try {
        const server = createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);

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
