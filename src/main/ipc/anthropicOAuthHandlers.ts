import { ipcMain } from 'electron';
import { getLogger } from '../services/logging';
import { getAnthropicOAuthService } from '../services/anthropic/AnthropicOAuthService';

const logger = getLogger();
const FLOW_TTL_MS = 10 * 60 * 1000;

let pendingFlow:
  | {
      codeVerifier: string;
      expectedState: string;
      startedAt: number;
      mode: 'max' | 'console';
    }
  | undefined;

export function setupAnthropicOAuthHandlers(): void {
  const oauth = getAnthropicOAuthService();

  ipcMain.removeHandler('levante/anthropic/oauth/start');
  ipcMain.removeHandler('levante/anthropic/oauth/exchange');
  ipcMain.removeHandler('levante/anthropic/oauth/status');
  ipcMain.removeHandler('levante/anthropic/oauth/disconnect');

  ipcMain.handle('levante/anthropic/oauth/start', async (_, { mode }: { mode: 'max' | 'console' }) => {
    try {
      const result = await oauth.startAuthorizationFlow(mode);
      pendingFlow = {
        codeVerifier: result.codeVerifier,
        expectedState: result.expectedState,
        startedAt: Date.now(),
        mode,
      };
      return { success: true, authUrl: result.authUrl };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('levante/anthropic/oauth/exchange', async (_, { code }: { code: string }) => {
    try {
      if (!pendingFlow) {
        return { success: false, error: 'No pending authorization flow. Please start again.' };
      }

      if (Date.now() - pendingFlow.startedAt > FLOW_TTL_MS) {
        pendingFlow = undefined;
        return { success: false, error: 'Authorization flow expired. Please start again.' };
      }

      await oauth.exchangeCode(code, pendingFlow.codeVerifier, pendingFlow.expectedState);
      pendingFlow = undefined;
      return { success: true };
    } catch (error) {
      pendingFlow = undefined;
      logger.oauth.error('Anthropic OAuth exchange failed', {
        error: error instanceof Error ? error.message : error,
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('levante/anthropic/oauth/status', async () => {
    try {
      const status = await oauth.getStatus();
      return { success: true, data: status };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('levante/anthropic/oauth/disconnect', async () => {
    try {
      await oauth.disconnect();
      pendingFlow = undefined;
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
