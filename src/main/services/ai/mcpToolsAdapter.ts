/**
 * MCP Tools Adapter
 *
 * Converts MCP (Model Context Protocol) tools to AI SDK format.
 * Handles schema sanitization for provider compatibility and widget rendering.
 */

import { tool, jsonSchema } from "ai";
import { mcpService, configManager } from "../../ipc/mcpHandlers";
import { mcpHealthService } from "../mcpHealthService";
import type { Tool } from "../../types/mcp";
import { getLogger } from '../logging';

// Import from new modules
import { sanitizeSchema } from './schemaSanitizer';
import {
  generateWidgetHtml,
  injectDataIntoHtml,
  injectSkybridgeBridge,
} from './widgets';

const logger = getLogger();

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

  // Sanitize MCP JSON Schema for provider compatibility
  // Uses the strictest sanitization (Gemini) by default for maximum compatibility
  let inputSchema: ReturnType<typeof jsonSchema>;

  try {
    if (mcpTool.inputSchema) {
      // Sanitize schema: fix objects without properties, arrays without items,
      // and filter invalid required references
      const sanitizedSchema = sanitizeSchema(mcpTool.inputSchema, undefined, mcpTool.name);

      logger.aiSdk.debug("Sanitized MCP schema", {
        toolName: mcpTool.name,
        serverId,
        originalType: mcpTool.inputSchema.type,
        sanitizedType: sanitizedSchema.type,
        hasProperties: !!sanitizedSchema.properties
      });

      inputSchema = jsonSchema(sanitizedSchema);
    } else {
      // Fallback to empty object schema
      inputSchema = jsonSchema({ type: "object", properties: {} });
    }
  } catch (error) {
    logger.aiSdk.warn("Failed to sanitize schema for tool, using fallback", {
      toolName: mcpTool.name,
      error
    });
    inputSchema = jsonSchema({ type: "object", properties: {} });
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

        logger.aiSdk.debug("[AI-SDK] Raw MCP tool result", {
          toolName: mcpTool.name,
          serverId,
          contentLength: result.content?.length || 0,
          hasMeta: !!result._meta,
          hasWidgetMeta: !!result._meta?.['mcp-use/widget'],
          hasStructuredContent: !!result.structuredContent,
        });

        // Check for mcp-use widget in _meta
        const widgetMeta = result._meta?.['mcp-use/widget'];
        // Check for Skybridge/OpenAI widget format - can be in tool definition or result
        const openaiOutputTemplate = result._meta?.['openai/outputTemplate'] ||
                                      mcpTool._meta?.['openai/outputTemplate'];

        if (widgetMeta) {
          return handleMcpUseWidget(serverId, mcpTool, args, result, widgetMeta);
        } else if (openaiOutputTemplate && typeof openaiOutputTemplate === 'string' && openaiOutputTemplate.startsWith('ui://')) {
          const skybridgeResult = await handleSkybridgeWidget(serverId, mcpTool, args, result, openaiOutputTemplate);
          if (skybridgeResult) return skybridgeResult;
          // Fall through to normal processing if Skybridge handling fails
        }

        // Process MCP result - preserve UI resources for rendering
        return processToolResult(serverId, mcpTool, result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Tool execution failed";

        logger.aiSdk.error("Error executing MCP tool", {
          serverId,
          toolName: mcpTool.name,
          error
        });

        // Record failed tool call
        mcpHealthService.recordError(serverId, mcpTool.name, errorMessage);

        // For tool execution errors, throw to let the AI SDK handle it
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

/**
 * Handle mcp-use widget results
 */
function handleMcpUseWidget(
  serverId: string,
  mcpTool: Tool,
  args: any,
  result: any,
  widgetMeta: any
) {
  logger.aiSdk.info("[AI-SDK] Found mcp-use widget in _meta", {
    toolName: mcpTool.name,
    widgetName: widgetMeta.name,
    widgetType: widgetMeta.type,
    hasHtml: !!widgetMeta.html,
  });

  // Use HTML from server if available, otherwise generate fallback
  let widgetHtml: string;
  const widgetData = result.structuredContent || args;

  if (widgetMeta.html && typeof widgetMeta.html === 'string') {
    // Server provided the HTML template - inject the data into it
    widgetHtml = injectDataIntoHtml(widgetMeta.html, widgetData);
  } else {
    // Fallback: generate HTML ourselves
    widgetHtml = generateWidgetHtml(widgetMeta, widgetData);
  }

  // Create synthetic UI resource with widget data in _meta
  const uiResource = {
    type: "resource",
    resource: {
      uri: `ui://widget/${widgetMeta.name}.html`,
      mimeType: "text/html",
      text: widgetHtml,
      _meta: {
        widgetName: widgetMeta.name,
        widgetType: widgetMeta.type,
        widgetData: widgetData,
        props: widgetData,
      }
    }
  };

  // Record successful tool call
  mcpHealthService.recordSuccess(serverId, mcpTool.name);

  return {
    text: `[UI Widget: ${widgetMeta.name}]`,
    content: result.content,
    uiResources: [uiResource],
    _meta: result._meta,
    structuredContent: result.structuredContent,
  };
}

/**
 * Handle Skybridge/OpenAI widget results
 */
async function handleSkybridgeWidget(
  serverId: string,
  mcpTool: Tool,
  args: any,
  result: any,
  openaiOutputTemplate: string
): Promise<any | null> {
  logger.aiSdk.info("[AI-SDK] Found openai/outputTemplate widget", {
    toolName: mcpTool.name,
    templateUri: openaiOutputTemplate,
  });

  try {
    // Fetch widget HTML from the UI resource
    const resourceContent = await mcpService.readResource(serverId, openaiOutputTemplate);

    if (resourceContent?.contents?.[0]?.text) {
      let widgetHtml = resourceContent.contents[0].text;

      // Extract widget data from result._meta (excluding the outputTemplate key)
      const widgetData: Record<string, any> = {};
      if (result._meta) {
        for (const [key, value] of Object.entries(result._meta)) {
          if (key !== 'openai/outputTemplate' && !key.startsWith('openai/')) {
            widgetData[key] = value;
          }
        }
      }

      // Also include structuredContent if available
      if (result.structuredContent) {
        Object.assign(widgetData, result.structuredContent);
      }

      // Inject Skybridge/OpenAI bridge into widget HTML
      widgetHtml = injectSkybridgeBridge(widgetHtml, {
        toolInput: args,
        toolOutput: result.structuredContent || widgetData,
        responseMetadata: widgetData,
        locale: 'en-US',
      });

      // Normalize mimeType
      let mimeType = resourceContent.contents[0].mimeType || "text/html";
      if (mimeType.startsWith('text/html+')) {
        mimeType = 'text/html';
      }

      // Create UI resource with Skybridge widget
      const uiResource = {
        type: "resource",
        resource: {
          uri: openaiOutputTemplate,
          mimeType: mimeType,
          text: widgetHtml,
          _meta: {
            widgetData: widgetData,
            props: widgetData,
            isSkybridge: true,
          }
        }
      };

      mcpHealthService.recordSuccess(serverId, mcpTool.name);

      return {
        text: `[UI Widget from ${openaiOutputTemplate}]`,
        content: result.content,
        uiResources: [uiResource],
        _meta: result._meta,
        structuredContent: result.structuredContent,
      };
    }
  } catch (error) {
    logger.aiSdk.error("[AI-SDK] Failed to fetch Skybridge widget", {
      toolName: mcpTool.name,
      templateUri: openaiOutputTemplate,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return null;
}

/**
 * Process standard MCP tool results
 */
async function processToolResult(
  serverId: string,
  mcpTool: Tool,
  result: any
) {
  if (result.content && Array.isArray(result.content)) {
    const textParts: string[] = [];
    const uiResources: any[] = [];

    for (const item of result.content) {
      if (item.type === "text") {
        textParts.push(item.text || "");
      } else if (item.type === "resource") {
        // Check if this is a UI resource (uri starts with ui://)
        let resourceData = item.resource || item.data || item;
        const uri = resourceData?.uri || "";

        if (uri.startsWith("ui://")) {
          // If UI resource has no content, fetch it via readResource
          if (!resourceData?.text && !resourceData?.blob) {
            try {
              const resourceContent = await mcpService.readResource(serverId, uri);
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
          textParts.push(`[UI Widget: ${uri}]`);
        } else {
          // Regular resource - stringify for model
          textParts.push(`[Resource: ${JSON.stringify(resourceData)}]`);
        }
      } else {
        // Other types - stringify
        textParts.push(`[${item.type}: ${JSON.stringify(item.data || item)}]`);
      }
    }

    // Record successful tool call
    mcpHealthService.recordSuccess(serverId, mcpTool.name);

    // Return structured result with both text and UI resources
    if (uiResources.length > 0) {
      return {
        text: textParts.join("\n"),
        content: result.content,
        uiResources: uiResources
      };
    }

    // No UI resources - return text only
    return textParts.join("\n");
  }

  // For non-content results, return as-is
  mcpHealthService.recordSuccess(serverId, mcpTool.name);
  return result;
}
