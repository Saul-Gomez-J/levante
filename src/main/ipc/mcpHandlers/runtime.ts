import { ipcMain } from "electron";
import { RuntimeManager } from "../../services/runtime/runtimeManager";
import { getLogger } from "../../services/logging";

const logger = getLogger();
const runtimeManager = new RuntimeManager();

export function registerRuntimeHandlers() {
    ipcMain.handle("levante/mcp/get-runtimes", async () => {
        try {
            const data = await runtimeManager.getInstalledRuntimes();
            return { success: true, data };
        } catch (error: any) {
            logger.mcp.error("Failed to get runtimes", { error });
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle("levante/mcp/cleanup-runtimes", async () => {
        try {
            await runtimeManager.cleanupUnusedRuntimes();
            return { success: true };
        } catch (error: any) {
            logger.mcp.error("Failed to cleanup runtimes", { error });
            return { success: false, error: error.message };
        }
    });

    // For testing purposes
    ipcMain.handle("levante/mcp/install-runtime", async (_, { type, version }) => {
        try {
            const data = await runtimeManager.installRuntime(type, version);
            return { success: true, data };
        } catch (error: any) {
            logger.mcp.error("Failed to install runtime", { error });
            return { success: false, error: error.message };
        }
    });
}
