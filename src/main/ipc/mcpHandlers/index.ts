import {
  MCPServiceFactory,
  type IMCPService,
} from "../../services/mcpService.js";
import { MCPConfigurationManager } from "../../services/mcpConfigManager.js";
import { preferencesService } from "../../services/preferencesService.js";
import { getLogger } from "../../services/logging";
import { registerConnectionHandlers } from "./connection.js";
import { registerConfigurationHandlers } from "./configuration.js";
import { registerToolHandlers } from "./tools.js";
import { registerResourceHandlers } from "./resources.js";
import { registerPromptHandlers } from "./prompts.js";
import { registerHealthHandlers } from "./health.js";
import { registerExtractionHandlers } from "./extraction.js";
import { registerRegistryHandlers } from "./registry.js";
import { registerProviderHandlers } from "./providers.js";
import { registerRuntimeHandlers } from "./runtime.js";
import { getOAuthService } from "../../services/oauth";

// Create singleton instances
let mcpService: IMCPService;
const configManager = new MCPConfigurationManager();
const logger = getLogger();

export async function registerMCPHandlers() {
  try {
    // Create MCP service based on user preferences
    const uiPreferences = preferencesService.getAll();
    mcpService = await MCPServiceFactory.createFromUIPreferences(uiPreferences);

    logger.mcp.info("MCP service created via factory", {
      sdk: uiPreferences.mcp?.sdk || "mcp-use",
    });

    // Register all handler categories
    registerConnectionHandlers(mcpService, configManager);
    const oauthService = getOAuthService();
    registerConfigurationHandlers(mcpService, configManager, oauthService);
    registerToolHandlers(mcpService);
    registerResourceHandlers(mcpService);
    registerPromptHandlers(mcpService);
    registerHealthHandlers();
    registerExtractionHandlers(mcpService);
    registerRegistryHandlers(mcpService, configManager, oauthService);
    registerProviderHandlers();
    registerRuntimeHandlers();

    logger.mcp.info("MCP IPC handlers registered successfully");
  } catch (error) {
    logger.mcp.error("Failed to register MCP handlers", {
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}

// Export the service instances for use in other parts of the main process
export { mcpService, configManager };
