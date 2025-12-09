import { tool } from "ai";
import { z } from "zod/v3";
import { mcpService, configManager } from "../../ipc/mcpHandlers";
import { mcpHealthService } from "../mcpHealthService";
import type { Tool } from "../../types/mcp";
import { getLogger } from '../logging';

const logger = getLogger();

/**
 * Generate HTML for an mcp-use widget
 * Creates a self-contained HTML document that renders the widget
 */
function generateWidgetHtml(
  widgetMeta: { name: string; description?: string; type: string },
  data: Record<string, any>
): string {
  const { name } = widgetMeta;

  // Generate widget-specific HTML based on the widget name
  switch (name) {
    case 'weather-card':
      return generateWeatherCardHtml(data);
    case 'calculator-result':
      return generateCalculatorResultHtml(data);
    case 'text-analysis-chart':
      return generateTextAnalysisChartHtml(data);
    default:
      // Generic widget fallback
      return generateGenericWidgetHtml(name, data);
  }
}

/**
 * Weather card widget HTML
 */
function generateWeatherCardHtml(data: Record<string, any>): string {
  const { city, condition, temperature, unit, humidity, timestamp } = data;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: rgba(255, 255, 255, 0.95);
      border-radius: 20px;
      padding: 30px;
      width: 100%;
      max-width: 350px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
    }
    .city {
      font-size: 24px;
      font-weight: 600;
      color: #333;
      margin-bottom: 5px;
    }
    .timestamp {
      font-size: 12px;
      color: #888;
      margin-bottom: 20px;
    }
    .temp-container {
      display: flex;
      align-items: center;
      margin-bottom: 20px;
    }
    .temp {
      font-size: 64px;
      font-weight: 300;
      color: #333;
    }
    .unit {
      font-size: 24px;
      color: #666;
      margin-left: 5px;
      align-self: flex-start;
      margin-top: 10px;
    }
    .condition {
      font-size: 18px;
      color: #666;
      text-transform: capitalize;
      margin-bottom: 20px;
    }
    .details {
      display: flex;
      gap: 20px;
      padding-top: 20px;
      border-top: 1px solid #eee;
    }
    .detail-item {
      text-align: center;
    }
    .detail-label {
      font-size: 12px;
      color: #888;
      margin-bottom: 5px;
    }
    .detail-value {
      font-size: 16px;
      font-weight: 500;
      color: #333;
    }
    .weather-icon {
      font-size: 48px;
      margin-left: auto;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="city">${escapeHtml(city || 'Unknown')}</div>
    <div class="timestamp">${escapeHtml(timestamp || new Date().toLocaleString())}</div>
    <div class="temp-container">
      <span class="temp">${escapeHtml(String(temperature ?? '--'))}</span>
      <span class="unit">${escapeHtml(unit || '°C')}</span>
      <span class="weather-icon">${getWeatherEmoji(condition)}</span>
    </div>
    <div class="condition">${escapeHtml(condition || 'Unknown')}</div>
    <div class="details">
      <div class="detail-item">
        <div class="detail-label">Humidity</div>
        <div class="detail-value">${escapeHtml(String(humidity ?? '--'))}${typeof humidity === 'number' ? '%' : ''}</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Calculator result widget HTML
 */
function generateCalculatorResultHtml(data: Record<string, any>): string {
  const { expression, result } = data;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .calculator {
      background: #16213e;
      border-radius: 15px;
      padding: 25px;
      min-width: 280px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    }
    .expression {
      font-size: 18px;
      color: #888;
      text-align: right;
      margin-bottom: 10px;
      font-family: 'SF Mono', Monaco, monospace;
    }
    .result {
      font-size: 42px;
      font-weight: 300;
      color: #fff;
      text-align: right;
      font-family: 'SF Mono', Monaco, monospace;
    }
  </style>
</head>
<body>
  <div class="calculator">
    <div class="expression">${escapeHtml(expression || '')}</div>
    <div class="result">= ${escapeHtml(String(result ?? ''))}</div>
  </div>
</body>
</html>`;
}

/**
 * Text analysis chart widget HTML
 */
function generateTextAnalysisChartHtml(data: Record<string, any>): string {
  const { wordCount, charCount, sentenceCount, avgWordLength } = data;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .chart {
      background: #fff;
      border-radius: 15px;
      padding: 25px;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 5px 20px rgba(0, 0, 0, 0.1);
    }
    .title {
      font-size: 18px;
      font-weight: 600;
      color: #333;
      margin-bottom: 20px;
    }
    .stat {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #eee;
    }
    .stat:last-child { border-bottom: none; }
    .stat-label { color: #666; }
    .stat-value { font-weight: 600; color: #333; }
  </style>
</head>
<body>
  <div class="chart">
    <div class="title">Text Analysis</div>
    <div class="stat">
      <span class="stat-label">Words</span>
      <span class="stat-value">${escapeHtml(String(wordCount ?? 0))}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Characters</span>
      <span class="stat-value">${escapeHtml(String(charCount ?? 0))}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Sentences</span>
      <span class="stat-value">${escapeHtml(String(sentenceCount ?? 0))}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Avg. Word Length</span>
      <span class="stat-value">${escapeHtml(String(avgWordLength ?? 0))}</span>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generic widget fallback HTML
 */
function generateGenericWidgetHtml(name: string, data: Record<string, any>): string {
  const dataEntries = Object.entries(data)
    .filter(([key]) => !key.startsWith('_'))
    .map(([key, value]) => `
      <div class="item">
        <span class="key">${escapeHtml(key)}</span>
        <span class="value">${escapeHtml(String(value))}</span>
      </div>
    `).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f8f9fa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .widget {
      background: #fff;
      border-radius: 12px;
      padding: 20px;
      width: 100%;
      max-width: 350px;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
    }
    .title {
      font-size: 16px;
      font-weight: 600;
      color: #333;
      margin-bottom: 15px;
      text-transform: capitalize;
    }
    .item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #eee;
    }
    .item:last-child { border-bottom: none; }
    .key { color: #666; text-transform: capitalize; }
    .value { font-weight: 500; color: #333; }
  </style>
</head>
<body>
  <div class="widget">
    <div class="title">${escapeHtml(name.replace(/-/g, ' '))}</div>
    ${dataEntries}
  </div>
</body>
</html>`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Inject data into widget HTML template
 * Adds a script that:
 * 1. Sets window variables for immediate access (fallback)
 * 2. Implements @mcp-ui/client postMessage protocol to receive iframeRenderData
 *
 * The postMessage protocol:
 * - Parent sends 'ui-lifecycle-iframe-render-data' with payload.renderData
 * - Iframe notifies parent with 'ui-lifecycle-iframe-ready' when ready
 */
function injectDataIntoHtml(html: string, data: Record<string, any>): string {
  // Escape data for safe inclusion in script
  const jsonData = JSON.stringify(data);

  const dataScript = `<script>
    // Fallback: Set data immediately for templates that read from window variables
    window.__data = ${jsonData};
    window.__props = ${jsonData};
    window.__widgetData = ${jsonData};
    window.__IFRAME_RENDER_DATA__ = ${jsonData};

    // mcp-use Apps SDK format: window.openai with toolInput and toolOutput
    // useWidget hook reads props from toolInput, output from toolOutput
    window.openai = window.openai || {};
    window.openai.toolInput = ${jsonData};
    window.openai.toolOutput = ${jsonData};

    // @mcp-ui/client postMessage protocol for receiving iframeRenderData
    (function() {
      var renderDataReceived = false;

      // Listen for render data from parent (UIResourceRenderer)
      window.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'ui-lifecycle-iframe-render-data') {
          if (renderDataReceived) return;
          renderDataReceived = true;

          var renderData = event.data.payload && event.data.payload.renderData;
          if (renderData) {
            // Update window variables with data from parent
            window.__data = renderData;
            window.__props = renderData;
            window.__widgetData = renderData;
            window.__IFRAME_RENDER_DATA__ = renderData;

            // mcp-use Apps SDK format
            window.openai = window.openai || {};
            window.openai.toolInput = renderData;
            window.openai.toolOutput = renderData;

            // Dispatch custom event for templates that listen for data
            window.dispatchEvent(new CustomEvent('mcp-render-data', { detail: renderData }));

            // If template has a renderUI function, call it
            if (typeof window.renderUI === 'function') {
              window.renderUI(renderData);
            }

            // If template has updateUI function, call it
            if (typeof window.updateUI === 'function') {
              window.updateUI(renderData);
            }
          }
        }
      });

      // Notify parent that iframe is ready to receive data
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'ui-lifecycle-iframe-ready' }, '*');
      }

      // Auto-resize: Send height to parent using @mcp-ui/client protocol
      // Uses 'ui-size-change' message type as per mcp-ui documentation
      function sendHeight() {
        if (window.parent && window.parent !== window) {
          var height = Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight
          );
          // Minimum height of 200px, maximum of 600px
          height = Math.max(200, Math.min(height, 600));
          window.parent.postMessage({
            type: 'ui-size-change',
            payload: { height: height }
          }, '*');
        }
      }

      // Use ResizeObserver for accurate height tracking (recommended by mcp-ui)
      if (typeof ResizeObserver !== 'undefined') {
        var resizeObserver = new ResizeObserver(function(entries) {
          entries.forEach(function(entry) {
            var height = Math.max(200, Math.min(entry.contentRect.height, 600));
            window.parent.postMessage({
              type: 'ui-size-change',
              payload: { height: height }
            }, '*');
          });
        });
        resizeObserver.observe(document.documentElement);
      }

      // Fallback: Send height on load
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
          setTimeout(sendHeight, 100);
        });
      } else {
        setTimeout(sendHeight, 100);
      }

      // Also send height after window load (for images, etc.)
      window.addEventListener('load', function() {
        setTimeout(sendHeight, 200);
      });
    })();
  </script>`;

  // Try to inject after <head> tag
  if (html.includes('<head>')) {
    return html.replace('<head>', `<head>\n${dataScript}`);
  }
  // Try to inject after <html> tag
  if (html.includes('<html')) {
    return html.replace(/<html[^>]*>/, `$&\n<head>${dataScript}</head>`);
  }
  // Fallback: prepend to HTML
  return dataScript + html;
}

/**
 * Get weather emoji based on condition
 */
function getWeatherEmoji(condition: string): string {
  const c = (condition || '').toLowerCase();
  if (c.includes('sun') || c.includes('clear')) return '☀️';
  if (c.includes('cloud') || c.includes('overcast')) return '☁️';
  if (c.includes('partly')) return '⛅';
  if (c.includes('rain') || c.includes('shower')) return '🌧️';
  if (c.includes('thunder') || c.includes('storm')) return '⛈️';
  if (c.includes('snow')) return '❄️';
  if (c.includes('fog') || c.includes('mist')) return '🌫️';
  if (c.includes('wind')) return '💨';
  return '🌤️';
}

/**
 * Get all MCP tools from connected servers and convert them to AI SDK format
 * Optimized: Connects to servers in parallel for faster initialization
 */
export async function getMCPTools(): Promise<Record<string, any>> {
  const startTime = Date.now();

  try {
    const config = await configManager.loadConfiguration();
    const allTools: Record<string, any> = {};
    const serverEntries = Object.entries(config.mcpServers);

    if (serverEntries.length === 0) {
      logger.aiSdk.debug("No active MCP servers configured");
      return allTools;
    }

    logger.aiSdk.info("Loading MCP tools (parallel)", {
      serverCount: serverEntries.length,
      serverIds: serverEntries.map(([id]) => id)
    });

    // PHASE 1: Connect all servers in parallel
    const serversToConnect = serverEntries.filter(
      ([serverId]) => !mcpService.isConnected(serverId)
    );

    if (serversToConnect.length > 0) {
      const connectStartTime = Date.now();

      const connectPromises = serversToConnect.map(([serverId, serverConfig]) =>
        mcpService.connectServer({ id: serverId, ...serverConfig })
          .then(() => ({ serverId, success: true }))
          .catch((error) => {
            logger.aiSdk.error("Failed to connect to MCP server", {
              serverId,
              error: error instanceof Error ? error.message : error
            });
            return { serverId, success: false, error };
          })
      );

      const connectResults = await Promise.allSettled(connectPromises);

      const connectedCount = connectResults.filter(
        r => r.status === 'fulfilled' && r.value.success
      ).length;

      logger.aiSdk.info("MCP servers connection phase complete", {
        attempted: serversToConnect.length,
        connected: connectedCount,
        durationMs: Date.now() - connectStartTime
      });
    }

    // PHASE 2: Get tools from all connected servers in parallel
    const toolsStartTime = Date.now();

    const toolsPromises = serverEntries.map(async ([serverId]) => {
      if (!mcpService.isConnected(serverId)) {
        return { serverId, tools: [], success: false };
      }

      try {
        const tools = await mcpService.listTools(serverId);
        return { serverId, tools, success: true };
      } catch (error) {
        logger.aiSdk.error("Failed to list tools from server", {
          serverId,
          error: error instanceof Error ? error.message : error
        });
        return { serverId, tools: [], success: false };
      }
    });

    const toolsResults = await Promise.allSettled(toolsPromises);

    logger.aiSdk.debug("MCP tools fetch phase complete", {
      durationMs: Date.now() - toolsStartTime
    });

    // PHASE 3: Convert tools to AI SDK format
    for (const result of toolsResults) {
      if (result.status !== 'fulfilled' || !result.value.success) continue;

      const { serverId, tools: serverTools } = result.value;

      for (const mcpTool of serverTools) {
        if (!mcpTool.name || mcpTool.name.trim() === "") {
          logger.aiSdk.error("Invalid tool name from server", {
            serverId,
            tool: mcpTool
          });
          continue;
        }

        const toolId = `${serverId}_${mcpTool.name}`;

        if (!toolId || toolId.includes('undefined') || toolId.includes('null')) {
          logger.aiSdk.error("Invalid toolId detected", { toolId, tool: mcpTool });
          continue;
        }

        const aiTool = createAISDKTool(serverId, mcpTool);
        if (!aiTool) {
          logger.aiSdk.error("Failed to create AI SDK tool", { toolId });
          continue;
        }

        allTools[toolId] = aiTool;
      }

      if (serverTools.length > 0) {
        logger.aiSdk.info("Loaded tools from MCP server", {
          toolCount: serverTools.length,
          serverId
        });
      }
    }

    // Log summary
    const disabledCount = Object.keys(config.disabled || {}).length;
    const totalDuration = Date.now() - startTime;

    logger.aiSdk.info("MCP tools loading complete", {
      totalCount: Object.keys(allTools).length,
      activeServers: serverEntries.length,
      disabledServers: disabledCount,
      durationMs: totalDuration,
      toolNames: Object.keys(allTools)
    });

    return allTools;
  } catch (error) {
    logger.aiSdk.error("Error loading MCP tools", {
      error: error instanceof Error ? error.message : error,
      durationMs: Date.now() - startTime
    });
    return {};
  }
}

/**
 * Convert an MCP tool to AI SDK format
 */
function createAISDKTool(serverId: string, mcpTool: Tool) {
  logger.aiSdk.debug("Creating AI SDK tool", { serverId, toolName: mcpTool.name });

  // Validate tool name
  if (!mcpTool.name || mcpTool.name.trim() === "") {
    throw new Error(
      `Invalid tool name for server ${serverId}: ${JSON.stringify(mcpTool)}`
    );
  }

  // Create a schema from MCP tool input schema
  let inputSchema = z.object({});

  try {
    if (mcpTool.inputSchema && mcpTool.inputSchema.properties) {
      const schemaObj: Record<string, any> = {};

      for (const [propName, propDef] of Object.entries(
        mcpTool.inputSchema.properties
      )) {
        const propInfo = propDef as any;

        // Map common schema types to Zod
        switch (propInfo.type) {
          case "string":
            schemaObj[propName] = z
              .string()
              .describe(propInfo.description || "");
            break;
          case "number":
            schemaObj[propName] = z
              .number()
              .describe(propInfo.description || "");
            break;
          case "boolean":
            schemaObj[propName] = z
              .boolean()
              .describe(propInfo.description || "");
            break;
          case "array":
            schemaObj[propName] = z
              .array(z.any())
              .describe(propInfo.description || "");
            break;
          default:
            schemaObj[propName] = z
              .any()
              .describe(propInfo.description || "");
        }

        // Handle required fields
        if (!mcpTool.inputSchema.required?.includes(propName)) {
          schemaObj[propName] = schemaObj[propName].optional();
        }
      }

      inputSchema = z.object(schemaObj);
    }
  } catch (error) {
    logger.aiSdk.warn("Failed to parse schema for tool", {
      toolName: mcpTool.name,
      error
    });
  }

  const aiTool = tool({
    description: mcpTool.description || `Tool from MCP server ${serverId}`,
    inputSchema: inputSchema,
    execute: async (args: any) => {
      try {
        logger.aiSdk.debug("Executing MCP tool", {
          serverId,
          toolName: mcpTool.name,
          args
        });

        const result = await mcpService.callTool(serverId, {
          name: mcpTool.name,
          arguments: args,
        });

        logger.aiSdk.info("[AI-SDK] Raw MCP tool result", {
          toolName: mcpTool.name,
          serverId,
          contentLength: result.content?.length || 0,
          hasMeta: !!result._meta,
          hasWidgetMeta: !!result._meta?.['mcp-use/widget'],
          hasStructuredContent: !!result.structuredContent,
          fullResult: JSON.stringify(result, null, 2)
        });

        // Check for mcp-use widget in _meta
        const widgetMeta = result._meta?.['mcp-use/widget'];
        if (widgetMeta) {
          logger.aiSdk.info("[AI-SDK] Found mcp-use widget in _meta", {
            toolName: mcpTool.name,
            widgetName: widgetMeta.name,
            widgetType: widgetMeta.type,
            hasHtml: !!widgetMeta.html,
            htmlLength: widgetMeta.html?.length || 0,
            hasStructuredContent: !!result.structuredContent,
          });

          // Use HTML from server if available, otherwise generate fallback
          let widgetHtml: string;
          const widgetData = result.structuredContent || args;

          if (widgetMeta.html && typeof widgetMeta.html === 'string') {
            // Server provided the HTML template - inject the data into it
            widgetHtml = injectDataIntoHtml(widgetMeta.html, widgetData);
            logger.aiSdk.info("[AI-SDK] Using server-provided HTML for widget with injected data", {
              widgetName: widgetMeta.name,
              htmlLength: widgetHtml.length,
              dataKeys: Object.keys(widgetData),
            });
          } else {
            // Fallback: generate HTML ourselves
            widgetHtml = generateWidgetHtml(widgetMeta, widgetData);
            logger.aiSdk.info("[AI-SDK] Generated fallback HTML for widget", {
              widgetName: widgetMeta.name,
              htmlLength: widgetHtml.length,
            });
          }

          // Create synthetic UI resource with widget data in _meta
          const uiResource = {
            type: "resource",
            resource: {
              uri: `ui://widget/${widgetMeta.name}.html`,
              mimeType: "text/html",
              text: widgetHtml,
              // Include widget data in _meta for UIResourceRenderer to access
              _meta: {
                widgetName: widgetMeta.name,
                widgetType: widgetMeta.type,
                widgetData: widgetData,
                props: widgetData, // Also as 'props' for compatibility
              }
            }
          };

          // Record successful tool call
          mcpHealthService.recordSuccess(serverId, mcpTool.name);

          const structuredResult = {
            text: `[UI Widget: ${widgetMeta.name}]`,
            content: result.content,
            uiResources: [uiResource],
            _meta: result._meta,
            structuredContent: result.structuredContent,
          };

          logger.aiSdk.info("[AI-SDK] Returning mcp-use widget result", {
            toolName: mcpTool.name,
            widgetName: widgetMeta.name,
            htmlLength: widgetHtml.length,
            usedServerHtml: !!widgetMeta.html,
          });

          return structuredResult;
        }

        // Process MCP result - preserve UI resources for rendering
        if (result.content && Array.isArray(result.content)) {
          const textParts: string[] = [];
          const uiResources: any[] = [];

          for (const item of result.content) {
            logger.aiSdk.debug("[AI-SDK] Processing content item", {
              itemType: item.type,
              hasText: !!item.text,
              hasResource: !!item.resource,
              hasData: !!item.data,
              fullItem: JSON.stringify(item, null, 2)
            });

            if (item.type === "text") {
              textParts.push(item.text || "");
            } else if (item.type === "resource") {
              // Check if this is a UI resource (uri starts with ui://)
              let resourceData = item.resource || item.data || item;
              const uri = resourceData?.uri || "";

              logger.aiSdk.info("[AI-SDK] Found resource in tool result", {
                uri,
                isUIResource: uri.startsWith("ui://"),
                mimeType: resourceData?.mimeType,
                hasText: !!resourceData?.text,
                hasBlob: !!resourceData?.blob,
                textLength: resourceData?.text?.length || 0,
                resourceKeys: Object.keys(resourceData || {})
              });

              if (uri.startsWith("ui://")) {
                // If UI resource has no content, fetch it via readResource
                if (!resourceData?.text && !resourceData?.blob) {
                  logger.aiSdk.info("[AI-SDK] UI resource has no content, fetching via readResource", {
                    serverId,
                    uri
                  });

                  try {
                    const resourceContent = await mcpService.readResource(serverId, uri);
                    logger.aiSdk.info("[AI-SDK] Fetched UI resource content", {
                      uri,
                      contentsCount: resourceContent?.contents?.length || 0,
                      firstContentMimeType: resourceContent?.contents?.[0]?.mimeType,
                      firstContentHasText: !!resourceContent?.contents?.[0]?.text,
                      firstContentTextLength: resourceContent?.contents?.[0]?.text?.length || 0
                    });

                    // Merge fetched content into resourceData
                    if (resourceContent?.contents?.[0]) {
                      const fetchedContent = resourceContent.contents[0];
                      resourceData = {
                        ...resourceData,
                        uri: fetchedContent.uri || uri,
                        mimeType: fetchedContent.mimeType || resourceData?.mimeType,
                        text: fetchedContent.text,
                        blob: fetchedContent.blob,
                      };
                    }
                  } catch (fetchError) {
                    logger.aiSdk.error("[AI-SDK] Failed to fetch UI resource content", {
                      serverId,
                      uri,
                      error: fetchError instanceof Error ? fetchError.message : fetchError
                    });
                  }
                }

                // Preserve UI resource structure for rendering
                uiResources.push({
                  type: "resource",
                  resource: resourceData
                });
                // Also add text description for the model
                textParts.push(`[UI Widget: ${uri}]`);
              } else {
                // Regular resource - stringify for model
                textParts.push(`[Resource: ${JSON.stringify(resourceData)}]`);
              }
            } else {
              // Other types - stringify
              logger.aiSdk.debug("[AI-SDK] Other content type", { type: item.type });
              textParts.push(`[${item.type}: ${JSON.stringify(item.data || item)}]`);
            }
          }

          // Record successful tool call
          mcpHealthService.recordSuccess(serverId, mcpTool.name);

          // Return structured result with both text and UI resources
          // AI SDK v5 supports structured outputs
          if (uiResources.length > 0) {
            const structuredResult = {
              text: textParts.join("\n"),
              content: result.content,  // Preserve original content
              uiResources: uiResources  // Extracted UI resources
            };

            logger.aiSdk.info("[AI-SDK] Returning structured result with UI resources", {
              toolName: mcpTool.name,
              uiResourceCount: uiResources.length,
              textPartsCount: textParts.length,
              uiResourceUris: uiResources.map(r => r.resource?.uri),
              firstResourceHasText: !!uiResources[0]?.resource?.text,
              firstResourceHasBlob: !!uiResources[0]?.resource?.blob,
              structuredResultKeys: Object.keys(structuredResult)
            });

            return structuredResult;
          }

          // No UI resources - return text only
          const resultText = textParts.join("\n");
          logger.aiSdk.debug("Converted result text", { resultText });
          return resultText;
        }

        // For non-content results, return as-is (structured)
        logger.aiSdk.debug("Returning structured result", { result });

        // Record successful tool call
        mcpHealthService.recordSuccess(serverId, mcpTool.name);

        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Tool execution failed";

        logger.aiSdk.error("Error executing MCP tool", {
          serverId,
          toolName: mcpTool.name,
          error
        });

        // Record failed tool call
        mcpHealthService.recordError(serverId, mcpTool.name, errorMessage);

        // For tool execution errors, we should throw to let the AI SDK handle it
        // This will trigger the 'tool-error' event in the stream
        throw new Error(errorMessage);
      }
    },
  });

  logger.aiSdk.debug("Successfully created AI SDK tool", {
    serverId,
    toolName: mcpTool.name
  });

  return aiTool;
}
