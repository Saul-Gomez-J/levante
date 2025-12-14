import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { getLogger } from '../logging';
import type {
  MCPProvider,
  MCPRegistryEntry,
  LevanteAPIResponse,
  LevanteAPIServer,
  EnvFieldConfig,
  MCPConfigField
} from '../../../renderer/types/mcp';
import { mcpCacheService } from './MCPCacheService';

const logger = getLogger();

export class MCPProviderService {
  /**
   * ✅ SIMPLIFICADO: Solo un método de sincronización
   */
  async syncProvider(provider: MCPProvider): Promise<MCPRegistryEntry[]> {
    logger.mcp.info(`[MCPProviderService] Syncing provider: ${provider.id}`);

    try {
      // Fetch desde API
      const apiResponse = await this.fetchFromAPI(provider.endpoint);

      // Transformar a formato interno
      const entries = this.transformAPIResponse(apiResponse, provider.id);

      // Cachear resultados
      await mcpCacheService.setCache(provider.id, entries);

      logger.mcp.info(`[MCPProviderService] Synced ${entries.length} servers from ${provider.id}`);

      return entries;
    } catch (error) {
      logger.mcp.error(`[MCPProviderService] Error syncing provider ${provider.id}:`, error as any);

      // Intentar devolver desde cache si existe
      const cachedEntries = await mcpCacheService.getCache<MCPRegistryEntry[]>(provider.id);
      if (cachedEntries) {
        logger.mcp.info(`[MCPProviderService] Returning cached data for ${provider.id}`);
        return cachedEntries;
      }

      throw error;
    }
  }

  /**
   * ✅ SIMPLIFICADO: Un solo método de fetch
   */
  private async fetchFromAPI(endpoint: string): Promise<LevanteAPIResponse> {
    logger.mcp.debug(`[MCPProviderService] Fetching from API: ${endpoint}`);

    const response = await fetch(endpoint, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Levante-MCP-Client/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data as LevanteAPIResponse;
  }

  /**
   * ✅ NUEVO: Transformador único de API a formato interno
   */
  private transformAPIResponse(
    apiResponse: LevanteAPIResponse,
    source: string
  ): MCPRegistryEntry[] {
    return apiResponse.servers.map(server => this.transformServer(server, source));
  }

  /**
   * ✅ NUEVO: Transforma un servidor individual
   */
  private transformServer(server: LevanteAPIServer, source: string): MCPRegistryEntry {
    const { env } = server;

    // Generar campos de configuración desde env
    const fields: MCPConfigField[] = this.generateFieldsFromEnv(env || {});

    // Construir template según el tipo de transporte
    const template = this.buildTemplate(server);

    return {
      id: server.id,
      name: server.name,
      description: server.description,
      category: server.category,
      icon: server.icon,
      logoUrl: server.logoUrl,
      source,  // "levante-store"
      provider: server.provider,  // ✅ NUEVO: "levante", "aitempl", etc.
      transport: {
        type: server.transport,
        autoDetect: true
      },
      configuration: {
        fields,
        defaults: this.extractDefaults(server),
        template
      },
      metadata: server.metadata || {}
    };
  }

  /**
   * ✅ NUEVO: Genera campos de configuración desde env
   */
  private generateFieldsFromEnv(env: Record<string, EnvFieldConfig | string>): MCPConfigField[] {
    const fields: MCPConfigField[] = [];

    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'object') {
        fields.push({
          key,
          label: value.label || key,
          type: (value.type as any) || 'text',
          required: value.required ?? true,
          description: `Environment variable: ${key}`,
          placeholder: value.default || '',
          defaultValue: value.default
        });
      }
    }

    return fields;
  }

  /**
   * ✅ NUEVO: Construye template según tipo de transporte
   */
  private buildTemplate(server: LevanteAPIServer): any {
    if (server.transport === 'stdio') {
      return {
        type: 'stdio',
        command: server.command || 'npx',
        args: server.args || [],
        env: this.extractEnvDefaults(server.env || {})
      };
    }

    // Para http/sse, construir desde metadata si existe
    return {
      type: server.transport,
      baseUrl: server.metadata?.homepage || '',
      headers: {}
    };
  }

  /**
   * ✅ NUEVO: Extrae valores default de env
   */
  private extractEnvDefaults(env: Record<string, EnvFieldConfig | string>): Record<string, string> {
    const defaults: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'object' && value.default) {
        defaults[key] = value.default;
      } else if (typeof value === 'string') {
        defaults[key] = value;
      }
    }

    return defaults;
  }

  /**
   * ✅ NUEVO: Extrae defaults para la UI
   */
  private extractDefaults(server: LevanteAPIServer): Record<string, any> {
    return {
      command: server.command || 'npx',
      args: Array.isArray(server.args) ? server.args.join(' ') : ''
    };
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
    const defaultCacheMaxAge = 60 * 60 * 1000; // 1 hour
    return mcpCacheService.isCacheValid(providerId, maxAgeMs || defaultCacheMaxAge);
  }

  /**
   * Get cache timestamp
   */
  async getCacheTimestamp(providerId: string): Promise<number | null> {
    return mcpCacheService.getCacheTimestamp(providerId);
  }
}

export const mcpProviderService = new MCPProviderService();
