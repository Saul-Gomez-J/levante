import { ipcMain } from "electron";
import type { IMCPService } from "../../services/mcp/IMCPService.js";

export function registerResourceHandlers(mcpService: IMCPService) {
  // List resources from a specific server
  ipcMain.handle("levante/mcp/list-resources", async (_, serverId: string) => {
    try {
      const resources = await mcpService.listResources(serverId);
      return { success: true, data: resources };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Read a specific resource
  ipcMain.handle(
    "levante/mcp/read-resource",
    async (_, serverId: string, uri: string) => {
      try {
        const content = await mcpService.readResource(serverId, uri);
        return { success: true, data: content };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    }
  );
}
