import { ipcRenderer } from 'electron';
import type { DeepLinkAction } from '../types';

export const appApi = {
  getVersion: () => ipcRenderer.invoke('levante/app/version'),
  getPlatform: () => ipcRenderer.invoke('levante/app/platform'),
  getSystemTheme: () => ipcRenderer.invoke('levante/app/theme'),
  onSystemThemeChanged: (callback: (theme: { shouldUseDarkColors: boolean; themeSource: string }) => void) => {
    const listener = (_event: any, theme: { shouldUseDarkColors: boolean; themeSource: string }) => {
      callback(theme);
    };
    ipcRenderer.on('levante/app/theme-changed', listener);

    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('levante/app/theme-changed', listener);
    };
  },

  checkForUpdates: () => ipcRenderer.invoke('levante/app/check-for-updates'),

  openExternal: (url: string) => ipcRenderer.invoke('levante/app/open-external', url),

  onDeepLink: (callback: (action: DeepLinkAction) => void) => {
    const listener = (_event: any, action: DeepLinkAction) => {
      callback(action);
    };
    ipcRenderer.on('levante/deep-link/action', listener);

    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('levante/deep-link/action', listener);
    };
  },

  // OAuth callback server
  oauth: {
    // ========================================
    // MCP OAuth Methods
    // ========================================

    // Authorize OAuth flow
    authorize: (params: {
      serverId: string;
      mcpServerUrl: string;
      scopes?: string[];
      clientId?: string;
      wwwAuthHeader?: string;
    }) =>
      ipcRenderer.invoke('levante/oauth/authorize', params) as Promise<{
        success: boolean;
        error?: string;
        tokens?: {
          expiresAt: number;
          scope?: string;
        };
      }>,

    // Disconnect and revoke
    disconnect: (params: { serverId: string; revokeTokens?: boolean }) =>
      ipcRenderer.invoke('levante/oauth/disconnect', params) as Promise<{
        success: boolean;
        error?: string;
      }>,

    // Get status
    status: (params: { serverId: string }) =>
      ipcRenderer.invoke('levante/oauth/status', params) as Promise<{
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
      }>,

    // Refresh token
    refresh: (params: { serverId: string }) =>
      ipcRenderer.invoke('levante/oauth/refresh', params) as Promise<{
        success: boolean;
        error?: string;
        tokens?: {
          expiresAt: number;
          scope?: string;
        };
      }>,

    // List OAuth servers
    list: () =>
      ipcRenderer.invoke('levante/oauth/list') as Promise<{
        success: boolean;
        data?: Array<{
          serverId: string;
          hasConfig: boolean;
          hasTokens: boolean;
          isTokenValid: boolean;
        }>;
        error?: string;
      }>,

    // Listen for OAuth required events triggered by 401 responses
    onOAuthRequired: (
      callback: (data: {
        serverId: string;
        mcpServerUrl: string;
        wwwAuth: string;
      }) => void
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('levante/oauth/required', handler);

      return () => {
        ipcRenderer.removeListener('levante/oauth/required', handler);
      };
    },

    // ========================================
    // OpenRouter OAuth Methods
    // ========================================

    // Start local OAuth callback server
    startServer: () => ipcRenderer.invoke('levante/oauth/start-server'),

    // Stop OAuth callback server
    stopServer: () => ipcRenderer.invoke('levante/oauth/stop-server'),

    // Listen for OAuth callbacks
    onCallback: (callback: (data: { success: boolean; provider?: string; code?: string; error?: string }) => void) => {
      const listener = (_event: any, data: any) => {
        callback(data);
      };
      ipcRenderer.on('levante/oauth/callback', listener);

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener('levante/oauth/callback', listener);
      };
    },
  },
};
