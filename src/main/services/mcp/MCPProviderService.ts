import path from 'path';
import fs from 'fs/promises';
import { getLogger } from '../logging';
import { mcpCacheService } from './MCPCacheService';

const logger = getLogger();

// Provider type definition (matches renderer types)
export interface MCPProvider {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: 'local' | 'github' | 'api';
  endpoint: string;
  enabled: boolean;
  homepage?: string;
  lastSynced?: string;
  serverCount?: number;
  config?: {
    branch?: string;
    path?: string;
    authRequired?: boolean;
    authToken?: string;
  };
}

// Registry entry type (matches renderer types)
export interface MCPRegistryEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  transport: {
    type: 'stdio' | 'http' | 'sse';
    autoDetect: boolean;
  };
  configuration: {
    fields: Array<{
      key: string;
      label: string;
      type: string;
      required: boolean;
      description: string;
      placeholder?: string;
      options?: string[];
      defaultValue?: unknown;
    }>;
    defaults?: Record<string, unknown>;
    template?: {
      type: 'stdio' | 'http' | 'sse';
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      baseUrl?: string;
      headers?: Record<string, string>;
    };
  };
  source?: string;
  metadata?: {
    useCount?: number;
    homepage?: string;
    author?: string;
    repository?: string;
    path?: string;
  };
}

interface MCPRegistry {
  version: string;
  lastUpdated?: string;
  entries: MCPRegistryEntry[];
}

// AITempl API response types
interface AitemplMcpServer {
  name: string;
  description: string;
  category: string;
  content: string; // JSON string with mcpServers configuration
  downloads: number;
}

interface AitemplResponse {
  mcps: AitemplMcpServer[];
}

/**
 * Service for fetching and normalizing MCP servers from various providers
 */
export class MCPProviderService {
  private defaultCacheMaxAge = 60 * 60 * 1000; // 1 hour

  /**
   * Fetch from local file
   */
  private async fetchFromLocal(filePath: string): Promise<MCPRegistry> {
    const fullPath = path.join(__dirname, '../../renderer/data', filePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * Fetch from external API
   */
  private async fetchFromAPI(url: string): Promise<unknown> {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Levante-MCP-Client/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`API fetch failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Normalize Levante (local) registry
   */
  private normalizeLevante(data: MCPRegistry, source: string): MCPRegistryEntry[] {
    return data.entries.map(entry => ({
      ...entry,
      source
    }));
  }

  /**
   * Normalize AITempl response
   */
  private normalizeAitempl(data: AitemplResponse, source: string): MCPRegistryEntry[] {
    return data.mcps.map(server => {
      // Parse the content JSON to extract server configuration
      let command = 'npx';
      let args: string[] = [];
      let env: Record<string, string> = {};

      try {
        const contentObj = JSON.parse(server.content);
        const mcpServers = contentObj.mcpServers;
        if (mcpServers) {
          // Get the first server from mcpServers object
          const serverKey = Object.keys(mcpServers)[0];
          if (serverKey && mcpServers[serverKey]) {
            const serverConfig = mcpServers[serverKey];
            command = serverConfig.command || 'npx';
            args = serverConfig.args || [];
            env = serverConfig.env || {};
          }
        }
      } catch (e) {
        logger.mcp.warn('Failed to parse AITempl server content', {
          serverName: server.name,
          error: e instanceof Error ? e.message : e
        });
      }

      return {
        id: `${source}-${server.name}`,
        name: server.name,
        description: server.description || '',
        category: server.category || 'general',
        icon: 'server',
        transport: { type: 'stdio' as const, autoDetect: true },
        source,
        configuration: {
          fields: Object.keys(env).map(key => ({
            key,
            label: key,
            type: 'string',
            required: true,
            description: `Environment variable: ${key}`,
            placeholder: env[key]
          })),
          defaults: { command, args: args.join(' ') },
          template: {
            type: 'stdio' as const,
            command,
            args,
            env
          }
        },
        metadata: {
          useCount: server.downloads
        }
      };
    });
  }

  /**
   * Main method: sync provider and return normalized entries
   */
  async syncProvider(provider: MCPProvider): Promise<MCPRegistryEntry[]> {
    logger.mcp.info('Syncing provider', { providerId: provider.id, type: provider.type });

    try {
      let entries: MCPRegistryEntry[];

      if (provider.type === 'local') {
        const rawData = await this.fetchFromLocal(provider.endpoint);
        entries = this.normalizeLevante(rawData, provider.id);
      } else if (provider.type === 'api') {
        const rawData = await this.fetchFromAPI(provider.endpoint);

        // Route to correct normalizer based on provider ID
        if (provider.id === 'aitempl') {
          entries = this.normalizeAitempl(rawData as AitemplResponse, provider.id);
        } else {
          logger.mcp.warn('No normalizer for API provider', { providerId: provider.id });
          entries = [];
        }
      } else {
        // TODO: Add support for github provider type in the future
        logger.mcp.warn('Provider type not yet supported', {
          providerId: provider.id,
          type: provider.type
        });
        return [];
      }

      // Cache the results
      await mcpCacheService.setCache(provider.id, entries);

      logger.mcp.info('Provider synced successfully', {
        providerId: provider.id,
        entryCount: entries.length
      });

      return entries;
    } catch (error) {
      logger.mcp.error('Failed to sync provider', {
        providerId: provider.id,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  }

  /**
   * Get cached entries for a provider
   */
  async getCachedEntries(providerId: string): Promise<MCPRegistryEntry[] | null> {
    return mcpCacheService.getCache<MCPRegistryEntry[]>(providerId);
  }

  /**
   * Check if cache is valid
   */
  async isCacheValid(providerId: string, maxAgeMs?: number): Promise<boolean> {
    return mcpCacheService.isCacheValid(providerId, maxAgeMs || this.defaultCacheMaxAge);
  }

  /**
   * Get cache timestamp
   */
  async getCacheTimestamp(providerId: string): Promise<number | null> {
    return mcpCacheService.getCacheTimestamp(providerId);
  }
}

// Singleton instance
export const mcpProviderService = new MCPProviderService();
