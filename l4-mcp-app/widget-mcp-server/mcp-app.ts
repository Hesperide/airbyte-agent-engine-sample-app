import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

// Inject styles
const style = document.createElement("style");
style.textContent = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    width: 100%;
    min-height: 600px;
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

function showStatus(message: string, type: "loading" | "error" | "success" = "loading") {
  statusEl.textContent = message;
  statusEl.className = type;
  console.log(`[Status] ${type}: ${message}`);
}

const app = new App({ name: "Airbyte Widget", version: "1.0.0" });

function handleHostContextChanged(ctx: any) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.safeAreaInsets) {
    document.body.style.padding =
      `${ctx.safeAreaInsets.top}px ${ctx.safeAreaInsets.right}px ${ctx.safeAreaInsets.bottom}px ${ctx.safeAreaInsets.left}px`;
  }
}

app.onhostcontextchanged = handleHostContextChanged;

app.ontoolinput = () => {
  console.log("[Handler] ontoolinput called");
  app.sendLog({ level: "info", data: "Tool input received, fetching widget token..." });
  showStatus("Fetching widget token...", "loading");
};

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
  showStatus("Decoding widget token...", "loading");

  try {
    // Decode the base64 token to get the widgetUrl
    const decoded = JSON.parse(atob(widgetToken));
    const widgetUrl = decoded.widgetUrl;

    if (!widgetUrl) {
      throw new Error("No widgetUrl found in token");
    }

    app.sendLog({ level: "info", data: `Widget URL extracted: ${widgetUrl}` });
    showStatus("Creating iframe for Airbyte widget...", "loading");

    // Remove any existing iframe
    const existingIframe = document.querySelector("iframe.airbyte-widget");
    if (existingIframe) {
      existingIframe.remove();
    }

    // Create iframe directly instead of using the widget library
    const iframe = document.createElement("iframe");
    iframe.className = "airbyte-widget";
    iframe.style.width = "100%";
    iframe.style.height = "100vh";
    iframe.style.border = "none";
    iframe.style.position = "fixed";
    iframe.style.top = "0";
    iframe.style.left = "0";
    iframe.style.zIndex = "1000";

    // Add sandbox attributes that allow the widget to function
    iframe.setAttribute("sandbox", "allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox");
    iframe.setAttribute("allow", "clipboard-read; clipboard-write");

    // Add load event listener
    iframe.addEventListener("load", () => {
      console.log("[Widget] Iframe loaded successfully");
      app.sendLog({ level: "info", data: "Iframe loaded successfully" });
      showStatus("Airbyte widget loaded successfully", "success");
    });

    // Add error event listener
    iframe.addEventListener("error", (e) => {
      console.error("[Widget] Iframe error:", e);
      app.sendLog({ level: "error", data: `Iframe error: ${e.type}` });
      showStatus("Failed to load widget iframe", "error");
    });

    document.body.appendChild(iframe);

    console.log("[Widget] Direct iframe created:", {
      src: widgetUrl,
      sandbox: iframe.sandbox?.toString(),
      allow: iframe.getAttribute("allow")
    });

    app.sendLog({ level: "info", data: `Setting iframe src to: ${widgetUrl}` });
    showStatus("Loading Airbyte widget...", "loading");

    // Set src after adding event listeners
    iframe.src = widgetUrl;

    // Check after delays
    setTimeout(() => {
      const iframes = document.querySelectorAll("iframe");
      app.sendLog({ level: "info", data: `DOM check (1s): ${iframes.length} iframes found` });
      console.log("[Widget] Iframe contentWindow:", iframe.contentWindow ? "accessible" : "not accessible");
    }, 1000);

    setTimeout(() => {
      const iframes = document.querySelectorAll("iframe");
      app.sendLog({ level: "info", data: `DOM check (3s): ${iframes.length} iframes found, load status: ${iframe.src ? "src set" : "no src"}` });
    }, 3000);
  } catch (error) {
    const errorMsg = `Failed to load widget: ${(error as Error).message}`;
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
  const iframe = document.querySelector("iframe.airbyte-widget");
  if (iframe) {
    try {
      iframe.remove();
    } catch (e) {
      console.warn("Error removing iframe:", e);
    }
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

app.connect().then(async () => {
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

  // Immediately call the tool to get the widget token
  showStatus("Fetching widget token...", "loading");
  app.sendLog({ level: "info", data: "Calling open-airbyte-widget tool..." });

  try {
    const result = await app.callServerTool({ name: "open-airbyte-widget", arguments: {} });
    console.log("[Init] Tool result received:", result);
    app.sendLog({ level: "info", data: `Tool result received: isError=${result.isError}` });

    // Manually call the ontoolresult handler
    if (app.ontoolresult) {
      app.ontoolresult(result);
    }
  } catch (error) {
    const errorMsg = `Failed to call tool: ${(error as Error).message}`;
    console.error("[Init] Error:", errorMsg);
    app.sendLog({ level: "error", data: errorMsg });
    showStatus(errorMsg, "error");
  }
}).catch((error) => {
  console.error("[Init] Connection failed:", error);
  const errorMsg = `Connection failed: ${(error as Error).message}`;
  showStatus(errorMsg, "error");
});
