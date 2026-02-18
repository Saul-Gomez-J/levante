import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { logger } from '@/services/logger';
import { useOAuthStore } from '@/stores/oauthStore';

const LEVANTE_PLATFORM_SERVER_ID = 'levante-platform';
const LEVANTE_PLATFORM_DEFAULT_URL = 'https://platform.levante.ai';

interface UseLevantePlatformOAuthOptions {
  onSuccess?: () => void;
  onError?: (error: string) => void;
  /** Override base URL for local development */
  baseUrl?: string;
}

/**
 * Hook for Levante Platform OAuth using RFC 8414 Discovery
 *
 * Uses the existing MCP OAuth infrastructure which handles:
 * - RFC 8414 OAuth Discovery
 * - RFC 7591 Dynamic Client Registration (DCR)
 * - PKCE (S256)
 * - Token refresh
 */
export function useLevantePlatformOAuth(options: UseLevantePlatformOAuthOptions = {}) {
  const { onSuccess, onError, baseUrl = LEVANTE_PLATFORM_DEFAULT_URL } = options;
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const {
    servers,
    authorize,
    disconnect,
    refreshStatus,
    loading,
    errors
  } = useOAuthStore();

  const serverStatus = servers[LEVANTE_PLATFORM_SERVER_ID];
  const isLoading = loading[LEVANTE_PLATFORM_SERVER_ID] || false;
  const error = errors[LEVANTE_PLATFORM_SERVER_ID] || null;
  const isConnected = serverStatus?.hasTokens && serverStatus?.isTokenValid;

  // Load status on mount
  useEffect(() => {
    refreshStatus(LEVANTE_PLATFORM_SERVER_ID).catch(() => {
      // Silently ignore - no tokens yet is expected
    });
  }, [refreshStatus]);

  const initiateOAuthFlow = async () => {
    try {
      setIsAuthenticating(true);
      logger.core.info('Initiating Levante Platform OAuth flow');

      toast.info('Connecting to Levante Platform', {
        description: 'Opening authorization in your browser...',
        duration: 10000
      });

      // Use the existing MCP OAuth infrastructure
      // This handles RFC 8414 discovery, DCR, and PKCE automatically
      await authorize({
        serverId: LEVANTE_PLATFORM_SERVER_ID,
        mcpServerUrl: baseUrl,
        scopes: ['openid', 'email'],  // Levante Platform uses OpenID scopes
      });

      logger.core.info('Levante Platform OAuth completed successfully');

      toast.success('Connected to Levante Platform!', {
        description: 'Your account has been connected',
        duration: 5000
      });

      onSuccess?.();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to authenticate';
      logger.core.error('Levante Platform OAuth failed', { error: errorMessage });

      toast.error('Authentication failed', {
        description: errorMessage,
        duration: 5000
      });

      onError?.(errorMessage);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const disconnectOAuth = async () => {
    try {
      setIsAuthenticating(true);
      logger.core.info('Disconnecting from Levante Platform');

      await disconnect(LEVANTE_PLATFORM_SERVER_ID, true);

      toast.success('Disconnected from Levante Platform', {
        duration: 3000
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to disconnect';
      logger.core.error('Levante Platform disconnect failed', { error: errorMessage });

      toast.error('Disconnect failed', {
        description: errorMessage,
        duration: 5000
      });
    } finally {
      setIsAuthenticating(false);
    }
  };

  return {
    isAuthenticating: isAuthenticating || isLoading,
    isConnected,
    serverStatus,
    error,
    initiateOAuthFlow,
    disconnectOAuth,
  };
}
