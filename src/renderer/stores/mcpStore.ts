import { create } from 'zustand';
import { MCPServerConfig, MCPConnectionStatus, MCPProvider, MCPRegistryEntry, MCPSource, MCPCategory } from '../types/mcp';
import mcpProvidersData from '../data/mcpProviders.json';

interface MCPStore {
  // State
  activeServers: MCPServerConfig[];
  connectionStatus: Record<string, MCPConnectionStatus>;
  isLoading: boolean;
  error: string | null;

  // Provider state
  providers: MCPProvider[];
  selectedSource: MCPSource | 'all';
  selectedCategory: MCPCategory | 'all';
  loadingProviders: Record<string, boolean>;
  providerEntries: Record<string, MCPRegistryEntry[]>;
  providerErrors: Record<string, string | null>;
  providersSynced: boolean;

  // Actions
  loadActiveServers: () => Promise<void>;
  refreshConnectionStatus: () => Promise<void>;
  connectServer: (config: MCPServerConfig) => Promise<void>;
  disconnectServer: (serverId: string) => Promise<void>;
  testConnection: (config: MCPServerConfig) => Promise<boolean>;
  addServer: (config: MCPServerConfig) => Promise<void>;
  updateServer: (serverId: string, config: Partial<Omit<MCPServerConfig, 'id'>>) => Promise<void>;
  removeServer: (serverId: string) => Promise<void>;
  importConfiguration: (config: any) => Promise<void>;
  exportConfiguration: () => Promise<any>;

  // Provider actions
  loadProviders: () => Promise<void>;
  syncProvider: (providerId: string) => Promise<void>;
  syncAllProviders: () => Promise<void>;
  setSelectedSource: (source: MCPSource | 'all') => void;
  setSelectedCategory: (category: MCPCategory | 'all') => void;
  clearProviderError: (providerId: string) => void;
  getFilteredEntries: () => MCPRegistryEntry[];
  getAvailableSources: () => MCPSource[];
  getAvailableCategories: () => MCPCategory[];

  // Helper methods
  isServerActive: (serverId: string) => boolean;
  getServerById: (serverId: string) => MCPServerConfig | undefined;
  getRegistryEntryById: (entryId: string) => MCPRegistryEntry | undefined;
}

export const useMCPStore = create<MCPStore>((set, get) => ({
  // Initial state
  activeServers: [],
  connectionStatus: {},
  isLoading: false,
  error: null,

  // Provider initial state
  providers: mcpProvidersData.providers as MCPProvider[],
  selectedSource: 'all',
  selectedCategory: 'all',
  loadingProviders: {},
  providerEntries: {},
  providerErrors: {},
  providersSynced: false,



  // Load active servers from configuration
  loadActiveServers: async () => {
    set({ isLoading: true, error: null });

    try {
      const result = await window.levante.mcp.listServers();

      if (result.success && result.data) {
        set({ activeServers: result.data });
        // Also refresh connection status
        await get().refreshConnectionStatus();
      } else {
        set({ error: result.error || 'Failed to load servers' });
      }
    } catch (error) {
      console.error('Failed to load active servers:', error);
      set({ error: 'Failed to load active servers' });
    } finally {
      set({ isLoading: false });
    }
  },

  // Refresh connection status for all servers
  refreshConnectionStatus: async () => {
    try {
      const result = await window.levante.mcp.connectionStatus();

      if (result.success && result.data) {
        set({ connectionStatus: result.data });
      }
    } catch (error) {
      console.error('Failed to refresh connection status:', error);
    }
  },

  // Connect to a server
  connectServer: async (config: MCPServerConfig) => {
    set({ isLoading: true, error: null });

    try {
      // Update connection status to connecting
      set(state => ({
        connectionStatus: {
          ...state.connectionStatus,
          [config.id]: 'connecting'
        }
      }));

      const result = await window.levante.mcp.connectServer(config);

      if (result.success) {
        // Update or add to activeServers with enabled=true
        set(state => {
          const existingIndex = state.activeServers.findIndex(s => s.id === config.id);

          if (existingIndex !== -1) {
            // Update existing server
            const updatedServers = [...state.activeServers];
            updatedServers[existingIndex] = { ...config, enabled: true };

            return {
              activeServers: updatedServers,
              connectionStatus: {
                ...state.connectionStatus,
                [config.id]: 'connected'
              }
            };
          } else {
            // Add new server
            return {
              activeServers: [...state.activeServers, { ...config, enabled: true }],
              connectionStatus: {
                ...state.connectionStatus,
                [config.id]: 'connected'
              }
            };
          }
        });

        // Track MCP activation
        window.levante.analytics?.trackMCP?.(config.name || config.id, 'active').catch(() => { });
      } else {
        // Check for runtime-specific errors that need UI intervention
        if ((result as any).errorCode === 'RUNTIME_CHOICE_REQUIRED' || (result as any).errorCode === 'RUNTIME_NOT_FOUND') {
          // Throw enriched error for UI to catch and show dialog
          const enrichedError = new Error(result.error || 'Runtime error');
          (enrichedError as any).errorCode = (result as any).errorCode;
          (enrichedError as any).metadata = (result as any).metadata;
          (enrichedError as any).serverConfig = config;
          throw enrichedError;
        }

        set(state => ({
          connectionStatus: {
            ...state.connectionStatus,
            [config.id]: 'error'
          },
          error: result.error || 'Failed to connect to server'
        }));
      }
    } catch (error) {
      // Re-throw runtime errors for UI handling
      if ((error as any).errorCode === 'RUNTIME_CHOICE_REQUIRED' || (error as any).errorCode === 'RUNTIME_NOT_FOUND') {
        throw error;
      }

      console.error('Failed to connect server:', error);
      set(state => ({
        connectionStatus: {
          ...state.connectionStatus,
          [config.id]: 'error'
        },
        error: 'Failed to connect to server'
      }));
    } finally {
      set({ isLoading: false });
    }
  },

  // Disconnect from a server
  disconnectServer: async (serverId: string) => {
    set({ isLoading: true, error: null });

    try {
      const result = await window.levante.mcp.disconnectServer(serverId);

      if (result.success) {
        set(state => ({
          // DO NOT remove from activeServers, just mark as disabled
          activeServers: state.activeServers.map(server =>
            server.id === serverId
              ? { ...server, enabled: false }
              : server
          ),
          connectionStatus: {
            ...state.connectionStatus,
            [serverId]: 'disconnected'
          }
        }));
      } else {
        set({ error: result.error || 'Failed to disconnect from server' });
      }
    } catch (error) {
      console.error('Failed to disconnect server:', error);
      set({ error: 'Failed to disconnect from server' });
    } finally {
      set({ isLoading: false });
    }
  },

  // Test connection to a server
  testConnection: async (config: MCPServerConfig) => {
    try {
      const result = await window.levante.mcp.testConnection(config);
      return result.success;
    } catch (error) {
      console.error('Failed to test connection:', error);
      return false;
    }
  },

  // Add a new server
  addServer: async (config: MCPServerConfig) => {
    set({ isLoading: true, error: null });

    try {
      const result = await window.levante.mcp.addServer(config);

      if (result.success) {
        // Reload active servers
        await get().loadActiveServers();

        // Track MCP installation/activation
        window.levante.analytics?.trackMCP?.(config.name || config.id, 'active').catch(() => { });
      } else {
        set({ error: result.error || 'Failed to add server' });
      }
    } catch (error) {
      console.error('Failed to add server:', error);
      set({ error: 'Failed to add server' });
    } finally {
      set({ isLoading: false });
    }
  },

  // Update a server configuration
  updateServer: async (serverId: string, config: Partial<Omit<MCPServerConfig, 'id'>>) => {
    set({ isLoading: true, error: null });

    try {
      const result = await window.levante.mcp.updateServer(serverId, config);

      if (result.success) {
        // Update local state
        set(state => ({
          activeServers: state.activeServers.map(server =>
            server.id === serverId
              ? { ...server, ...config }
              : server
          )
        }));
      } else {
        set({ error: result.error || 'Failed to update server' });
      }
    } catch (error) {
      console.error('Failed to update server:', error);
      set({ error: 'Failed to update server' });
    } finally {
      set({ isLoading: false });
    }
  },

  // Remove a server
  removeServer: async (serverId: string) => {
    set({ isLoading: true, error: null });

    try {
      // First disconnect if connected
      await get().disconnectServer(serverId);

      // Get server info for analytics before removal
      const server = get().getServerById(serverId);

      const result = await window.levante.mcp.removeServer(serverId);

      if (result.success) {
        // Track MCP removal
        if (server) {
          window.levante.analytics?.trackMCP?.(server.name || server.id, 'removed').catch(() => { });
        }

        set(state => ({
          activeServers: state.activeServers.filter(s => s.id !== serverId),
          connectionStatus: {
            ...state.connectionStatus,
            [serverId]: 'disconnected'
          }
        }));
      } else {
        set({ error: result.error || 'Failed to remove server' });
      }
    } catch (error) {
      console.error('Failed to remove server:', error);
      set({ error: 'Failed to remove server' });
    } finally {
      set({ isLoading: false });
    }
  },

  // Import configuration
  importConfiguration: async (config: any) => {
    set({ isLoading: true, error: null });

    try {
      const result = await window.levante.mcp.importConfiguration(config);

      if (result.success) {
        // Reload everything
        await get().loadActiveServers();
      } else {
        set({ error: result.error || 'Failed to import configuration' });
      }
    } catch (error) {
      console.error('Failed to import configuration:', error);
      set({ error: 'Failed to import configuration' });
    } finally {
      set({ isLoading: false });
    }
  },

  // Export configuration
  exportConfiguration: async () => {
    try {
      const result = await window.levante.mcp.exportConfiguration();

      if (result.success) {
        return result.data;
      } else {
        set({ error: result.error || 'Failed to export configuration' });
        return null;
      }
    } catch (error) {
      console.error('Failed to export configuration:', error);
      set({ error: 'Failed to export configuration' });
      return null;
    }
  },

  // Helper: Check if server is active
  isServerActive: (serverId: string) => {
    const { activeServers } = get();
    return activeServers.some(server => server.id === serverId);
  },

  // Helper: Get server by ID
  getServerById: (serverId: string) => {
    const { activeServers } = get();
    return activeServers.find(server => server.id === serverId);
  },

  // Helper: Get registry entry by ID (searches all sources)
  getRegistryEntryById: (entryId: string) => {
    const { providerEntries } = get();

    // Check provider entries
    for (const entries of Object.values(providerEntries)) {
      const providerEntry = entries.find(entry => entry.id === entryId);
      if (providerEntry) return providerEntry;
    }

    return undefined;
  },

  // Load providers from IPC
  loadProviders: async () => {
    try {
      const result = await window.levante.mcp.providers.list();

      if (result.success && result.data) {
        set({ providers: result.data });
      }
    } catch (error) {
      console.error('Failed to load providers:', error);
    }
  },

  // Sync a specific provider
  syncProvider: async (providerId: string) => {
    set(state => ({
      loadingProviders: { ...state.loadingProviders, [providerId]: true }
    }));

    try {
      const result = await window.levante.mcp.providers.sync(providerId);

      if (result.success && result.data) {
        const entries = result.data.entries;
        set(state => ({
          providerEntries: {
            ...state.providerEntries,
            [providerId]: entries
          },
          loadingProviders: { ...state.loadingProviders, [providerId]: false },
          providerErrors: { ...state.providerErrors, [providerId]: null } // ✅ Limpiar error
        }));

        // Reload providers to get updated serverCount
        await get().loadProviders();
      } else {
        // ✅ Error no crítico: guardar en providerErrors en lugar de error global
        set(state => ({
          loadingProviders: { ...state.loadingProviders, [providerId]: false },
          providerErrors: {
            ...state.providerErrors,
            [providerId]: result.error || 'Failed to sync provider'
          }
        }));
      }
    } catch (error) {
      console.error('Failed to sync provider:', error);
      // ✅ Error no crítico: guardar en providerErrors
      set(state => ({
        loadingProviders: { ...state.loadingProviders, [providerId]: false },
        providerErrors: {
          ...state.providerErrors,
          [providerId]: error instanceof Error ? error.message : 'Failed to sync provider'
        }
      }));
    }
  },

  // Sync all enabled providers
  syncAllProviders: async () => {
    const { providers } = get();
    // Sync all enabled providers
    const enabledProviders = providers.filter(p => p.enabled);

    // ✅ Sincronizar todos los proveedores (incluso si algunos fallan)
    for (const provider of enabledProviders) {
      await get().syncProvider(provider.id);
      // Los errores se guardan en providerErrors, no se propagan
    }

    // ✅ Marcar como sincronizados
    set({ providersSynced: true });
  },

  // Set selected source filter (official/community)
  setSelectedSource: (source: MCPSource | 'all') => {
    set({ selectedSource: source });
  },

  // Set selected category filter
  setSelectedCategory: (category: MCPCategory | 'all') => {
    set({ selectedCategory: category });
  },

  // Clear provider error
  clearProviderError: (providerId: string) => {
    set(state => ({
      providerErrors: { ...state.providerErrors, [providerId]: null }
    }));
  },

  // Get filtered entries based on selected source and category
  getFilteredEntries: () => {
    const { selectedSource, selectedCategory, providerEntries } = get();
    let entries = Object.values(providerEntries).flat();

    // Filter by source (official/community)
    if (selectedSource !== 'all') {
      entries = entries.filter(entry => entry.source === selectedSource);
    }

    // Filter by category
    if (selectedCategory !== 'all') {
      entries = entries.filter(entry => entry.category === selectedCategory);
    }

    return entries;
  },

  // Get available sources from loaded entries
  getAvailableSources: (): MCPSource[] => {
    const { providerEntries } = get();
    const allEntries = Object.values(providerEntries).flat();
    const sources = new Set<MCPSource>();

    allEntries.forEach(entry => {
      if (entry.source) {
        sources.add(entry.source);
      }
    });

    return Array.from(sources).sort();
  },

  // Get available categories from loaded entries
  getAvailableCategories: (): MCPCategory[] => {
    const { providerEntries } = get();
    const allEntries = Object.values(providerEntries).flat();
    const categories = new Set<MCPCategory>();

    allEntries.forEach(entry => {
      if (entry.category) {
        categories.add(entry.category);
      }
    });

    return Array.from(categories).sort();
  }
}));