#!/usr/bin/env node
/**
 * MCP Apps Chat Server
 *
 * Full TypeScript implementation that:
 * 1. Serves the chat UI
 * 2. Connects to the widget-mcp-server (stdio)
 * 3. Calls Anthropic's API for the LLM
 * 4. Implements the MCP Apps host protocol
 */

import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getToolUiResourceUri, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.PORT || "8000", 10);
const SANDBOX_PORT = parseInt(process.env.SANDBOX_PORT || "8001", 10);

interface McpServerInfo {
  name: string;
  client: Client;
  tools: Map<string, Tool>;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ToolCallResult {
  toolName: string;
  result: CallToolResult;
  uiResourceUri?: string;
  uiResourceHtml?: string;
}

let mcpServer: McpServerInfo | null = null;
let anthropic: Anthropic | null = null;
const messageHistory: ChatMessage[] = [];

async function connectToMcpServer(): Promise<McpServerInfo> {
  console.log("[Server] Connecting to widget-mcp-server...");

  const widgetServerPath = join(__dirname, "widget-mcp-server", "dist", "server.mjs");

  const transport = new StdioClientTransport({
    command: "node",
    args: [widgetServerPath],
    env: {
      ...process.env,
      AC_AIRBYTE_CLIENT_ID: process.env.AC_AIRBYTE_CLIENT_ID || "",
      AC_AIRBYTE_CLIENT_SECRET: process.env.AC_AIRBYTE_CLIENT_SECRET || "",
      AC_EXTERNAL_USER_ID: process.env.AC_EXTERNAL_USER_ID || "customer-workspace",
      ALLOWED_ORIGIN: `http://localhost:${SANDBOX_PORT}`,
    },
  });

  const client = new Client({ name: "MCP Apps Chat Host", version: "1.0.0" });
  await client.connect(transport);

  const serverVersion = client.getServerVersion();
  const name = serverVersion?.name ?? "widget-mcp-server";

  const toolsList = await client.listTools();
  const tools = new Map(toolsList.tools.map((tool) => [tool.name, tool]));

  console.log(`[Server] Connected to ${name}, tools:`, Array.from(tools.keys()));

  return { name, client, tools };
}

async function callMcpTool(
  server: McpServerInfo,
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolCallResult> {
  console.log(`[Server] Calling tool: ${toolName}`, args);

  const tool = server.tools.get(toolName);
  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const result = (await server.client.callTool({
    name: toolName,
    arguments: args,
  })) as CallToolResult;

  const toolCallResult: ToolCallResult = {
    toolName,
    result,
  };

  const uiResourceUri = getToolUiResourceUri(tool);
  if (uiResourceUri) {
    console.log(`[Server] Tool has UI resource: ${uiResourceUri}`);
    toolCallResult.uiResourceUri = uiResourceUri;

    try {
      const resource = await server.client.readResource({ uri: uiResourceUri });
      if (resource.contents.length > 0) {
        const content = resource.contents[0];
        if (content.mimeType === RESOURCE_MIME_TYPE) {
          toolCallResult.uiResourceHtml =
            "blob" in content ? atob(content.blob as string) : (content.text as string);
          console.log(`[Server] Fetched UI resource HTML (${toolCallResult.uiResourceHtml.length} chars)`);
        }
      }
    } catch (error) {
      console.error("[Server] Failed to fetch UI resource:", error);
    }
  }

  return toolCallResult;
}

function getToolsForAnthropic(server: McpServerInfo): Anthropic.Tool[] {
  return Array.from(server.tools.values()).map((tool) => ({
    name: tool.name,
    description: tool.description || "",
    input_schema: (tool.inputSchema as Anthropic.Tool["input_schema"]) || { type: "object", properties: {} },
  }));
}

async function chat(userMessage: string): Promise<{
  response: string;
  toolCalls: ToolCallResult[];
}> {
  if (!anthropic) {
    throw new Error("Anthropic client not initialized");
  }
  if (!mcpServer) {
    throw new Error("MCP server not connected");
  }

  messageHistory.push({ role: "user", content: userMessage });

  const tools = getToolsForAnthropic(mcpServer);
  const toolCalls: ToolCallResult[] = [];

  const messages: Anthropic.MessageParam[] = messageHistory.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  let response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    system: `You are a helpful AI assistant that helps users manage their data integrations using Airbyte.
When a user wants to add a new connector, set up an integration, or manage their data sources, use the open-airbyte-widget tool.
Be concise and helpful in your responses.`,
    tools,
    messages,
  });

  while (response.stop_reason === "tool_use") {
    const assistantContent = response.content;
    const toolUseBlocks = assistantContent.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      try {
        const result = await callMcpTool(
          mcpServer,
          toolUse.name,
          toolUse.input as Record<string, unknown>
        );
        toolCalls.push(result);

        const textContent = result.result.content
          ?.filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("\n") || "Tool executed successfully";

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: textContent,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: `Error: ${errorMessage}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: "assistant", content: assistantContent });
    messages.push({ role: "user", content: toolResults });

    response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: `You are a helpful AI assistant that helps users manage their data integrations using Airbyte.
When a user wants to add a new connector, set up an integration, or manage their data sources, use the open-airbyte-widget tool.
Be concise and helpful in your responses.`,
      tools,
      messages,
    });
  }

  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  const assistantResponse = textBlocks.map((block) => block.text).join("\n");

  messageHistory.push({ role: "assistant", content: assistantResponse });

  return { response: assistantResponse, toolCalls };
}

const CHAT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>MCP Apps Chat</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    
    .header {
      background: #1a1a2e;
      color: white;
      padding: 1rem 2rem;
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    
    .header h1 { font-size: 1.5rem; font-weight: 600; }
    
    .chat-container {
      flex: 1;
      max-width: 900px;
      width: 100%;
      margin: 0 auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    
    .messages {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 1rem 0;
    }
    
    .message {
      padding: 1rem;
      border-radius: 12px;
      max-width: 80%;
    }
    
    .message.user {
      background: #1a1a2e;
      color: white;
      align-self: flex-end;
    }
    
    .message.assistant {
      background: white;
      border: 1px solid #e0e0e0;
      align-self: flex-start;
    }
    
    .message.error {
      background: #fee2e2;
      border: 1px solid #fecaca;
      color: #dc2626;
    }
    
    .mcp-app-container {
      margin-top: 1rem;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      overflow: hidden;
      background: white;
    }
    
    .mcp-app-container iframe {
      width: 100%;
      height: 500px;
      border: none;
    }
    
    .input-container {
      display: flex;
      gap: 0.5rem;
      padding: 1rem;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    
    .input-container input {
      flex: 1;
      padding: 0.75rem 1rem;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      font-size: 1rem;
      outline: none;
    }
    
    .input-container input:focus { border-color: #1a1a2e; }
    
    .input-container button {
      padding: 0.75rem 1.5rem;
      background: #1a1a2e;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      cursor: pointer;
      transition: background 0.2s;
    }
    
    .input-container button:hover { background: #2d2d4a; }
    .input-container button:disabled { background: #ccc; cursor: not-allowed; }
    
    .examples {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding: 0.5rem 0;
    }
    
    .example-btn {
      padding: 0.5rem 1rem;
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 20px;
      font-size: 0.875rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .example-btn:hover {
      background: #f0f0f0;
      border-color: #1a1a2e;
    }
    
    .loading {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #666;
    }
    
    .loading::after {
      content: '';
      width: 16px;
      height: 16px;
      border: 2px solid #e0e0e0;
      border-top-color: #1a1a2e;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="header">
    <h1>MCP Apps Chat</h1>
  </div>
  
  <div class="chat-container">
    <div class="examples">
      <button class="example-btn" onclick="sendMessage('Add a new connector')">Add a new connector</button>
      <button class="example-btn" onclick="sendMessage('Help me set up a data integration')">Set up integration</button>
      <button class="example-btn" onclick="sendMessage('What can you help me with?')">What can you do?</button>
    </div>
    
    <div class="messages" id="messages"></div>
    
    <div class="input-container">
      <input 
        type="text" 
        id="messageInput" 
        placeholder="Type your message..." 
        onkeypress="if(event.key === 'Enter') sendMessage()"
      />
      <button id="sendBtn" onclick="sendMessage()">Send</button>
    </div>
  </div>

  <script>
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const SANDBOX_PORT = ${SANDBOX_PORT};
    
    function addMessage(content, type = 'assistant') {
      const msgEl = document.createElement('div');
      msgEl.className = 'message ' + type;
      msgEl.textContent = content;
      messagesEl.appendChild(msgEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    
    function renderMcpApp(toolCall) {
      if (!toolCall.uiResourceHtml) {
        console.log('No UI resource HTML for tool call');
        return;
      }
      
      const container = document.createElement('div');
      container.className = 'mcp-app-container';
      
      const iframe = document.createElement('iframe');
      iframe.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox';
      
      // Create a blob URL for the HTML content
      const blob = new Blob([toolCall.uiResourceHtml], { type: 'text/html' });
      iframe.src = URL.createObjectURL(blob);
      
      // Extract widget token from tool result
      const widgetToken = toolCall.result?.structuredContent?.widgetToken;
      
      // When iframe loads, send the widget token
      iframe.onload = () => {
        if (widgetToken && iframe.contentWindow) {
          console.log('[Host] Sending widget token to iframe');
          iframe.contentWindow.postMessage({
            type: 'widget-token',
            token: widgetToken
          }, '*');
        }
      };
      
      container.appendChild(iframe);
      messagesEl.appendChild(container);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    
    function showLoading() {
      const loadingEl = document.createElement('div');
      loadingEl.className = 'message assistant loading';
      loadingEl.id = 'loading';
      loadingEl.textContent = 'Thinking';
      messagesEl.appendChild(loadingEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    
    function hideLoading() {
      const loadingEl = document.getElementById('loading');
      if (loadingEl) loadingEl.remove();
    }
    
    window.sendMessage = async function(text) {
      const message = text || inputEl.value.trim();
      if (!message) return;
      
      inputEl.value = '';
      sendBtn.disabled = true;
      
      addMessage(message, 'user');
      showLoading();
      
      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message })
        });
        
        hideLoading();
        
        if (!response.ok) {
          const error = await response.json();
          addMessage(error.error || 'Something went wrong', 'error');
          return;
        }
        
        const data = await response.json();
        addMessage(data.response, 'assistant');
        
        // Render MCP App UIs for tool calls
        for (const toolCall of (data.toolCalls || [])) {
          if (toolCall.uiResourceHtml) {
            renderMcpApp(toolCall);
          }
        }
        
      } catch (error) {
        hideLoading();
        addMessage('Error: ' + error.message, 'error');
      } finally {
        sendBtn.disabled = false;
        inputEl.focus();
      }
    };
    
    inputEl.focus();
  </script>
</body>
</html>`;

async function main() {
  const apiKey = process.env.AC_ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: AC_ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  anthropic = new Anthropic({ apiKey });
  console.log("[Server] Anthropic client initialized");

  try {
    mcpServer = await connectToMcpServer();
  } catch (error) {
    console.error("[Server] Failed to connect to MCP server:", error);
    process.exit(1);
  }

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.send(CHAT_HTML);
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { message } = req.body;
      if (!message || typeof message !== "string") {
        res.status(400).json({ error: "Message is required" });
        return;
      }

      const result = await chat(message);
      res.json(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[Server] Chat error:", errorMessage);
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      mcpServer: mcpServer?.name ?? null,
      tools: mcpServer ? Array.from(mcpServer.tools.keys()) : [],
    });
  });

  app.listen(PORT, () => {
    console.log(`[Server] MCP Apps Chat running at http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
