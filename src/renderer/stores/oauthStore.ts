import { create } from 'zustand';
import { logger } from '@/services/logger';

/**
 * OAuth Server Status
 */
export interface OAuthServerStatus {
    serverId: string;
    hasConfig: boolean;
    hasTokens: boolean;
    isTokenValid: boolean;
    expiresAt?: number;
    scopes?: string[];
    authServerId?: string;
}

/**
 * OAuth Store State
 */
interface OAuthState {
    // Estado
    servers: Record<string, OAuthServerStatus>;
    loading: Record<string, boolean>;
    errors: Record<string, string | null>;
    pendingAuth: {
        serverId: string;
        mcpServerUrl: string;
        wwwAuth: string;
    } | null;
    autoAuthorizeFromRequired: (params: {
        serverId: string;
        mcpServerUrl: string;
        wwwAuth: string;
    }) => Promise<void>;

    // Actions
    authorize: (params: {
        serverId: string;
        mcpServerUrl: string;
        scopes?: string[];
        clientId?: string;
        wwwAuthHeader?: string;
    }) => Promise<void>;

    disconnect: (serverId: string, revokeTokens?: boolean) => Promise<void>;

    refreshStatus: (serverId: string) => Promise<void>;

    refreshToken: (serverId: string) => Promise<void>;

    loadAllServers: () => Promise<void>;

    clearError: (serverId: string) => void;

    handleOAuthRequired: (params: {
        serverId: string;
        mcpServerUrl: string;
        wwwAuth: string;
    }) => void;
    clearPendingAuth: () => void;
}

/**
 * OAuth Zustand Store
 */
export const useOAuthStore = create<OAuthState>((set, get) => ({
    servers: {},
    loading: {},
    errors: {},
    pendingAuth: null,
    autoAuthorizeFromRequired: async (params) => {
        const { serverId, mcpServerUrl, wwwAuth } = params;
        logger.oauth.info('Starting automatic OAuth authorization', { serverId });

        try {
            await useOAuthStore.getState().authorize({
                serverId,
                mcpServerUrl,
                scopes: undefined, // backend will pick parsed scopes or defaults
                clientId: undefined, // force DCR if none provided
                wwwAuthHeader: wwwAuth,
            });
        } catch (error) {
            logger.oauth.error('Automatic OAuth authorization failed', {
                serverId,
                error: error instanceof Error ? error.message : error,
            });
        }
    },

    /**
     * Start OAuth authorization flow
     */
    authorize: async (params) => {
        const { serverId } = params;

        set((state) => ({
            loading: { ...state.loading, [serverId]: true },
            errors: { ...state.errors, [serverId]: null },
        }));

        try {
            const result = await window.levante.oauth.authorize(params);

            if (!result.success) {
                throw new Error(result.error || 'Authorization failed');
            }

            // Refresh status after authorization
            await get().refreshStatus(serverId);

            set({ pendingAuth: null });
        } catch (error) {
            set((state) => ({
                errors: {
                    ...state.errors,
                    [serverId]: error instanceof Error ? error.message : 'Unknown error',
                },
            }));
            throw error;
        } finally {
            set((state) => ({
                loading: { ...state.loading, [serverId]: false },
            }));
        }
    },

    /**
     * Disconnect OAuth server and revoke tokens
     */
    disconnect: async (serverId, revokeTokens = true) => {
        set((state) => ({
            loading: { ...state.loading, [serverId]: true },
            errors: { ...state.errors, [serverId]: null },
        }));

        try {
            const result = await window.levante.oauth.disconnect({
                serverId,
                revokeTokens,
            });

            if (!result.success) {
                throw new Error(result.error || 'Disconnect failed');
            }

            // Remove from state
            set((state) => {
                const newServers = { ...state.servers };
                delete newServers[serverId];
                return { servers: newServers };
            });
        } catch (error) {
            set((state) => ({
                errors: {
                    ...state.errors,
                    [serverId]: error instanceof Error ? error.message : 'Unknown error',
                },
            }));
            throw error;
        } finally {
            set((state) => ({
                loading: { ...state.loading, [serverId]: false },
            }));
        }
    },

    /**
     * Refresh status for a server
     */
    refreshStatus: async (serverId) => {
        set((state) => ({
            loading: { ...state.loading, [serverId]: true },
            errors: { ...state.errors, [serverId]: null },
        }));

        try {
            const result = await window.levante.oauth.status({ serverId });

            if (!result.success || !result.data) {
                throw new Error(result.error || 'Failed to get status');
            }

            set((state) => ({
                servers: {
                    ...state.servers,
                    [serverId]: {
                        serverId,
                        ...result.data!,
                    },
                },
            }));
        } catch (error) {
            set((state) => ({
                errors: {
                    ...state.errors,
                    [serverId]: error instanceof Error ? error.message : 'Unknown error',
                },
            }));
        } finally {
            set((state) => ({
                loading: { ...state.loading, [serverId]: false },
            }));
        }
    },

    /**
     * Force refresh token
     */
    refreshToken: async (serverId) => {
        set((state) => ({
            loading: { ...state.loading, [serverId]: true },
            errors: { ...state.errors, [serverId]: null },
        }));

        try {
            const result = await window.levante.oauth.refresh({ serverId });

            if (!result.success) {
                throw new Error(result.error || 'Token refresh failed');
            }

            // Refresh status
            await get().refreshStatus(serverId);
        } catch (error) {
            set((state) => ({
                errors: {
                    ...state.errors,
                    [serverId]: error instanceof Error ? error.message : 'Unknown error',
                },
            }));
            throw error;
        } finally {
            set((state) => ({
                loading: { ...state.loading, [serverId]: false },
            }));
        }
    },

    /**
     * Load all OAuth-enabled servers
     */
    loadAllServers: async () => {
        try {
            const result = await window.levante.oauth.list();

            if (!result.success || !result.data) {
                throw new Error(result.error || 'Failed to load servers');
            }

            // Update state
            const servers: Record<string, OAuthServerStatus> = {};
            for (const server of result.data) {
                servers[server.serverId] = server;
            }

            set({ servers });
        } catch (error) {
            logger.oauth.error('Failed to load OAuth servers', {
                error: error instanceof Error ? error.message : error
            });
        }
    },

    /**
     * Clear error for a server
     */
    clearError: (serverId) => {
        set((state) => ({
            errors: { ...state.errors, [serverId]: null },
        }));
    },

    /**
     * Handle OAuth required event from backend (401 detected)
     */
    handleOAuthRequired: (params) => {
        const { serverId } = params;

        logger.oauth.info('OAuth required for server', { serverId });

        set((state) => ({
            pendingAuth: params,
            errors: { ...state.errors, [serverId]: null },
        }));

        // Start authorization automatically (headless)
        void get().autoAuthorizeFromRequired(params);
    },

    clearPendingAuth: () => set({ pendingAuth: null }),
}));

// Register global listener for OAuth required events from main process
if (typeof window !== 'undefined' && (window as any).levante?.oauth) {
    window.levante.oauth.onOAuthRequired((data) => {
        useOAuthStore.getState().handleOAuthRequired(data);
    });
}
