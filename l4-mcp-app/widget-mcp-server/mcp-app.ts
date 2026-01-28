import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

// Declare the AirbyteEmbeddedWidget global (loaded from CDN in HTML)
declare const AirbyteEmbeddedWidget: new (config: {
  token: string;
  onEvent?: (event: unknown) => void;
}) => {
  open: () => void;
  destroy?: () => void;
};

// Inject styles
const style = document.createElement("style");
style.textContent = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    width: 100%;
    min-height: 100vh;
    height: 100vh;
    overflow: visible;
  }
  body {
    background: var(--color-background-primary, #ffffff);
    color: var(--color-text-primary, #1a1a1a);
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }
  .container {
    text-align: center;
    padding: 2rem;
  }
  .loading { color: var(--color-text-secondary, #666); }
  .error { color: #dc2626; }
  .success { color: #16a34a; }
`;
document.head.appendChild(style);

const statusEl = document.getElementById("status")!;

// Track widget instance for cleanup
let widgetInstance: { open: () => void; destroy?: () => void } | null = null;

function showStatus(message: string, type: "loading" | "error" | "success" = "loading") {
  statusEl.textContent = message;
  statusEl.className = type;
  console.log(`[Status] ${type}: ${message}`);
}

const app = new App({ name: "Airbyte Widget", version: "1.0.0" });

function handleHostContextChanged(ctx: { theme?: unknown; styles?: { variables?: unknown }; safeAreaInsets?: { top: number; right: number; bottom: number; left: number } }) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.safeAreaInsets) {
    document.body.style.padding =
      `${ctx.safeAreaInsets.top}px ${ctx.safeAreaInsets.right}px ${ctx.safeAreaInsets.bottom}px ${ctx.safeAreaInsets.left}px`;
  }
}

app.onhostcontextchanged = handleHostContextChanged;

// Called when the host starts calling the tool
app.ontoolinput = () => {
  console.log("[Handler] ontoolinput called");
  app.sendLog({ level: "info", data: "Tool input received, fetching widget token..." });
  showStatus("Fetching widget token...", "loading");
};

// Called when the host returns the tool result - this is the standard MCP Apps pattern
app.ontoolresult = (result) => {
  console.log("[Handler] ontoolresult called with:", result);
  app.sendLog({ level: "info", data: `Tool result received: isError=${result.isError}` });

  if (result.isError) {
    const errorText = result.content?.find((c: { type: string; text?: string }) => c.type === "text")?.text ?? "Unknown error";
    app.sendLog({ level: "error", data: `Tool error: ${errorText}` });
    showStatus(errorText, "error");
    return;
  }

  const { widgetToken } = (result.structuredContent || {}) as { widgetToken?: string };

  if (!widgetToken) {
    app.sendLog({ level: "error", data: "No widget token in result" });
    showStatus("No widget token received", "error");
    return;
  }

  app.sendLog({ level: "info", data: `Widget token received: ${widgetToken.substring(0, 20)}...` });
  showStatus("Opening Airbyte widget...", "success");

  // Use the AirbyteEmbeddedWidget library (loaded from CDN) instead of manual iframe creation
  try {
    // Destroy existing widget instance if any
    if (widgetInstance) {
      widgetInstance.destroy?.();
      widgetInstance = null;
    }

    // Create and open the widget using the official library
    widgetInstance = new AirbyteEmbeddedWidget({
      token: widgetToken,
      onEvent: (event) => {
        console.log("[Widget] Airbyte widget event:", event);
        app.sendLog({ level: "info", data: `Widget event: ${JSON.stringify(event)}` });
      },
    });

    widgetInstance.open();
    showStatus("Widget opened! Configure your integration.", "success");
    app.sendLog({ level: "info", data: "Widget opened successfully" });
  } catch (error) {
    const errorMsg = `Failed to initialize widget: ${(error as Error).message}`;
    console.error("[Widget Error]", error);
    app.sendLog({ level: "error", data: errorMsg });
    showStatus(errorMsg, "error");
  }
};

app.ontoolcancelled = (params) => {
  showStatus(`Cancelled: ${params.reason || "Unknown reason"}`, "error");
};

app.onerror = (error) => {
  showStatus(`Error: ${error.message}`, "error");
};

app.onteardown = async () => {
  // Clean up widget instance on teardown
  if (widgetInstance) {
    try {
      widgetInstance.destroy?.();
    } catch (e) {
      console.warn("Error destroying widget:", e);
    }
    widgetInstance = null;
  }
  return {};
};

// Catch all JavaScript errors
window.addEventListener("error", (event) => {
  console.error("[Global Error]", event.error || event.message);
  showStatus(`JavaScript error: ${event.message}`, "error");
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[Unhandled Promise Rejection]", event.reason);
  showStatus(`Promise rejection: ${event.reason}`, "error");
});

console.log("[Init] MCP App script starting...");

// Connect to host and wait for tool calls - following the standard MCP Apps pattern
app.connect().then(() => {
  console.log("[Init] MCP App connected to host successfully");
  app.sendLog({ level: "info", data: "MCP App connected to host successfully" });

  const ctx = app.getHostContext();
  if (ctx) {
    console.log("[Init] Host context received:", ctx);
    app.sendLog({ level: "info", data: `Host context received: theme=${ctx.theme}, has styles=${!!ctx.styles}` });
    handleHostContextChanged(ctx);
  } else {
    console.log("[Init] No host context available");
    app.sendLog({ level: "info", data: "No host context available" });
  }

  // Show ready state and wait for the host to call the tool
  showStatus("Ready. Waiting for tool call...", "loading");
}).catch((error) => {
  console.error("[Init] Connection failed:", error);
  const errorMsg = `Connection failed: ${(error as Error).message}`;
  showStatus(errorMsg, "error");
});
