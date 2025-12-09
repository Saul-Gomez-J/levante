import type {
  MCPServerConfig,
  Tool,
  ToolCall,
  ToolResult,
  MCPResource,
  MCPResourceContent,
  MCPPrompt,
  MCPPromptResult,
} from "../../types/mcp.js";
import type { MCPRegistry } from "./types.js";

/**
 * Common interface for MCP service implementations.
 *
 * This interface defines the contract that both MCPUseService and MCPLegacyService
 * must implement, allowing them to be used interchangeably via the factory pattern.
 */
export interface IMCPService {
  /**
   * Initialize the MCP service. Must be called before using other methods.
   * This allows for async initialization like configuring loggers.
   */
  initialize(): Promise<void>;

  /**
   * Connect to an MCP server with the given configuration.
   * @param config - Server configuration including transport details
   * @throws Error if connection fails
   */
  connectServer(config: MCPServerConfig): Promise<void>;

  /**
   * Disconnect from an MCP server.
   * @param serverId - ID of the server to disconnect
   */
  disconnectServer(serverId: string): Promise<void>;

  /**
   * List all available tools from a connected MCP server.
   * @param serverId - ID of the server to query
   * @returns Array of available tools
   * @throws Error if server not connected
   */
  listTools(serverId: string): Promise<Tool[]>;

  /**
   * Call a tool on a connected MCP server.
   * @param serverId - ID of the server hosting the tool
   * @param toolCall - Tool name and arguments
   * @returns Tool execution result
   * @throws Error if server not connected or tool call fails
   */
  callTool(serverId: string, toolCall: ToolCall): Promise<ToolResult>;

  /**
   * Check if a server is currently connected.
   * @param serverId - ID of the server to check
   * @returns true if connected, false otherwise
   */
  isConnected(serverId: string): boolean;

  /**
   * Get list of all currently connected server IDs.
   * @returns Array of connected server IDs
   */
  getConnectedServers(): string[];

  /**
   * Disconnect from all connected servers.
   */
  disconnectAll(): Promise<void>;

  /**
   * Ping a server to check if it's responsive.
   * @param serverId - ID of the server to ping
   * @returns true if server responds, false otherwise
   */
  ping(serverId: string): Promise<boolean>;

  /**
   * Reconnect to a server (uses stored config).
   * @param serverId - ID of the server to reconnect
   */
  reconnectServer(serverId: string): Promise<void>;

  /**
   * Get MCP registry information (available servers/packages).
   * @returns MCP registry data
   */
  getRegistry(): Promise<MCPRegistry>;

  /**
   * Validate if an MCP package is known and active.
   * @param packageName - NPM package name to validate
   * @returns Validation result with status and message
   */
  validatePackage(
    packageName: string
  ): Promise<{
    valid: boolean;
    status: string;
    message: string;
    alternative?: string;
  }>;

  // ==========================================
  // MCP Resources methods
  // ==========================================

  /**
   * List all resources available from a connected MCP server.
   * @param serverId - ID of the server to query
   * @returns Array of available resources
   * @throws Error if server not connected or doesn't support resources
   */
  listResources(serverId: string): Promise<MCPResource[]>;

  /**
   * Read the content of a specific resource from an MCP server.
   * @param serverId - ID of the server hosting the resource
   * @param uri - URI of the resource to read
   * @returns Resource content with text or binary data
   * @throws Error if server not connected or resource not found
   */
  readResource(serverId: string, uri: string): Promise<MCPResourceContent>;

  // ==========================================
  // MCP Prompts methods
  // ==========================================

  /**
   * List all prompts available from a connected MCP server.
   * @param serverId - ID of the server to query
   * @returns Array of available prompts with their arguments
   * @throws Error if server not connected or doesn't support prompts
   */
  listPrompts(serverId: string): Promise<MCPPrompt[]>;

  /**
   * Get a prompt from an MCP server with optional arguments.
   * @param serverId - ID of the server hosting the prompt
   * @param name - Name of the prompt to get
   * @param args - Optional arguments to pass to the prompt
   * @returns Prompt result with messages
   * @throws Error if server not connected or prompt not found
   */
  getPrompt(serverId: string, name: string, args?: Record<string, any>): Promise<MCPPromptResult>;
}
