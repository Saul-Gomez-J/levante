import { create } from 'zustand';
import { MCPRegistry, MCPServerConfig, MCPConnectionStatus, MCPProvider, MCPRegistryEntry } from '../types/mcp';
import mcpRegistryData from '../data/mcpRegistry.json';
import mcpProvidersData from '../data/mcpProviders.json';

interface SystemDiagnosis {
  success: boolean;
  issues: string[];
  recommendations: string[];
  lastChecked: number | null;
}

interface MCPStore {
  // State
  registry: MCPRegistry;
  activeServers: MCPServerConfig[];
  connectionStatus: Record<string, MCPConnectionStatus>;
  isLoading: boolean;
  error: string | null;
  systemDiagnosis: SystemDiagnosis;

  // Provider state
  providers: MCPProvider[];
  selectedProvider: string | 'all';
  loadingProviders: Record<string, boolean>;
  providerEntries: Record<string, MCPRegistryEntry[]>;

  // Actions
  loadRegistry: () => void;
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
  diagnoseSystem: () => Promise<void>;

  // Provider actions
  loadProviders: () => Promise<void>;
  syncProvider: (providerId: string) => Promise<void>;
  syncAllProviders: () => Promise<void>;
  setSelectedProvider: (providerId: string | 'all') => void;

  // Helper methods
  isServerActive: (serverId: string) => boolean;
  getServerById: (serverId: string) => MCPServerConfig | undefined;
  getRegistryEntryById: (entryId: string) => any;
  getFilteredEntries: () => MCPRegistryEntry[];
}

export const useMCPStore = create<MCPStore>((set, get) => ({
  // Initial state
  registry: mcpRegistryData as MCPRegistry,
  activeServers: [],
  connectionStatus: {},
  isLoading: false,
  error: null,
  systemDiagnosis: {
    success: true,
    issues: [],
    recommendations: [],
    lastChecked: null,
  },

  // Provider initial state
  providers: mcpProvidersData.providers as MCPProvider[],
  selectedProvider: 'all',
  loadingProviders: {},
  providerEntries: {},

  // Load curated registry from JSON
  loadRegistry: () => {
    try {
      set({ registry: mcpRegistryData as MCPRegistry });
    } catch (error) {
      console.error('Failed to load MCP registry:', error);
      set({ error: 'Failed to load MCP registry' });
    }
  },

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
      
      const result = await window.levante.mcp.removeServer(serverId);
      
      if (result.success) {
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
    const { registry, providerEntries } = get();

    // First check local registry
    const localEntry = registry.entries.find(entry => entry.id === entryId);
    if (localEntry) return localEntry;

    // Then check provider entries
    for (const entries of Object.values(providerEntries)) {
      const providerEntry = entries.find(entry => entry.id === entryId);
      if (providerEntry) return providerEntry;
    }

    return undefined;
  },

  // Diagnose system for MCP compatibility
  diagnoseSystem: async () => {
    try {
      const result = await window.levante.mcp.diagnoseSystem();

      if (result.success && result.data) {
        set({
          systemDiagnosis: {
            success: result.data.success,
            issues: result.data.issues,
            recommendations: result.data.recommendations,
            lastChecked: Date.now(),
          }
        });
      } else {
        console.error('Failed to diagnose system:', result.error);
      }
    } catch (error) {
      console.error('Failed to diagnose system:', error);
    }
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
          loadingProviders: { ...state.loadingProviders, [providerId]: false }
        }));

        // Reload providers to get updated serverCount
        await get().loadProviders();
      } else {
        set(state => ({
          loadingProviders: { ...state.loadingProviders, [providerId]: false },
          error: result.error || 'Failed to sync provider'
        }));
      }
    } catch (error) {
      console.error('Failed to sync provider:', error);
      set(state => ({
        loadingProviders: { ...state.loadingProviders, [providerId]: false },
        error: 'Failed to sync provider'
      }));
    }
  },

  // Sync all enabled providers
  syncAllProviders: async () => {
    const { providers } = get();
    const enabledProviders = providers.filter(p => p.enabled);

    for (const provider of enabledProviders) {
      await get().syncProvider(provider.id);
    }
  },

  // Set selected provider filter
  setSelectedProvider: (providerId: string | 'all') => {
    set({ selectedProvider: providerId });
  },

  // Get filtered entries based on selected provider
  getFilteredEntries: () => {
    const { registry, selectedProvider, providerEntries } = get();

    if (selectedProvider === 'all') {
      // Combine all entries from registry and provider entries
      const allEntries: MCPRegistryEntry[] = [
        ...registry.entries.map(entry => ({ ...entry, source: entry.source || 'levante' }))
      ];

      // Add entries from other providers
      for (const [providerId, entries] of Object.entries(providerEntries)) {
        if (providerId !== 'levante') {
          allEntries.push(...entries);
        }
      }

      return allEntries;
    }

    // Return entries for specific provider
    if (selectedProvider === 'levante') {
      return registry.entries.map(entry => ({ ...entry, source: 'levante' }));
    }

    return providerEntries[selectedProvider] || [];
  }
}));