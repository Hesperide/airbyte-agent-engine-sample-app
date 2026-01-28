/**
 * Airbyte Connector MCP App - Client Side
 *
 * Custom connector selection UI that renders directly in the MCP App's DOM.
 * No iframes are used, avoiding the frame-src CSP restriction in Claude Desktop.
 */

import { App } from "@modelcontextprotocol/ext-apps";

// Connector type from server
interface Connector {
  id: string;
  name: string;
  icon?: string;
  description?: string;
}

// Tool result structure
interface ToolResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: {
    connectorsJson?: string;
    widgetToken?: string;
  };
}

// State
let selectedConnector: Connector | null = null;
let widgetToken: string | null = null;

// DOM elements
const statusEl = document.getElementById("status") as HTMLDivElement;
const gridEl = document.getElementById("connector-grid") as HTMLDivElement;
const selectedInfoEl = document.getElementById("selected-info") as HTMLSpanElement;
const configureBtn = document.getElementById("configure-btn") as HTMLButtonElement;

/**
 * Update status message
 */
function showStatus(message: string, type: "loading" | "success" | "error"): void {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

/**
 * Render a single connector card
 */
function renderConnectorCard(connector: Connector): HTMLElement {
  const card = document.createElement("div");
  card.className = "connector-card";
  card.dataset.connectorId = connector.id;

  if (connector.icon) {
    const img = document.createElement("img");
    img.className = "connector-icon";
    img.src = connector.icon;
    img.alt = connector.name;
    img.onerror = () => {
      // Replace with placeholder on error
      const placeholder = document.createElement("div");
      placeholder.className = "connector-icon-placeholder";
      placeholder.textContent = connector.name.charAt(0).toUpperCase();
      img.replaceWith(placeholder);
    };
    card.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "connector-icon-placeholder";
    placeholder.textContent = connector.name.charAt(0).toUpperCase();
    card.appendChild(placeholder);
  }

  const name = document.createElement("span");
  name.className = "connector-name";
  name.textContent = connector.name;
  card.appendChild(name);

  card.addEventListener("click", () => {
    // Deselect previous
    document.querySelectorAll(".connector-card.selected").forEach((el) => {
      el.classList.remove("selected");
    });

    // Select this one
    card.classList.add("selected");
    selectedConnector = connector;

    // Update UI
    selectedInfoEl.textContent = `Selected: ${connector.name}`;
    configureBtn.disabled = false;

    app.sendLog({ level: "info", data: `Selected connector: ${connector.name}` });
  });

  return card;
}

/**
 * Render all connectors in the grid
 */
function renderConnectors(connectors: Connector[]): void {
  gridEl.innerHTML = "";

  for (const connector of connectors) {
    const card = renderConnectorCard(connector);
    gridEl.appendChild(card);
  }
}

/**
 * Open the Airbyte Cloud configuration page in the browser
 */
async function openConfigurationInBrowser(): Promise<void> {
  if (!selectedConnector) {
    showStatus("Please select a connector first", "error");
    return;
  }

  showStatus(`Opening ${selectedConnector.name} configuration...`, "loading");

  try {
    // Construct the Airbyte Cloud URL for the selected connector
    // The widget token can be used to pre-authenticate if needed
    const configUrl = `https://cloud.airbyte.com/workspaces/new?connector=${selectedConnector.id}`;

    // Use the MCP Apps open-link capability to open in browser
    await app.openLink(configUrl);

    showStatus(
      `Opened ${selectedConnector.name} configuration in your browser. Complete the setup there.`,
      "success"
    );

    app.sendLog({
      level: "info",
      data: `Opened browser for ${selectedConnector.name} configuration`,
    });
  } catch (error) {
    const errorMsg = `Failed to open browser: ${(error as Error).message}`;
    showStatus(errorMsg, "error");
    app.sendLog({ level: "error", data: errorMsg });
  }
}

// Initialize the MCP App
console.log("[Init] MCP App script starting...");

const app = new App({ name: "Airbyte Connectors", version: "1.0.0" });

// Set up configure button handler
configureBtn.addEventListener("click", () => {
  openConfigurationInBrowser();
});

// Handle tool input (when tool is called)
app.ontoolinput = () => {
  console.log("[Handler] ontoolinput called");
  app.sendLog({ level: "info", data: "Tool input received, waiting for connectors..." });
  showStatus("Loading connectors...", "loading");
};

// Handle tool result (when server returns data)
app.ontoolresult = (result: ToolResult) => {
  console.log("[Handler] ontoolresult called with:", result);
  app.sendLog({ level: "info", data: `Tool result received: isError=${result.isError}` });

  if (result.isError) {
    const errorText =
      result.content?.find((c) => c.type === "text")?.text ?? "Unknown error";
    app.sendLog({ level: "error", data: `Tool error: ${errorText}` });
    showStatus(errorText, "error");
    return;
  }

  const { connectorsJson, widgetToken: token } = result.structuredContent || {};

  if (!connectorsJson) {
    app.sendLog({ level: "error", data: "No connectors in result" });
    showStatus("No connectors available", "error");
    return;
  }

  // Parse the connectors JSON string
  let connectors: Connector[];
  try {
    connectors = JSON.parse(connectorsJson) as Connector[];
  } catch (e) {
    app.sendLog({ level: "error", data: `Failed to parse connectors: ${e}` });
    showStatus("Failed to parse connectors data", "error");
    return;
  }

  if (connectors.length === 0) {
    app.sendLog({ level: "error", data: "No connectors in result" });
    showStatus("No connectors available", "error");
    return;
  }

  // Store the widget token for later use
  widgetToken = token || null;

  app.sendLog({ level: "info", data: `Received ${connectors.length} connectors` });
  showStatus("Select a connector to configure", "success");

  // Render the connectors
  renderConnectors(connectors);
};

// Handle host context changes (theme, etc.)
app.onhostcontextchanged = (context) => {
  console.log("[Handler] Host context changed:", context);
  app.sendLog({
    level: "info",
    data: `Host context: theme=${context.theme}`,
  });

  // Apply theme-specific styles if needed
  if (context.theme === "dark") {
    document.body.style.setProperty("--bg-color", "#1a1a1a");
    document.body.style.setProperty("--text-color", "#e0e0e0");
  }
};

// Handle teardown
app.onteardown = () => {
  console.log("[Handler] Teardown requested");
  app.sendLog({ level: "info", data: "MCP App teardown" });
};

// Connect to the host
app
  .connect()
  .then(() => {
    console.log("[Init] MCP App connected to host successfully");
    app.sendLog({ level: "info", data: "MCP App connected to host successfully" });
    showStatus("Ready. Waiting for connectors...", "loading");
  })
  .catch((error) => {
    console.error("[Init] Failed to connect:", error);
    showStatus(`Failed to connect: ${error.message}`, "error");
  });
