import type { IMCPService } from "./IMCPService.js";
import { MCPUseService } from "./mcpUseService.js";
import { MCPLegacyService } from "./mcpLegacyService.js";
import type { MCPPreferences } from "../../../types/preferences.js";
import { DEFAULT_MCP_PREFERENCES } from "../../../types/preferences.js";
import { getLogger } from "../logging";

/**
 * Factory for creating MCP service instances based on user preferences.
 *
 * This factory implements the strategy pattern, allowing runtime selection
 * between mcp-use (default) and official SDK implementations.
 */
export class MCPServiceFactory {
  private static logger = getLogger();

  /**
   * Create an MCP service instance based on preferences.
   *
   * @param preferences - MCP preferences (SDK selection and code mode config)
   * @returns Configured MCP service instance
   */
  static async create(preferences?: MCPPreferences): Promise<IMCPService> {
    // Use defaults if no preferences provided
    const mcpPrefs = preferences || DEFAULT_MCP_PREFERENCES;

    this.logger.mcp.info("Creating MCP service", {
      sdk: mcpPrefs.sdk,
      codeModeEnabled: mcpPrefs.codeModeDefaults?.enabled,
      executor: mcpPrefs.codeModeDefaults?.executor,
    });

    let service: IMCPService;

    // Select implementation based on SDK preference
    if (mcpPrefs.sdk === 'official-sdk') {
      this.logger.mcp.info("Using Official MCP SDK (@modelcontextprotocol/sdk)");
      service = new MCPLegacyService();
    } else {
      // Default to mcp-use
      this.logger.mcp.info("Using mcp-use framework (default)", {
        codeMode: mcpPrefs.codeModeDefaults?.enabled ?? true,
      });
      service = new MCPUseService(mcpPrefs);
    }

    // Initialize the service (configures loggers, etc.)
    await service.initialize();

    return service;
  }

  /**
   * Create service from UI preferences object.
   * This is a convenience method for use with PreferencesService.
   *
   * @param uiPreferences - Full UI preferences object
   * @returns Configured MCP service instance
   */
  static async createFromUIPreferences(uiPreferences: any): Promise<IMCPService> {
    const mcpPrefs = uiPreferences?.mcp || DEFAULT_MCP_PREFERENCES;
    return this.create(mcpPrefs);
  }
}
