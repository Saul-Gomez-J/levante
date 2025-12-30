import { BrowserWindow } from 'electron';
import type { MCPServerConfig } from '../types/mcp.js';
import { getLogger } from './logging';
import { validateMCPCommand } from './mcp/packageValidator';

const logger = getLogger();

export interface InputDefinition {
  label: string;
  required: boolean;
  type: 'string' | 'password' | 'number' | 'boolean';
  default?: string;
  description?: string;
}

export interface DeepLinkAction {
  type: 'mcp-add' | 'mcp-configure' | 'chat-new';
  data: Record<string, unknown>;
}

export class DeepLinkService {
  private mainWindow: BrowserWindow | null = null;

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Parse a deep link URL and extract action data
   */
  parseDeepLink(url: string): DeepLinkAction | null {
    try {
      logger.core.info('Parsing deep link URL', { url });

      // Parse the URL
      const parsedUrl = new URL(url);

      // Verify protocol
      if (parsedUrl.protocol !== 'levante:') {
        logger.core.warn('Invalid protocol for deep link', { protocol: parsedUrl.protocol });
        return null;
      }

      // For custom protocols like levante://mcp/add, the URL parser treats:
      // - 'mcp' as the hostname
      // - '/add' as the pathname
      // We need to combine hostname + pathname to get the full path
      const hostname = parsedUrl.hostname || '';
      const pathname = parsedUrl.pathname.replace(/^\/+/, '');
      const fullPath = hostname ? `${hostname}/${pathname}` : pathname;

      const [category, action] = fullPath.split('/');

      // Extract query parameters
      const params = Object.fromEntries(parsedUrl.searchParams.entries());

      logger.core.debug('Parsed deep link', { category, action, params });

      // Route to appropriate handler
      if (category === 'mcp' && action === 'add') {
        return this.parseMCPAddLink(params);
      } else if (category === 'mcp' && action === 'configure') {
        // Format: levante://mcp/configure/{server-id}
        // The server ID comes after 'configure/' in the pathname
        const remainingPath = pathname.replace(/^configure\/?/, '');
        return this.parseMCPConfigureLink(remainingPath, params);
      } else if (category === 'chat' && action === 'new') {
        return this.parseChatNewLink(params);
      }

      logger.core.warn('Unknown deep link action', { category, action });
      return null;
    } catch (error) {
      logger.core.error('Error parsing deep link', {
        url,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Sanitize an object to prevent prototype pollution
   * Removes dangerous keys that can pollute Object.prototype
   */
  private sanitizeObject(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    // Create a clean object without prototype chain
    const sanitized = Object.create(null);

    // Dangerous keys that can cause prototype pollution
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

    for (const key in obj) {
      // Skip dangerous keys
      if (dangerousKeys.includes(key)) {
        logger.core.warn('Blocked dangerous key in object', { key });
        continue;
      }

      // Only copy own properties
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key];

        // Recursively sanitize nested objects
        if (typeof value === 'object' && value !== null) {
          sanitized[key] = this.sanitizeObject(value);
        } else {
          sanitized[key] = value;
        }
      }
    }

    return sanitized;
  }

  /**
   * Parse MCP server addition deep link
   * Format: levante://mcp/add?name=server&transport=stdio&command=npx&args=package-name&inputs={...}
   */
  private parseMCPAddLink(params: Record<string, string>): DeepLinkAction | null {
    // Support both 'transport' (correct) and 'type' (legacy) for backwards compatibility
    const { name, transport, type, command, args, url, headers, env, inputs } = params;
    const serverType = transport || type;

    if (!name || !serverType) {
      logger.core.warn('Missing required parameters for MCP add', { params });
      return null;
    }

    // Validate server type
    if (serverType !== 'stdio' && serverType !== 'http' && serverType !== 'sse' && serverType !== 'streamable-http') {
      logger.core.warn('Invalid MCP server transport type', { serverType });
      return null;
    }

    const serverConfig: Partial<MCPServerConfig> = {
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name: name,
      transport: serverType as 'stdio' | 'http' | 'sse' | 'streamable-http',
    };

    // Handle stdio type
    if (serverType === 'stdio') {
      if (!command) {
        logger.core.warn('Missing command for stdio MCP server', { params });
        return null;
      }

      serverConfig.command = command;
      // Support both comma-separated args and single arg (for URLs with single package)
      serverConfig.args = args ? (args.includes(',') ? args.split(',') : [args]) : [];

      // Parse environment variables if provided
      if (env) {
        try {
          const parsedEnv = JSON.parse(env);
          const sanitizedEnv = this.sanitizeObject(parsedEnv);
          serverConfig.env = { ...sanitizedEnv };

          logger.core.debug('Parsed and sanitized env variables', {
            originalKeys: Object.keys(parsedEnv),
            sanitizedKeys: Object.keys(sanitizedEnv)
          });
        } catch (error) {
          logger.core.error('Failed to parse env JSON', {
            error: error instanceof Error ? error.message : String(error),
            env
          });
          serverConfig.env = {};
        }
      } else {
        serverConfig.env = {};
      }

      // Security: Validate npx packages and arguments before allowing deep link
      try {
        validateMCPCommand(command, serverConfig.args);
        logger.core.info('MCP command validation passed for deep link', {
          command,
          argsCount: serverConfig.args.length
        });
      } catch (error) {
        logger.core.error('Security validation failed for MCP deep link', {
          command,
          args: serverConfig.args,
          error: error instanceof Error ? error.message : String(error)
        });
        // Reject the deep link by returning null
        return null;
      }
    }

    // Handle http/sse/streamable-http types
    if (serverType === 'http' || serverType === 'sse' || serverType === 'streamable-http') {
      if (!url) {
        logger.core.warn('Missing URL for HTTP/SSE/streamable-http MCP server', { params });
        return null;
      }

      serverConfig.url = url;

      // Parse environment variables if provided (for http servers too)
      if (env) {
        try {
          const parsedEnv = JSON.parse(env);
          const sanitizedEnv = this.sanitizeObject(parsedEnv);
          serverConfig.env = { ...sanitizedEnv };

          logger.core.debug('Parsed env for HTTP server', {
            envKeys: Object.keys(sanitizedEnv)
          });
        } catch (error) {
          logger.core.error('Failed to parse env JSON for HTTP server', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Parse and sanitize headers to prevent prototype pollution
      if (headers) {
        try {
          const parsedHeaders = JSON.parse(headers);

          // Sanitize the parsed object to remove dangerous keys
          const sanitizedHeaders = this.sanitizeObject(parsedHeaders);

          // Convert back to regular object for compatibility
          serverConfig.headers = { ...sanitizedHeaders };

          logger.core.debug('Parsed and sanitized headers', {
            originalKeys: Object.keys(parsedHeaders),
            sanitizedKeys: Object.keys(sanitizedHeaders)
          });
        } catch (error) {
          logger.core.error('Failed to parse headers JSON', {
            error: error instanceof Error ? error.message : String(error),
            headers
          });
          // Use empty headers on parse error
          serverConfig.headers = {};
        }
      } else {
        serverConfig.headers = {};
      }
    }

    // Parse inputs if provided (field definitions for configuration)
    let parsedInputs: Record<string, InputDefinition> | undefined;
    if (inputs) {
      try {
        parsedInputs = JSON.parse(inputs);
        const sanitizedInputs = this.sanitizeObject(parsedInputs);

        logger.core.debug('Parsed input definitions from deep link', {
          inputKeys: Object.keys(sanitizedInputs)
        });

        parsedInputs = sanitizedInputs;
      } catch (error) {
        logger.core.error('Failed to parse inputs JSON', {
          error: error instanceof Error ? error.message : String(error),
          inputs
        });
        // Continue without inputs on parse error
        parsedInputs = undefined;
      }
    }

    logger.core.info('Parsed MCP add deep link', {
      serverConfig,
      hasInputs: !!parsedInputs,
      inputCount: parsedInputs ? Object.keys(parsedInputs).length : 0
    });

    return {
      type: 'mcp-add',
      data: {
        name,
        config: serverConfig,
        inputs: parsedInputs
      }
    };
  }

  /**
   * Parse chat creation deep link
   * Format: levante://chat/new?prompt=your-message&autoSend=true
   */
  private parseChatNewLink(params: Record<string, string>): DeepLinkAction | null {
    const { prompt, autoSend } = params;

    if (!prompt) {
      logger.core.warn('Missing prompt for chat new', { params });
      return null;
    }

    logger.core.info('Parsed chat new deep link', {
      promptLength: prompt.length,
      autoSend
    });

    return {
      type: 'chat-new',
      data: {
        prompt: decodeURIComponent(prompt),
        autoSend: autoSend === 'true'
      }
    };
  }

  /**
   * Parse MCP configuration deep link (from discovery tool)
   * Format: levante://mcp/configure/{server-id}
   * The server config will be fetched from the registry in the renderer
   */
  private parseMCPConfigureLink(serverId: string, _params: Record<string, string>): DeepLinkAction | null {
    // Decode the server ID in case it contains URL-encoded characters
    const decodedServerId = decodeURIComponent(serverId).trim();

    if (!decodedServerId) {
      logger.core.warn('Missing server ID for MCP configure', { serverId });
      return null;
    }

    logger.core.info('Parsed MCP configure deep link', { serverId: decodedServerId });

    return {
      type: 'mcp-configure',
      data: {
        serverId: decodedServerId
      }
    };
  }

  /**
   * Handle a deep link action by sending it to the renderer
   */
  handleDeepLink(url: string): void {
    const action = this.parseDeepLink(url);

    if (!action) {
      logger.core.warn('Unable to handle deep link', { url });
      return;
    }

    if (!this.mainWindow) {
      logger.core.error('Main window not available for deep link', { url });
      return;
    }

    // Show and focus the window
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.show();
    this.mainWindow.focus();

    // Send action to renderer via IPC
    logger.core.info('Sending deep link action to renderer', { action });
    this.mainWindow.webContents.send('levante/deep-link/action', action);
  }
}

// Export singleton instance
export const deepLinkService = new DeepLinkService();
