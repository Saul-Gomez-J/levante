// NOTE: mcp-use is dynamically imported to avoid Logger.get() being called at module load time
// Types are imported separately as they don't trigger module execution
import type { MCPClientOptions, MCPSession } from 'mcp-use';
import type {
  MCPServerConfig,
  Tool,
  ToolCall,
  ToolResult,
  CodeModeConfig,
  MCPResource,
  MCPResourceContent,
  MCPPrompt,
  MCPPromptResult,
} from "../../types/mcp.js";
import type { MCPPreferences } from "../../../types/preferences.js";
import { getLogger } from "../logging";
import { loadMCPRegistry } from "./registry.js";
import type { MCPRegistry } from "./types";
import type { IMCPService } from "./IMCPService.js";
import { RuntimeResolver } from "../runtime/RuntimeResolver.js";
import { RuntimeManager } from "../runtime/runtimeManager.js";
import { PreferencesService } from "../preferencesService.js";
import { OAuthService } from "../oauth/OAuthService.js";

// Dynamic import references - populated in initialize()
let MCPClient: any;
let MCPLogger: any;

/**
 * Modern MCP service implementation using mcp-use framework.
 *
 * This implementation provides code mode capabilities for better token efficiency
 * and advanced workflow orchestration. This is the default implementation.
 */
export class MCPUseService implements IMCPService {
  private logger = getLogger();
  private clients: Map<string, any> = new Map(); // MCPClient instances
  private sessions: Map<string, MCPSession> = new Map();
  private globalPreferences: MCPPreferences;
  private runtimeResolver: RuntimeResolver;
  private static mcpUseLoaded = false;

  constructor(preferences: MCPPreferences) {
    this.globalPreferences = preferences;

    // Initialize RuntimeResolver for automatic runtime management
    this.runtimeResolver = new RuntimeResolver(
      new RuntimeManager(),
      new PreferencesService(),
      this.logger
    );
  }

  /**
   * Initialize mcp-use library with dynamic import.
   * This must be called before using any mcp-use functionality.
   *
   * We use dynamic import to avoid Logger.get() being called at module load time,
   * which would fail because winston isn't configured yet.
   */
  async initialize(): Promise<void> {
    if (!MCPUseService.mcpUseLoaded) {
      try {
        // Dynamically import mcp-use - this triggers the module to load
        // But by this point, winston should be available as a dependency
        const mcpUse = await import('mcp-use');
        MCPClient = mcpUse.MCPClient;
        MCPLogger = mcpUse.Logger;

        // Configure the mcp-use logger to disable console output
        await MCPLogger.configure({ console: false });

        MCPUseService.mcpUseLoaded = true;
        this.logger.mcp.debug('mcp-use dynamically loaded and Logger configured');
      } catch (error) {
        this.logger.mcp.error('Failed to initialize mcp-use', {
          error: error instanceof Error ? error.message : error
        });
        throw error;
      }
    }
  }

  async connectServer(config: MCPServerConfig): Promise<void> {
    // Ensure mcp-use is loaded before attempting to connect
    if (!MCPUseService.mcpUseLoaded) {
      await this.initialize();
    }

    // Normalize transport for configs that still use `type` (Claude compatibility)
    const transport = config.transport || (config as any).type;
    const normalizedConfig = { ...config, transport };

    // Resolve runtime if needed (stdio transport only)
    // This handles auto-detection, installation, and path resolution
    if (transport === 'stdio' && this.runtimeResolver.needsRuntime(normalizedConfig)) {
      config = await this.runtimeResolver.resolve(normalizedConfig);
    } else {
      config = normalizedConfig;
    }

    const codeModeConfig = this.resolveCodeModeConfig(config);

    // Auto-detect transport type if not provided (already normalized above, but fallback)
    const finalTransport: MCPServerConfig['transport'] | null = config.transport ||
      (config.command ? 'stdio' : (config.baseUrl || (config as any).url) ? 'http' : null);

    // Normalize url → baseUrl
    const baseUrl = config.baseUrl || (config as any).url;

    this.logger.mcp.info("Attempting to connect to server (mcp-use)", {
      serverId: config.id,
      transport: finalTransport,
      codeMode: codeModeConfig.enabled,
      executor: codeModeConfig.executor,
    });

    if (!finalTransport) {
      throw new Error('Cannot determine transport type from config');
    }

    // Build server configuration for mcp-use
    const serverConfig: Record<string, any> = {
      transport: finalTransport,
    };

    // Add transport-specific configuration
    if (finalTransport === 'stdio') {
      serverConfig.command = config.command;
      serverConfig.args = config.args;
      serverConfig.env = config.env;
    } else if (finalTransport === 'http' || finalTransport === 'sse' || finalTransport === 'streamable-http') {
      serverConfig.url = baseUrl;

      let headers = { ...(config.headers || {}) };

      // Phase 4: Handle OAuth
      if (config.oauth?.enabled) {
        try {
          this.logger.mcp.debug("Ensuring valid OAuth token for mcp-use", {
            serverId: config.id,
          });
          const oauthService = new OAuthService(new PreferencesService());
          const tokens = await oauthService.ensureValidToken(config.id);

          headers = {
            ...headers,
            Authorization: `${tokens.tokenType} ${tokens.accessToken}`,
          };

          this.logger.mcp.info("OAuth token added to mcp-use headers", {
            serverId: config.id,
          });
        } catch (oauthError) {
          this.logger.mcp.error("Failed to get OAuth token for mcp-use", {
            serverId: config.id,
            error: oauthError instanceof Error ? oauthError.message : oauthError,
          });
          // Continue anyway or throw? The plan for transports.ts throws.
          throw new Error(`OAuth authentication failed: ${oauthError instanceof Error ? oauthError.message : String(oauthError)}`);
        }
      }

      if (Object.keys(headers).length > 0) {
        serverConfig.headers = headers;
      }
    }

    // Build MCP client options
    const clientOptions: MCPClientOptions = {};

    // Add code mode configuration if enabled
    if (codeModeConfig.enabled) {
      const executorOpts: any = {};

      if (codeModeConfig.executor === 'vm' || !codeModeConfig.executor) {
        // VM executor options
        executorOpts.timeoutMs =
          codeModeConfig.executorOptions?.timeout ||
          this.globalPreferences.codeModeDefaults?.vmTimeout ||
          30000;

        executorOpts.memoryLimitMb =
          (codeModeConfig.executorOptions?.memoryLimit ||
            this.globalPreferences.codeModeDefaults?.vmMemoryLimit ||
            134217728) / (1024 * 1024); // Convert bytes to MB
      } else if (codeModeConfig.executor === 'e2b') {
        // E2B executor options
        executorOpts.apiKey =
          codeModeConfig.executorOptions?.apiKey ||
          this.globalPreferences.e2bApiKey;

        if (!executorOpts.apiKey) {
          throw new Error('E2B executor requires API key');
        }

        if (codeModeConfig.executorOptions?.timeout) {
          executorOpts.timeoutMs = codeModeConfig.executorOptions.timeout;
        }
      }

      clientOptions.codeMode = {
        enabled: true,
        executor: codeModeConfig.executor || 'vm',
        executorOptions: executorOpts,
      };
    }

    // Retry configuration for cold start handling
    // mcp-use hardcodes initial connection timeout to 3 seconds, so we implement retry at service level
    const maxRetries = (finalTransport === 'http' || finalTransport === 'sse' || finalTransport === 'streamable-http') ? 3 : 1;
    const retryDelayMs = 2000; // 2 second delay between retries
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Create client with server configuration
        // mcp-use expects config wrapped in 'mcpServers' object
        const clientConfig = {
          mcpServers: {
            [config.id]: serverConfig
          }
        };
        const client = new MCPClient(clientConfig, clientOptions);

        // Create and initialize session
        const session = await client.createSession(config.id, true);

        this.clients.set(config.id, client);
        this.sessions.set(config.id, session);

        this.logger.mcp.info("Successfully connected to MCP server (mcp-use)", {
          serverId: config.id,
          codeMode: codeModeConfig.enabled,
          executor: codeModeConfig.executor || 'vm',
          attempt,
        });
        return; // Success - exit the retry loop
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const errorMessage = lastError.message;

        // Check if this is a retryable error (timeout or connection issues)
        const isRetryable =
          errorMessage.includes('timed out') ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('Request timed out') ||
          errorMessage.includes('ECONNREFUSED') ||
          errorMessage.includes('Could not connect') ||
          errorMessage.includes('404') ||
          errorMessage.includes('503');

        if (attempt < maxRetries && isRetryable) {
          this.logger.mcp.warn(`Connection attempt ${attempt}/${maxRetries} failed, retrying in ${retryDelayMs}ms...`, {
            serverId: config.id,
            error: errorMessage,
          });
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        } else {
          // Final attempt failed or non-retryable error
          this.logger.mcp.error("Failed to connect to MCP server (mcp-use)", {
            serverId: config.id,
            error: errorMessage,
            attempt,
            maxRetries,
          });
          throw lastError;
        }
      }
    }
  }

  async listTools(serverId: string): Promise<Tool[]> {
    const session = this.sessions.get(serverId);
    if (!session) {
      throw new Error(
        `Session ${serverId} not found. Make sure to connect first.`
      );
    }

    try {
      // Access tools from the connector
      const tools = session.connector.tools;
      return tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description || "",
        inputSchema: tool.inputSchema,
        _meta: tool._meta, // Preserve metadata (e.g., openai/outputTemplate for Skybridge)
      }));
    } catch (error) {
      this.logger.mcp.error("Failed to list tools from server (mcp-use)", {
        serverId,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  async callTool(serverId: string, toolCall: ToolCall): Promise<ToolResult> {
    const session = this.sessions.get(serverId);
    if (!session) {
      throw new Error(
        `Session ${serverId} not found. Make sure to connect first.`
      );
    }

    try {
      const result = await session.connector.callTool(toolCall.name, toolCall.arguments);

      this.logger.mcp.debug("Tool result received (mcp-use) - RAW", {
        serverId,
        toolName: toolCall.name,
        fullResult: JSON.stringify(result).substring(0, 500), // First 500 chars
        resultKeys: Object.keys(result),
        hasContent: !!result.content,
        contentType: Array.isArray(result.content) ? 'array' : typeof result.content,
        contentLength: Array.isArray(result.content) ? result.content.length : 0,
        firstContentItem: Array.isArray(result.content) && result.content[0]
          ? JSON.stringify(result.content[0]).substring(0, 200)
          : null,
        isError: result.isError,
      });

      // Handle different content formats from mcp-use
      let content: any[];
      if (Array.isArray(result.content)) {
        content = result.content;
      } else if (result.content !== undefined && result.content !== null) {
        // If content is not an array, wrap it in an array
        // MCP protocol expects content to be an array of content items
        content = [{
          type: "text",
          text: typeof result.content === "string"
            ? result.content
            : JSON.stringify(result.content)
        }];
      } else {
        content = [];
      }

      const finalResult: ToolResult = {
        content,
        isError: Boolean(result.isError),
      };

      // Preserve _meta for UI widgets (mcp-use/widget)
      if (result._meta) {
        finalResult._meta = result._meta;
      }

      // Preserve structuredContent for widget data
      if (result.structuredContent) {
        finalResult.structuredContent = result.structuredContent;
      }

      this.logger.mcp.debug("Tool result AFTER processing (mcp-use)", {
        serverId,
        toolName: toolCall.name,
        contentLength: content.length,
        firstItem: content[0] ? JSON.stringify(content[0]).substring(0, 200) : null,
        isError: finalResult.isError,
        hasMeta: !!finalResult._meta,
        hasWidgetMeta: !!finalResult._meta?.['mcp-use/widget'],
        hasStructuredContent: !!finalResult.structuredContent,
      });

      return finalResult;
    } catch (error) {
      this.logger.mcp.error("Failed to call tool on server (mcp-use)", {
        serverId,
        toolName: toolCall.name,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  async disconnectServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    const session = this.sessions.get(serverId);

    if (client && session) {
      try {
        await client.closeSession(serverId);
        this.clients.delete(serverId);
        this.sessions.delete(serverId);
        this.logger.mcp.info("Successfully disconnected from MCP server (mcp-use)", {
          serverId,
        });
      } catch (error) {
        this.logger.mcp.error("Error disconnecting from server (mcp-use)", {
          serverId,
          error: error instanceof Error ? error.message : error,
        });
        // Still remove from maps even if disconnect failed
        this.clients.delete(serverId);
        this.sessions.delete(serverId);
      }
    }
  }

  isConnected(serverId: string): boolean {
    const session = this.sessions.get(serverId);
    return session ? session.isConnected : false;
  }

  getConnectedServers(): string[] {
    return Array.from(this.sessions.keys());
  }

  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.sessions.keys()).map(
      (serverId) => this.disconnectServer(serverId)
    );

    await Promise.allSettled(disconnectPromises);
  }

  async ping(serverId: string): Promise<boolean> {
    const session = this.sessions.get(serverId);
    if (!session) {
      return false;
    }

    try {
      // Check if session is connected and tools are available
      return session.isConnected && session.connector.tools.length >= 0;
    } catch (error) {
      return false;
    }
  }

  async reconnectServer(serverId: string): Promise<void> {
    // Implementation will depend on stored config
    this.logger.mcp.info("Reconnecting to server (mcp-use)", { serverId });
    // This will be implemented with config persistence
  }

  async getRegistry(): Promise<MCPRegistry> {
    return await loadMCPRegistry();
  }

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

  // ==========================================
  // MCP Resources methods
  // ==========================================

  /**
   * List all resources available from a connected MCP server.
   * Uses mcp-use session.listResources() API.
   */
  async listResources(serverId: string): Promise<MCPResource[]> {
    const session = this.sessions.get(serverId);
    if (!session) {
      throw new Error(
        `Session ${serverId} not found. Make sure to connect first.`
      );
    }

    try {
      // mcp-use TypeScript API: session.connector.listResources()
      const response = await session.connector.listResources();
      const resources = response?.resources || [];

      this.logger.mcp.debug("Listed resources from server (mcp-use)", {
        serverId,
        resourceCount: resources?.length || 0,
      });

      // Map to our MCPResource type
      return (resources || []).map((r: any) => ({
        name: r.name,
        uri: r.uri,
        description: r.description,
        mimeType: r.mimeType,
        annotations: r.annotations,
      }));
    } catch (error) {
      this.logger.mcp.error("Failed to list resources from server (mcp-use)", {
        serverId,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Read the content of a specific resource from an MCP server.
   * Uses mcp-use session.readResource(uri) API.
   */
  async readResource(serverId: string, uri: string): Promise<MCPResourceContent> {
    const session = this.sessions.get(serverId);
    if (!session) {
      throw new Error(
        `Session ${serverId} not found. Make sure to connect first.`
      );
    }

    try {
      // mcp-use TypeScript API: session.connector.readResource(uri)
      const result = await session.connector.readResource(uri);

      this.logger.mcp.debug("Read resource from server (mcp-use)", {
        serverId,
        uri,
        contentsCount: result?.contents?.length || 0,
      });

      return {
        uri,
        contents: (result?.contents || []).map((c: any) => ({
          uri: c.uri,
          mimeType: c.mimeType,
          text: c.text,
          blob: c.blob,
        })),
      };
    } catch (error) {
      this.logger.mcp.error("Failed to read resource from server (mcp-use)", {
        serverId,
        uri,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  // ==========================================
  // MCP Prompts methods
  // ==========================================

  /**
   * List all prompts available from a connected MCP server.
   * Uses mcp-use session.listPrompts() API.
   */
  async listPrompts(serverId: string): Promise<MCPPrompt[]> {
    const session = this.sessions.get(serverId);
    if (!session) {
      throw new Error(
        `Session ${serverId} not found. Make sure to connect first.`
      );
    }

    try {
      // mcp-use TypeScript API: session.connector.listPrompts()
      const response = await session.connector.listPrompts();

      const prompts = response?.prompts || [];

      this.logger.mcp.debug("Listed prompts from server (mcp-use)", {
        serverId,
        promptCount: prompts?.length || 0,
      });

      // Map to our MCPPrompt type
      return prompts.map((p: any) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments?.map((arg: any) => ({
          name: arg.name,
          description: arg.description,
          required: arg.required,
        })),
      }));
    } catch (error) {
      this.logger.mcp.error("Failed to list prompts from server (mcp-use)", {
        serverId,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Get a prompt from an MCP server with optional arguments.
   * Uses mcp-use session.getPrompt(name, args) API.
   */
  async getPrompt(serverId: string, name: string, args?: Record<string, any>): Promise<MCPPromptResult> {
    const session = this.sessions.get(serverId);
    if (!session) {
      throw new Error(
        `Session ${serverId} not found. Make sure to connect first.`
      );
    }

    try {
      // Convert args to string values if present (MCP protocol requires strings)
      const stringArgs = args && Object.keys(args).length > 0
        ? Object.fromEntries(Object.entries(args).map(([k, v]) => [k, String(v)]))
        : undefined;

      this.logger.mcp.debug("Calling getPrompt", {
        serverId,
        name,
        hasArgs: !!stringArgs,
      });

      // mcp-use TypeScript API: session.connector.getPrompt(name, args)
      // Args must be an object (empty {} if no args)
      const result = await session.connector.getPrompt(name, stringArgs || {});

      this.logger.mcp.debug("Got prompt from server (mcp-use)", {
        serverId,
        name,
        messagesCount: result?.messages?.length || 0,
      });

      return {
        description: result?.description,
        messages: (result?.messages || []).map((m: any) => ({
          role: m.role,
          content: {
            type: m.content?.text ? 'text' : 'image',
            text: m.content?.text,
            data: m.content?.data,
            mimeType: m.content?.mimeType,
          },
        })),
      };
    } catch (error) {
      this.logger.mcp.error("Failed to get prompt from server (mcp-use)", {
        serverId,
        name,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Resolve code mode configuration for a server.
   * Server-level config takes precedence over global defaults.
   */
  private resolveCodeModeConfig(config: MCPServerConfig): CodeModeConfig {
    // Server-level override takes precedence
    if (config.codeMode !== undefined) {
      if (typeof config.codeMode === 'boolean') {
        return {
          enabled: config.codeMode,
          executor: this.globalPreferences.codeModeDefaults?.executor || 'vm',
        };
      }
      return config.codeMode;
    }

    // Use global defaults
    return {
      enabled: this.globalPreferences.codeModeDefaults?.enabled ?? true,
      executor: this.globalPreferences.codeModeDefaults?.executor || 'vm',
    };
  }
}
