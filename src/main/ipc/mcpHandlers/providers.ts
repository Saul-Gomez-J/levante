import { ipcMain } from 'electron';
import { getLogger } from '../../services/logging';
import { mcpProviderService, MCPProvider } from '../../services/mcp/MCPProviderService';
import { mcpCacheService } from '../../services/mcp/MCPCacheService';
import mcpProvidersData from '../../../renderer/data/mcpProviders.json';

const logger = getLogger();

export function registerProviderHandlers() {
  // Initialize cache service
  mcpCacheService.initialize();

  // List all available providers
  ipcMain.handle('levante/mcp/providers/list', async () => {
    try {
      const providers = mcpProvidersData.providers as MCPProvider[];

      // Enrich with cache info
      const enrichedProviders = await Promise.all(
        providers.map(async (provider) => {
          const timestamp = await mcpProviderService.getCacheTimestamp(provider.id);
          const cached = await mcpProviderService.getCachedEntries(provider.id);

          return {
            ...provider,
            lastSynced: timestamp ? new Date(timestamp).toISOString() : undefined,
            serverCount: cached?.length || 0
          };
        })
      );

      return { success: true, data: enrichedProviders };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.mcp.error('Failed to list providers', { error: message });
      return { success: false, error: message };
    }
  });

  // Sync a specific provider
  ipcMain.handle('levante/mcp/providers/sync', async (_, providerId: string) => {
    try {
      const providers = mcpProvidersData.providers as MCPProvider[];
      const provider = providers.find(p => p.id === providerId);

      if (!provider) {
        return { success: false, error: `Provider not found: ${providerId}` };
      }

      const entries = await mcpProviderService.syncProvider(provider);

      return {
        success: true,
        data: {
          providerId,
          entries,
          syncedAt: new Date().toISOString()
        }
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.mcp.error('Failed to sync provider', { providerId, error: message });
      return { success: false, error: message };
    }
  });

  // Sync all enabled providers
  ipcMain.handle('levante/mcp/providers/sync-all', async () => {
    try {
      const providers = mcpProvidersData.providers as MCPProvider[];
      const enabledProviders = providers.filter(p => p.enabled);

      const results = await Promise.allSettled(
        enabledProviders.map(provider => mcpProviderService.syncProvider(provider))
      );

      const syncedProviders = enabledProviders.map((provider, index) => {
        const result = results[index];
        return {
          providerId: provider.id,
          success: result.status === 'fulfilled',
          entryCount: result.status === 'fulfilled' ? result.value.length : 0,
          error: result.status === 'rejected' ? result.reason?.message : undefined
        };
      });

      return {
        success: true,
        data: {
          syncedProviders,
          syncedAt: new Date().toISOString()
        }
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.mcp.error('Failed to sync all providers', { error: message });
      return { success: false, error: message };
    }
  });

  // Get cached entries for a provider
  ipcMain.handle('levante/mcp/providers/get-entries', async (_, providerId: string) => {
    try {
      const entries = await mcpProviderService.getCachedEntries(providerId);

      if (!entries) {
        // If no cache, try to sync
        const providers = mcpProvidersData.providers as MCPProvider[];
        const provider = providers.find(p => p.id === providerId);

        if (!provider) {
          return { success: false, error: `Provider not found: ${providerId}` };
        }

        const freshEntries = await mcpProviderService.syncProvider(provider);
        return { success: true, data: freshEntries };
      }

      return { success: true, data: entries };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.mcp.error('Failed to get provider entries', { providerId, error: message });
      return { success: false, error: message };
    }
  });

  // Get all entries from all enabled providers
  ipcMain.handle('levante/mcp/providers/get-all-entries', async () => {
    try {
      const providers = mcpProvidersData.providers as MCPProvider[];
      const enabledProviders = providers.filter(p => p.enabled);

      const allEntries = [];

      for (const provider of enabledProviders) {
        let entries = await mcpProviderService.getCachedEntries(provider.id);

        if (!entries) {
          // Sync if no cache
          entries = await mcpProviderService.syncProvider(provider);
        }

        allEntries.push(...entries);
      }

      return { success: true, data: allEntries };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.mcp.error('Failed to get all entries', { error: message });
      return { success: false, error: message };
    }
  });

  logger.mcp.info('MCP provider handlers registered');
}
