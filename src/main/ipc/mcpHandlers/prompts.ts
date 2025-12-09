import { ipcMain } from "electron";
import type { IMCPService } from "../../services/mcp/IMCPService.js";
import { getLogger } from "../../services/logging";

const logger = getLogger();

/**
 * Register IPC handlers for MCP prompt operations.
 */
export function registerPromptHandlers(mcpService: IMCPService) {
  // List prompts from a server
  ipcMain.handle(
    "levante/mcp/list-prompts",
    async (_, serverId: string) => {
      try {
        const prompts = await mcpService.listPrompts(serverId);
        return { success: true, data: prompts };
      } catch (error) {
        logger.mcp.error("IPC: Failed to list prompts", {
          serverId,
          error: error instanceof Error ? error.message : error,
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to list prompts",
        };
      }
    }
  );

  // Get a prompt with arguments
  ipcMain.handle(
    "levante/mcp/get-prompt",
    async (_, serverId: string, name: string, args?: Record<string, any>) => {
      try {
        const result = await mcpService.getPrompt(serverId, name, args);
        return { success: true, data: result };
      } catch (error) {
        logger.mcp.error("IPC: Failed to get prompt", {
          serverId,
          name,
          error: error instanceof Error ? error.message : error,
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to get prompt",
        };
      }
    }
  );

  logger.mcp.debug("MCP prompt IPC handlers registered");
}
