/**
 * OAuth IPC Handlers Module (Fase 6 - Completo)
 *
 * Handles:
 * - OAuth authorization flow
 * - Token management
 * - Connection status
 * - Token refresh
 * - Server disconnection with revocation
 */

import { ipcMain } from 'electron';
import { getLogger } from '../services/logging';
import { OAuthService } from '../services/oauth';
import { PreferencesService } from '../services/preferencesService';
import { oauthCallbackServer } from '../services/oauthCallbackServer';

const logger = getLogger();

// Singleton instances
let oauthService: OAuthService;
let preferencesService: PreferencesService;

/**
 * Initialize services
 */
async function initializeServices(): Promise<void> {
  if (!preferencesService) {
    preferencesService = new PreferencesService();
    await preferencesService.initialize();
  }

  if (!oauthService) {
    oauthService = new OAuthService(preferencesService);
  }
}

/**
 * Register all OAuth-related IPC handlers
 */
export function setupOAuthHandlers(): void {
  // ========================================
  // MCP OAuth Handlers
  // ========================================

  // Authorize (start OAuth flow)
  ipcMain.handle('levante/oauth/authorize', handleAuthorize);

  // Disconnect (revoke tokens)
  ipcMain.handle('levante/oauth/disconnect', handleDisconnect);

  // Get status
  ipcMain.handle('levante/oauth/status', handleStatus);

  // Refresh token manually
  ipcMain.handle('levante/oauth/refresh', handleRefresh);

  // List OAuth servers
  ipcMain.handle('levante/oauth/list', handleList);

  // ========================================
  // OpenRouter OAuth Handlers
  // ========================================

  // Start OAuth callback server
  ipcMain.handle('levante/oauth/start-server', handleStartServer);

  // Stop OAuth callback server
  ipcMain.handle('levante/oauth/stop-server', handleStopServer);

  logger.core.info('OAuth handlers registered successfully (MCP + OpenRouter)');
}

/**
 * Start OAuth authorization flow
 */
async function handleAuthorize(
  _event: any,
  params: {
    serverId: string;
    mcpServerUrl: string;
    scopes?: string[];
    clientId?: string;
    wwwAuthHeader?: string;
  }
): Promise<{
  success: boolean;
  error?: string;
  tokens?: any;
}> {
  try {
    await initializeServices();

    logger.core.info('IPC: Starting OAuth authorization', {
      serverId: params.serverId,
      url: params.mcpServerUrl,
      hasWWWAuth: !!params.wwwAuthHeader,
    });

    const result = await oauthService.authorize({
      serverId: params.serverId,
      mcpServerUrl: params.mcpServerUrl,
      scopes: params.scopes,
      clientId: params.clientId,
      wwwAuthHeader: params.wwwAuthHeader,
    });

    if (result.success) {
      logger.core.info('IPC: OAuth authorization successful', {
        serverId: params.serverId,
      });

      return {
        success: true,
        tokens: {
          expiresAt: result.tokens?.expiresAt,
          scope: result.tokens?.scope,
        },
      };
    } else {
      logger.core.error('IPC: OAuth authorization failed', {
        serverId: params.serverId,
        error: result.error,
      });

      return {
        success: false,
        error: result.error,
      };
    }
  } catch (error) {
    logger.core.error('IPC: OAuth authorization error', {
      serverId: params.serverId,
      error: error instanceof Error ? error.message : error,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Disconnect OAuth server and revoke tokens
 */
async function handleDisconnect(
  _event: any,
  params: {
    serverId: string;
    revokeTokens?: boolean;
  }
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    await initializeServices();

    logger.core.info('IPC: Disconnecting OAuth server', {
      serverId: params.serverId,
      revokeTokens: params.revokeTokens,
    });

    await oauthService.disconnect({
      serverId: params.serverId,
      revokeTokens: params.revokeTokens ?? true,
    });

    logger.core.info('IPC: OAuth server disconnected', {
      serverId: params.serverId,
    });

    return { success: true };
  } catch (error) {
    logger.core.error('IPC: OAuth disconnect error', {
      serverId: params.serverId,
      error: error instanceof Error ? error.message : error,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get OAuth status for a server
 */
async function handleStatus(
  _event: any,
  params: { serverId: string }
): Promise<{
  success: boolean;
  data?: {
    hasConfig: boolean;
    hasTokens: boolean;
    isTokenValid: boolean;
    expiresAt?: number;
    scopes?: string[];
    authServerId?: string;
  };
  error?: string;
}> {
  try {
    await initializeServices();

    const hasConfig = await oauthService.hasValidConfig(params.serverId);
    const hasTokens = await oauthService.hasValidTokens(params.serverId);

    // Get additional details
    const tokens = await (oauthService as any).tokenStore.getTokens(params.serverId);
    const config = (await preferencesService.get(
      `mcpServers.${params.serverId}.oauth`
    )) as any;

    const isTokenValid = tokens
      ? !(oauthService as any).tokenStore.isTokenExpired(tokens)
      : false;

    return {
      success: true,
      data: {
        hasConfig,
        hasTokens,
        isTokenValid,
        expiresAt: tokens?.expiresAt,
        scopes: config?.scopes,
        authServerId: config?.authServerId,
      },
    };
  } catch (error) {
    logger.core.error('IPC: OAuth status error', {
      serverId: params.serverId,
      error: error instanceof Error ? error.message : error,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Force refresh OAuth token
 */
async function handleRefresh(
  _event: any,
  params: { serverId: string }
): Promise<{
  success: boolean;
  error?: string;
  tokens?: any;
}> {
  try {
    await initializeServices();

    logger.core.info('IPC: Refreshing OAuth token', {
      serverId: params.serverId,
    });

    const tokens = await oauthService.ensureValidToken(params.serverId);

    logger.core.info('IPC: OAuth token refreshed', {
      serverId: params.serverId,
    });

    return {
      success: true,
      tokens: {
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
      },
    };
  } catch (error) {
    logger.core.error('IPC: OAuth refresh error', {
      serverId: params.serverId,
      error: error instanceof Error ? error.message : error,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * List all OAuth-enabled servers
 */
async function handleList(): Promise<{
  success: boolean;
  data?: Array<{
    serverId: string;
    hasConfig: boolean;
    hasTokens: boolean;
    isTokenValid: boolean;
  }>;
  error?: string;
}> {
  try {
    await initializeServices();

    const mcpServers = (await preferencesService.get('mcpServers')) as Record<string, any> || {};
    const oauthServers = [];

    for (const [serverId, config] of Object.entries(mcpServers)) {
      if (config.oauth?.enabled) {
        const hasConfig = await oauthService.hasValidConfig(serverId);
        const hasTokens = await oauthService.hasValidTokens(serverId);
        const tokens = await (oauthService as any).tokenStore.getTokens(serverId);
        const isTokenValid = tokens
          ? !(oauthService as any).tokenStore.isTokenExpired(tokens)
          : false;

        oauthServers.push({
          serverId,
          hasConfig,
          hasTokens,
          isTokenValid,
        });
      }
    }

    return {
      success: true,
      data: oauthServers,
    };
  } catch (error) {
    logger.core.error('IPC: OAuth list error', {
      error: error instanceof Error ? error.message : error,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * ============================================================================
 * OpenRouter OAuth Handlers
 * ============================================================================
 * Start the local OAuth callback server for OpenRouter
 */
async function handleStartServer(): Promise<{
  success: boolean;
  port?: number;
  callbackUrl?: string;
  error?: string;
}> {
  try {
    logger.core.info('Starting OAuth callback server');
    const result = await oauthCallbackServer.start();
    logger.core.info('OAuth callback server started', result);
    return { success: true, ...result };
  } catch (error) {
    logger.core.error('Error starting OAuth callback server', {
      error: error instanceof Error ? error.message : error,
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Stop the OAuth callback server
 */
async function handleStopServer(): Promise<{ success: boolean; error?: string }> {
  try {
    logger.core.info('Stopping OAuth callback server');
    await oauthCallbackServer.stop();
    return { success: true };
  } catch (error) {
    logger.core.error('Error stopping OAuth callback server', {
      error: error instanceof Error ? error.message : error,
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
