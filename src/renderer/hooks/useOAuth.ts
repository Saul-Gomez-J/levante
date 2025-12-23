import { useEffect } from 'react';
import { useOAuthStore } from '@/stores/oauthStore';

/**
 * Hook personalizado para gestionar OAuth
 *
 * Simplifica el uso del store de OAuth en componentes
 */
export function useOAuth(serverId?: string) {
    const store = useOAuthStore();

    // Auto-load on mount
    useEffect(() => {
        store.loadAllServers();
    }, []);

    // Auto-refresh status for specific server
    useEffect(() => {
        if (serverId) {
            store.refreshStatus(serverId);
        }
    }, [serverId, store.refreshStatus]);

    return {
        // State
        servers: store.servers,
        loading: store.loading,
        errors: store.errors,

        // Current server (if provided)
        server: serverId ? store.servers[serverId] : undefined,
        isLoading: serverId ? store.loading[serverId] : false,
        error: serverId ? store.errors[serverId] : undefined,

        // Actions
        authorize: store.authorize,
        disconnect: store.disconnect,
        refresh: store.refreshToken,
        refreshStatus: store.refreshStatus,
        clearError: store.clearError,
        loadAll: store.loadAllServers,
    };
}
