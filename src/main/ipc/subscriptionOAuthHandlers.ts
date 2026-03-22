import { ipcMain, BrowserWindow } from 'electron';
import { createServer, Server } from 'http';
import { getLogger } from '../services/logging';
import { getSubscriptionOAuthService } from '../services/subscription-oauth/SubscriptionOAuthService';
import {
  isSubscriptionOAuthProviderId,
  getProviderConfig,
  type SubscriptionOAuthProviderId,
} from '../services/subscription-oauth/providers';

const logger = getLogger();
const FLOW_TTL_MS = 10 * 60 * 1000;

const pendingFlows = new Map<
  SubscriptionOAuthProviderId,
  {
    codeVerifier: string;
    expectedState: string;
    startedAt: number;
  }
>();

/** Active local callback servers (one per provider at most). */
const callbackServers = new Map<SubscriptionOAuthProviderId, Server>();

/**
 * If the provider's redirectUri points to localhost we need a local HTTP server
 * to capture the authorization code that the IdP redirects to.
 */
function needsLocalCallbackServer(providerId: SubscriptionOAuthProviderId): boolean {
  const config = getProviderConfig(providerId);
  return config.redirectUri.startsWith('http://localhost');
}

function parseCallbackPort(providerId: SubscriptionOAuthProviderId): number {
  const config = getProviderConfig(providerId);
  const url = new URL(config.redirectUri);
  return parseInt(url.port, 10) || 80;
}

function parseCallbackPath(providerId: SubscriptionOAuthProviderId): string {
  const config = getProviderConfig(providerId);
  const url = new URL(config.redirectUri);
  return url.pathname;
}

async function startCallbackServer(
  providerId: SubscriptionOAuthProviderId,
): Promise<void> {
  // Stop any existing server for this provider
  await stopCallbackServer(providerId);

  const port = parseCallbackPort(providerId);
  const expectedPath = parseCallbackPath(providerId);

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '', `http://localhost:${port}`);

      // Only handle the expected callback path
      if (url.pathname !== expectedPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const errorDescription = url.searchParams.get('error_description');

      if (error) {
        logger.oauth.error(`${providerId} OAuth callback error`, { error, errorDescription });
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(buildHtmlPage('Authorization Failed', errorDescription || error, false));
        setTimeout(() => stopCallbackServer(providerId), 2000);
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(buildHtmlPage('Invalid Request', 'Missing authorization code.', false));
        return;
      }

      // We have the code — exchange it automatically
      logger.oauth.info(`${providerId} OAuth callback received code`, { codeLength: code.length });

      const flow = pendingFlows.get(providerId);
      if (!flow) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(buildHtmlPage('Flow Expired', 'No pending authorization flow. Please try again in Levante.', false));
        return;
      }

      try {
        const oauth = getSubscriptionOAuthService(providerId);
        // Build the full callback URL so parseAuthorizationInput can extract code+state
        const fullCallbackUrl = `${getProviderConfig(providerId).redirectUri}?${url.searchParams.toString()}`;
        await oauth.exchangeCode(fullCallbackUrl, flow.codeVerifier, flow.expectedState);
        pendingFlows.delete(providerId);

        logger.oauth.info(`${providerId} OAuth exchange successful via callback server`);

        // Send success page
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(buildHtmlPage('Authorization Successful!', 'You can close this window and return to Levante.', true));

        // Notify renderer
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          if (!win.isDestroyed()) {
            win.webContents.send('levante/subscription-oauth/callback', {
              success: true,
              providerId,
            });
            // Focus the main window
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
          }
        }
      } catch (exchangeError) {
        pendingFlows.delete(providerId);
        logger.oauth.error(`${providerId} OAuth exchange failed in callback server`, {
          error: exchangeError instanceof Error ? exchangeError.message : exchangeError,
        });
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(buildHtmlPage(
          'Exchange Failed',
          exchangeError instanceof Error ? exchangeError.message : 'Token exchange failed.',
          false,
        ));
      }

      // Stop server after a delay
      setTimeout(() => stopCallbackServer(providerId), 5000);
    });

    server.listen(port, 'localhost', () => {
      logger.oauth.info(`${providerId} callback server started on port ${port}`);
      callbackServers.set(providerId, server);
      resolve();
    });

    server.once('error', (err: NodeJS.ErrnoException) => {
      logger.oauth.error(`${providerId} callback server failed to start`, { error: err.message });
      reject(new Error(`Could not start callback server on port ${port}: ${err.message}`));
    });
  });
}

async function stopCallbackServer(providerId: SubscriptionOAuthProviderId): Promise<void> {
  const server = callbackServers.get(providerId);
  if (!server) return;
  return new Promise((resolve) => {
    server.close(() => {
      callbackServers.delete(providerId);
      logger.oauth.info(`${providerId} callback server stopped`);
      resolve();
    });
  });
}

function buildHtmlPage(title: string, message: string, success: boolean): string {
  const color = success ? '#22c55e' : '#ef4444';
  return `<!DOCTYPE html>
<html><head><title>${title}</title>
<style>
  :root{--bg:#fff;--fg:#111;--card:#fff;--muted:#666;--border:#e5e5e5}
  @media(prefers-color-scheme:dark){:root{--bg:#1e1e1e;--fg:#e0e0e0;--card:#2a2a2a;--muted:#999;--border:#444}}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:var(--bg);color:var(--fg)}
  .c{text-align:center;padding:2rem;background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.15);max-width:400px}
  h1{font-size:1.25rem;color:${color}}p{color:var(--muted);font-size:.9rem}
</style></head>
<body><div class="c"><h1>${title}</h1><p>${message}</p></div>
<script>setTimeout(()=>window.close(),3000)</script>
</body></html>`;
}

export function setupSubscriptionOAuthHandlers(): void {
  const channels = ['start', 'exchange', 'status', 'disconnect'] as const;
  for (const ch of channels) {
    ipcMain.removeHandler(`levante/subscription-oauth/${ch}`);
  }

  ipcMain.handle(
    'levante/subscription-oauth/start',
    async (_, { providerId }: { providerId: string }) => {
      try {
        if (!isSubscriptionOAuthProviderId(providerId)) {
          return { success: false, error: `Unsupported provider: ${providerId}` };
        }

        // If the provider needs a local callback server, start it before opening the browser
        if (needsLocalCallbackServer(providerId)) {
          await startCallbackServer(providerId);
        }

        const oauth = getSubscriptionOAuthService(providerId);
        const result = await oauth.startAuthorizationFlow();

        pendingFlows.set(providerId, {
          codeVerifier: result.codeVerifier,
          expectedState: result.expectedState,
          startedAt: Date.now(),
        });

        return { success: true, authUrl: result.authUrl };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'levante/subscription-oauth/exchange',
    async (_, { providerId, code }: { providerId: string; code: string }) => {
      try {
        if (!isSubscriptionOAuthProviderId(providerId)) {
          return { success: false, error: `Unsupported provider: ${providerId}` };
        }

        const flow = pendingFlows.get(providerId);
        if (!flow) {
          return {
            success: false,
            error: 'No pending authorization flow. Please start again.',
          };
        }

        if (Date.now() - flow.startedAt > FLOW_TTL_MS) {
          pendingFlows.delete(providerId);
          return {
            success: false,
            error: 'Authorization flow expired. Please start again.',
          };
        }

        const oauth = getSubscriptionOAuthService(providerId);
        await oauth.exchangeCode(code, flow.codeVerifier, flow.expectedState);

        pendingFlows.delete(providerId);
        return { success: true };
      } catch (error) {
        if (isSubscriptionOAuthProviderId(providerId)) {
          pendingFlows.delete(providerId);
        }

        logger.oauth.error(`${providerId} OAuth exchange failed`, {
          error: error instanceof Error ? error.message : error,
        });

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'levante/subscription-oauth/status',
    async (_, { providerId }: { providerId: string }) => {
      try {
        if (!isSubscriptionOAuthProviderId(providerId)) {
          return { success: false, error: `Unsupported provider: ${providerId}` };
        }

        const oauth = getSubscriptionOAuthService(providerId);
        const status = await oauth.getStatus();
        return { success: true, data: status };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'levante/subscription-oauth/disconnect',
    async (_, { providerId }: { providerId: string }) => {
      try {
        if (!isSubscriptionOAuthProviderId(providerId)) {
          return { success: false, error: `Unsupported provider: ${providerId}` };
        }

        const oauth = getSubscriptionOAuthService(providerId);
        await oauth.disconnect();
        pendingFlows.delete(providerId);
        await stopCallbackServer(providerId);

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );
}
