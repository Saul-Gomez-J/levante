import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  MCPServerConfig,
  Tool,
  ToolCall,
  ToolResult,
} from "../../types/mcp.js";
import { getLogger } from "../logging";
import { createTransport, handleConnectionError } from "./transports.js";
import { diagnoseSystem } from "./diagnostics.js";
import { loadMCPRegistry } from "./registry.js";
import type { MCPRegistry } from "./types";
import { RuntimeManager } from "../runtime/runtimeManager";
import { PreferencesService } from "../preferencesService";
import { DEFAULT_NODE_VERSION, DEFAULT_PYTHON_VERSION } from '../runtime/constants';
import * as path from 'path';

export class MCPService {
  private logger = getLogger();
  private clients: Map<string, Client> = new Map();
  private runtimeManager = new RuntimeManager();
  private preferencesService = new PreferencesService();

  async connectServer(config: MCPServerConfig): Promise<Client> {
    // Auto-detect runtime based on command if not specified
    if (!config.runtime && config.command) {
      const command = config.command.toLowerCase();

      if (command === 'npx' || command === 'node') {
        config.runtime = {
          type: 'node',
          version: DEFAULT_NODE_VERSION
        };
        this.logger.mcp.info("Auto-detected Node.js runtime for server", {
          serverId: config.id,
          command: config.command
        });
      } else if (command === 'uvx' || command === 'python' || command === 'python3') {
        config.runtime = {
          type: 'python',
          version: DEFAULT_PYTHON_VERSION
        };
        this.logger.mcp.info("Auto-detected Python runtime for server", {
          serverId: config.id,
          command: config.command
        });
      }
    }

    // Ensure runtime if specified
    if (config.runtime) {
      // Load user preferences for runtime resolution
      await this.preferencesService.initialize();
      const runtimePrefs = await this.preferencesService.get('runtime');
      const preferSystemRuntimes = runtimePrefs?.preferSystemRuntimes ?? false;

      // NEW: Read developerMode global setting
      const developerMode = (await this.preferencesService.get('developerMode')) ?? false;

      try {

        this.logger.mcp.info("Ensuring runtime for server", {
          serverId: config.id,
          runtime: config.runtime,
          preferSystemRuntimes,
          developerMode
        });

        const runtimeExecutable = await this.runtimeManager.ensureRuntime(
          config.runtime,
          preferSystemRuntimes,
          developerMode
        );

        // Register runtime usage if it's a Levante runtime (not system)
        const levanteRuntimesPath = this.runtimeManager.getRuntimesPath();
        if (runtimeExecutable.includes(levanteRuntimesPath)) {
          // Skip registration for temporary test servers
          if (!config.id.startsWith('test-')) {
            const runtimeKey = `${config.runtime.type}-${config.runtime.version}`;
            await this.runtimeManager.registerServerUsage(config.id, runtimeKey);
            this.logger.mcp.info("Registered runtime usage", { serverId: config.id, runtimeKey });
          } else {
            this.logger.mcp.debug("Skipping runtime registration for test server", { serverId: config.id });
          }
        } else {
          this.logger.mcp.info("Using system runtime (not tracked)", { serverId: config.id, path: runtimeExecutable });
        }

        // Update config with absolute path to runtime
        // We create a shallow copy to avoid mutating the persistent config object in memory if it's shared
        config = { ...config };

        const command = config.command || '';
        const isRunner = ['node', 'python', 'python3'].includes(command);

        if (isRunner) {
          config.command = runtimeExecutable;
        } else if (command === 'npx') {
          // Attempt to find npx relative to node
          const binDir = path.dirname(runtimeExecutable);
          config.command = path.join(binDir, process.platform === 'win32' ? 'npx.cmd' : 'npx');
        } else {
          // Assume command is the script, prepend runtime
          config.args = [command, ...(config.args || [])];
          config.command = runtimeExecutable;
        }

        this.logger.mcp.info("Runtime resolved", { serverId: config.id, command: config.command });
      } catch (error) {
        // Handle runtime resolution errors based on mode
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage === 'RUNTIME_CHOICE_REQUIRED') {
          // Advanced Mode: System runtime exists but user prefers Levante
          // UI should show dialog: "Download Levante runtime or use System?"
          this.logger.mcp.info("Runtime choice required", {
            serverId: config.id,
            systemPath: (error as any).systemPath,
            runtimeType: (error as any).runtimeType,
            mode: 'advanced'
          });
        } else if (errorMessage === 'RUNTIME_NOT_FOUND') {
          // Advanced Mode: No runtime found, UI should show install confirmation
          this.logger.mcp.info("Runtime not found, prompting user", {
            serverId: config.id,
            runtime: config.runtime,
            mode: 'advanced'
          });
        } else {
          // Other errors (network, permissions, etc.)
          this.logger.mcp.error("Failed to ensure runtime", {
            serverId: config.id,
            error: errorMessage,
            mode: developerMode ? 'advanced' : 'simple'
          });
        }

        throw error;
      }
    }

    const transportType = config.transport || (config as any).type;
    const baseUrl = config.baseUrl || (config as any).url;

    try {
      const { client, transport } = await createTransport(config);

      // Connect to the server with detailed error handling
      this.logger.mcp.info("Attempting to connect to server", {
        serverId: config.id,
      });

      try {
        await client.connect(transport);
        this.logger.mcp.info("Successfully connected to server", {
          serverId: config.id,
        });
      } catch (connectionError) {
        this.logger.mcp.error("Connection failed for server", {
          serverId: config.id,
          error:
            connectionError instanceof Error
              ? connectionError.message
              : connectionError,
        });

        // Provide more specific error messages
        if (connectionError instanceof Error) {
          throw await handleConnectionError(
            connectionError,
            config,
            transportType,
            baseUrl
          );
        }

        throw connectionError;
      }

      // Store the client
      this.clients.set(config.id, client);

      this.logger.mcp.info("Successfully connected to MCP server", {
        serverId: config.id,
      });
      return client;
    } catch (error) {
      this.logger.mcp.error("Failed to connect to MCP server", {
        serverId: config.id,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  async listTools(serverId: string): Promise<Tool[]> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(
        `Client ${serverId} not found. Make sure to connect first.`
      );
    }

    try {
      const response = await client.listTools();
      return response.tools.map((tool) => ({
        name: tool.name,
        description: tool.description || "",
        inputSchema: tool.inputSchema,
      }));
    } catch (error) {
      this.logger.mcp.error("Failed to list tools from server", {
        serverId,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  async callTool(serverId: string, toolCall: ToolCall): Promise<ToolResult> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(
        `Client ${serverId} not found. Make sure to connect first.`
      );
    }

    try {
      const response = await client.callTool({
        name: toolCall.name,
        arguments: toolCall.arguments,
      });

      return {
        content: Array.isArray(response.content) ? response.content : [],
        isError: Boolean(response.isError),
      };
    } catch (error) {
      this.logger.mcp.error("Failed to call tool on server", {
        serverId,
        toolName: toolCall.name,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  async disconnectServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (client) {
      try {
        await client.close();
        this.clients.delete(serverId);
        this.logger.mcp.info("Successfully disconnected from MCP server", {
          serverId,
        });
      } catch (error) {
        this.logger.mcp.error("Error disconnecting from server", {
          serverId,
          error: error instanceof Error ? error.message : error,
        });
        // Still remove from clients map even if disconnect failed
        this.clients.delete(serverId);
      }
    }
  }

  isConnected(serverId: string): boolean {
    return this.clients.has(serverId);
  }

  getConnectedServers(): string[] {
    return Array.from(this.clients.keys());
  }

  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.clients.keys()).map(
      (serverId) => this.disconnectServer(serverId)
    );

    await Promise.allSettled(disconnectPromises);
  }

  // Ping method for health checks (Phase 5)
  async ping(serverId: string): Promise<boolean> {
    const client = this.clients.get(serverId);
    if (!client) {
      return false;
    }

    try {
      // Try to list tools as a way to ping the server
      await client.listTools();
      return true;
    } catch (error) {
      return false;
    }
  }

  // Reconnect method for health checks (Phase 5)
  async reconnectServer(serverId: string): Promise<void> {
    // Implementation will depend on stored config
    this.logger.mcp.info("Reconnecting to server", { serverId });
    // This will be implemented in Phase 5 with config persistence
  }

  // Get MCP registry information
  async getRegistry(): Promise<MCPRegistry> {
    return await loadMCPRegistry();
  }

  // Validate if a package is known and active
  async validatePackage(
    packageName: string
  ): Promise<{
    valid: boolean;
    status: string;
    message: string;
    alternative?: string;
  }> {
    try {
      const registry = await loadMCPRegistry();

      // Check if it's deprecated
      const deprecatedEntry = registry.deprecated.find(
        (entry) => entry.npmPackage === packageName
      );
      if (deprecatedEntry) {
        return {
          valid: false,
          status: "deprecated",
          message: deprecatedEntry.reason,
          alternative: deprecatedEntry.alternative,
        };
      }

      // Check if it's active
      const activeEntry = registry.entries.find(
        (entry) => entry.npmPackage === packageName && entry.status === "active"
      );
      if (activeEntry) {
        return {
          valid: true,
          status: "active",
          message: `Package ${packageName} is available (v${activeEntry.version || "latest"
            })`,
        };
      }

      // Unknown package
      const availablePackages = registry.entries
        .filter((entry) => entry.status === "active")
        .map((entry) => entry.npmPackage)
        .join(", ");

      return {
        valid: false,
        status: "unknown",
        message: `Unknown package. Available packages: ${availablePackages}`,
      };
    } catch (error) {
      return {
        valid: false,
        status: "error",
        message: "Unable to validate package due to registry loading error",
      };
    }
  }

  // Diagnose system for MCP compatibility
  async diagnoseSystem(): Promise<{
    success: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    return await diagnoseSystem();
  }
}
