import type { MCPServerConfig } from "../../types/mcp.js";
import type { Logger } from "../logging";
import { RuntimeManager } from "./runtimeManager.js";
import { PreferencesService } from "../preferencesService.js";
import { DEFAULT_NODE_VERSION, DEFAULT_PYTHON_VERSION } from './constants.js';
import * as path from 'path';

/**
 * Service responsible for resolving runtimes for MCP servers.
 *
 * This service encapsulates all runtime-related logic including:
 * - Auto-detection of runtime requirements based on command
 * - Runtime installation and resolution via RuntimeManager
 * - User preference handling (developer mode, system vs Levante)
 * - Config modification with resolved runtime paths
 *
 * Can be used by any IMCPService implementation (MCPUseService, MCPLegacyService, etc.)
 */
export class RuntimeResolver {
  constructor(
    private runtimeManager: RuntimeManager,
    private preferencesService: PreferencesService,
    private logger: Logger
  ) {}

  /**
   * Resolves runtime for a server config and returns modified config.
   *
   * This method:
   * 1. Auto-detects runtime if not specified (uvx → python, npx → node)
   * 2. Loads user preferences (developerMode, preferSystemRuntimes)
   * 3. Ensures runtime is available via RuntimeManager
   * 4. Registers runtime usage if using Levante runtime
   * 5. Modifies config.command with resolved runtime path
   *
   * @param config - Original server configuration
   * @returns Modified config with resolved runtime paths
   * @throws Error with 'RUNTIME_CHOICE_REQUIRED' or 'RUNTIME_NOT_FOUND' in developer mode
   * @throws Error if runtime installation fails
   */
  async resolve(config: MCPServerConfig): Promise<MCPServerConfig> {
    // Special case: uv/uvx commands need uv installed, not Python runtime
    // uv manages its own isolated Python environments internally
    const command = config.command?.toLowerCase();
    if (command === 'uvx' || command === 'uv') {
      return this.resolveUv(config, command);
    }

    // Auto-detect runtime based on command if not specified
    const configWithRuntime = this.autoDetectRuntime(config);

    // If no runtime needed, return original config
    if (!configWithRuntime.runtime) {
      return configWithRuntime;
    }

    // Load user preferences for runtime resolution
    await this.preferencesService.initialize();
    const runtimePrefs = await this.preferencesService.get('runtime');
    const preferSystemRuntimes = runtimePrefs?.preferSystemRuntimes ?? false;
    const developerMode = (await this.preferencesService.get('developerMode')) ?? false;

    try {
      this.logger.mcp.info("Ensuring runtime for server", {
        serverId: configWithRuntime.id,
        runtime: configWithRuntime.runtime,
        preferSystemRuntimes,
        developerMode
      });

      // Ensure runtime is available
      const runtimeExecutable = await this.runtimeManager.ensureRuntime(
        configWithRuntime.runtime,
        preferSystemRuntimes,
        developerMode
      );

      // Register runtime usage if it's a Levante runtime (not system)
      await this.registerRuntimeUsage(configWithRuntime, runtimeExecutable);

      // Update config with absolute path to runtime
      const modifiedConfig = this.updateConfigWithRuntime(
        configWithRuntime,
        runtimeExecutable
      );

      this.logger.mcp.info("Runtime resolved successfully", {
        serverId: modifiedConfig.id,
        command: modifiedConfig.command
      });

      return modifiedConfig;
    } catch (error) {
      // Handle runtime resolution errors
      this.handleRuntimeError(error, configWithRuntime, developerMode);
      throw error; // Re-throw for upstream handling
    }
  }

  /**
   * Resolves uv/uvx command by ensuring uv is installed.
   * uv manages its own isolated Python environments - no need for Levante Python runtime.
   *
   * @param config - Server configuration with uv or uvx command
   * @param command - The command ('uv' or 'uvx')
   * @returns Modified config with uv/uvx path resolved
   */
  private async resolveUv(config: MCPServerConfig, command: string): Promise<MCPServerConfig> {
    try {
      this.logger.mcp.info(`Resolving ${command} for server`, {
        serverId: config.id
      });

      // Ensure uv is available (will install if needed)
      // ensureUvx installs uv which includes both uv and uvx binaries
      const uvxPath = await this.runtimeManager.ensureUvx();

      // Get the correct binary path (uv or uvx)
      const binPath = command === 'uv'
        ? uvxPath.replace(/uvx(\.exe)?$/, process.platform === 'win32' ? 'uv.exe' : 'uv')
        : uvxPath;

      // Create modified config with resolved path
      const modifiedConfig = { ...config };
      modifiedConfig.command = binPath;

      this.logger.mcp.info(`${command} resolved successfully`, {
        serverId: config.id,
        command: binPath
      });

      return modifiedConfig;
    } catch (error) {
      this.logger.mcp.error(`Failed to resolve ${command}`, {
        serverId: config.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Auto-detects runtime requirements based on command.
   *
   * @param config - Server configuration
   * @returns Config with runtime auto-detected if applicable
   */
  private autoDetectRuntime(config: MCPServerConfig): MCPServerConfig {
    // If runtime already specified, return as-is
    if (config.runtime) {
      return config;
    }

    // No command = no runtime detection
    if (!config.command) {
      return config;
    }

    const command = config.command.toLowerCase();
    const configCopy = { ...config };

    // Detect Node.js commands
    if (command === 'npx' || command === 'node') {
      configCopy.runtime = {
        type: 'node',
        version: DEFAULT_NODE_VERSION
      };
      this.logger.mcp.info("Auto-detected Node.js runtime for server", {
        serverId: config.id,
        command: config.command
      });
    }
    // Detect Python commands (uvx is handled separately in resolve())
    else if (command === 'python' || command === 'python3') {
      configCopy.runtime = {
        type: 'python',
        version: DEFAULT_PYTHON_VERSION
      };
      this.logger.mcp.info("Auto-detected Python runtime for server", {
        serverId: config.id,
        command: config.command
      });
    }

    return configCopy;
  }

  /**
   * Registers runtime usage if using a Levante-managed runtime.
   *
   * @param config - Server configuration
   * @param runtimeExecutable - Path to resolved runtime executable
   */
  private async registerRuntimeUsage(
    config: MCPServerConfig,
    runtimeExecutable: string
  ): Promise<void> {
    if (!config.runtime) {
      return;
    }

    const levanteRuntimesPath = this.runtimeManager.getRuntimesPath();

    // Only register if using Levante runtime (path contains levante runtimes dir)
    if (!runtimeExecutable.includes(levanteRuntimesPath)) {
      this.logger.mcp.info("Using system runtime (not tracked)", {
        serverId: config.id,
        path: runtimeExecutable
      });
      return;
    }

    // Skip registration for temporary test servers
    if (config.id.startsWith('test-')) {
      this.logger.mcp.debug("Skipping runtime registration for test server", {
        serverId: config.id
      });
      return;
    }

    // Register usage
    const runtimeKey = `${config.runtime.type}-${config.runtime.version}`;
    await this.runtimeManager.registerServerUsage(config.id, runtimeKey);

    this.logger.mcp.info("Registered runtime usage", {
      serverId: config.id,
      runtimeKey
    });
  }

  /**
   * Updates server config with resolved runtime path.
   *
   * @param config - Original server configuration
   * @param runtimeExecutable - Path to resolved runtime executable
   * @returns Modified config with updated command/args
   */
  private updateConfigWithRuntime(
    config: MCPServerConfig,
    runtimeExecutable: string
  ): MCPServerConfig {
    // Create shallow copy to avoid mutating original
    const modifiedConfig = { ...config };
    const command = modifiedConfig.command || '';
    const isRunner = ['node', 'python', 'python3'].includes(command);

    if (isRunner) {
      // Direct runtime execution: replace command with runtime path
      modifiedConfig.command = runtimeExecutable;
    } else if (command === 'npx') {
      // npx: find npx relative to node runtime
      const binDir = path.dirname(runtimeExecutable);
      modifiedConfig.command = path.join(
        binDir,
        process.platform === 'win32' ? 'npx.cmd' : 'npx'
      );
    } else {
      // Note: uvx is handled separately in resolveUvx() before this method is called
      // Script execution: prepend runtime to args
      modifiedConfig.args = [command, ...(modifiedConfig.args || [])];
      modifiedConfig.command = runtimeExecutable;
    }

    return modifiedConfig;
  }

  /**
   * Handles runtime resolution errors with appropriate logging.
   *
   * @param error - Error that occurred during runtime resolution
   * @param config - Server configuration
   * @param developerMode - Whether developer mode is enabled
   */
  private handleRuntimeError(
    error: unknown,
    config: MCPServerConfig,
    developerMode: boolean
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage === 'RUNTIME_CHOICE_REQUIRED') {
      // Advanced Mode: System runtime exists but user prefers Levante
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
  }

  /**
   * Checks if a config needs runtime resolution.
   *
   * @param config - Server configuration
   * @returns true if config requires runtime, false otherwise
   */
  needsRuntime(config: MCPServerConfig): boolean {
    // Normalize transport for configs using legacy `type`
    const transport = config.transport || (config as any).type;

    // Already has runtime specified
    if (config.runtime) {
      return true;
    }

    // Only stdio transports rely on local runtimes
    if (transport !== 'stdio') {
      return false;
    }

    // Check if command suggests runtime requirement
    if (!config.command) {
      return false;
    }

    const command = config.command.toLowerCase();
    const runtimeCommands = ['npx', 'node', 'uv', 'uvx', 'python', 'python3'];

    return runtimeCommands.includes(command);
  }
}
