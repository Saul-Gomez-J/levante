import * as http from 'http';
import * as net from 'net';
import { getLogger } from '../logging';
import type {
    LoopbackServerConfig,
    LoopbackServerResult,
    AuthorizationCallback,
} from './types';
import { OAuthFlowError } from './types';

/**
 * OAuthRedirectServer
 *
 * Servidor HTTP loopback (127.0.0.1) para recibir callback de OAuth
 * - Puerto aleatorio para evitar conflictos
 * - Timeout configurable (default: 5 minutos)
 * - Respuesta HTML amigable al usuario
 */
export class OAuthRedirectServer {
    private logger = getLogger();
    private server?: http.Server;
    private port?: number;
    private callbackPromise?: Promise<AuthorizationCallback>;
    private resolveCallback?: (value: AuthorizationCallback) => void;
    private rejectCallback?: (error: Error) => void;
    private timeoutHandle?: NodeJS.Timeout;

    private readonly DEFAULT_CONFIG: Required<LoopbackServerConfig> = {
        port: 0, // 0 = random port
        hostname: '127.0.0.1',
        callbackPath: '/callback',
        timeout: 5 * 60 * 1000, // 5 minutos
    };

    /**
     * Inicia el servidor loopback
     * Retorna el puerto y redirect_uri
     */
    async start(
        config: LoopbackServerConfig = {}
    ): Promise<LoopbackServerResult> {
        const finalConfig = { ...this.DEFAULT_CONFIG, ...config };

        try {
            // Encontrar puerto disponible
            this.port = await this.findAvailablePort(finalConfig.port);

            this.logger.oauth.info('Starting OAuth redirect server', {
                port: this.port,
                hostname: finalConfig.hostname,
            });

            // Crear promise para callback
            this.callbackPromise = new Promise<AuthorizationCallback>(
                (resolve, reject) => {
                    this.resolveCallback = resolve;
                    this.rejectCallback = reject;

                    // Timeout
                    this.timeoutHandle = setTimeout(() => {
                        reject(
                            new OAuthFlowError(
                                'OAuth callback timeout - user did not complete authorization',
                                'CALLBACK_TIMEOUT',
                                { timeout: finalConfig.timeout }
                            )
                        );
                        this.stop();
                    }, finalConfig.timeout);
                }
            );

            // Crear servidor HTTP
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res, finalConfig.callbackPath);
            });

            // Iniciar servidor
            await new Promise<void>((resolve, reject) => {
                this.server!.listen(this.port, finalConfig.hostname, () => {
                    this.logger.oauth.debug('OAuth redirect server listening', {
                        port: this.port,
                    });
                    resolve();
                });

                this.server!.on('error', (error) => {
                    this.logger.oauth.error('OAuth redirect server error', {
                        error: error.message,
                    });
                    reject(
                        new OAuthFlowError(
                            'Failed to start loopback server',
                            'LOOPBACK_SERVER_FAILED',
                            { error: error.message }
                        )
                    );
                });
            });

            const redirectUri = `http://${finalConfig.hostname}:${this.port}${finalConfig.callbackPath}`;

            return {
                port: this.port,
                redirectUri,
            };
        } catch (error) {
            this.logger.oauth.error('Failed to start OAuth redirect server', {
                error: error instanceof Error ? error.message : error,
            });
            throw error;
        }
    }

    /**
     * Espera por el callback de OAuth
     */
    async waitForCallback(): Promise<AuthorizationCallback> {
        if (!this.callbackPromise) {
            throw new OAuthFlowError(
                'Server not started',
                'LOOPBACK_SERVER_FAILED'
            );
        }

        try {
            const result = await this.callbackPromise;
            return result;
        } finally {
            // Cleanup timeout
            if (this.timeoutHandle) {
                clearTimeout(this.timeoutHandle);
            }
        }
    }

    /**
     * Detiene el servidor
     */
    async stop(): Promise<void> {
        if (this.server) {
            this.logger.oauth.info('Stopping OAuth redirect server');

            await new Promise<void>((resolve) => {
                this.server!.close(() => {
                    this.logger.oauth.debug('OAuth redirect server stopped');
                    resolve();
                });
            });

            this.server = undefined;
            this.port = undefined;
        }

        if (this.timeoutHandle) {
            clearTimeout(this.timeoutHandle);
            this.timeoutHandle = undefined;
        }
    }

    /**
     * Encuentra un puerto disponible
     */
    private async findAvailablePort(preferredPort: number = 0): Promise<number> {
        return new Promise((resolve, reject) => {
            const server = net.createServer();

            server.listen(preferredPort, '127.0.0.1', () => {
                const address = server.address() as net.AddressInfo;
                const port = address.port;

                server.close(() => {
                    this.logger.oauth.debug('Found available port', { port });
                    resolve(port);
                });
            });

            server.on('error', (error) => {
                this.logger.oauth.error('Failed to find available port', {
                    error: error.message,
                });
                reject(error);
            });
        });
    }

    /**
     * Maneja request HTTP del callback
     */
    private handleRequest(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        expectedPath: string
    ): void {
        try {
            const url = new URL(req.url!, `http://127.0.0.1:${this.port}`);

            // Validar path
            if (url.pathname !== expectedPath) {
                this.logger.oauth.warn('Invalid callback path', {
                    expected: expectedPath,
                    received: url.pathname,
                });

                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(this.createErrorPage('Invalid callback path'));
                return;
            }

            // Extraer parámetros
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const error = url.searchParams.get('error');
            const errorDescription = url.searchParams.get('error_description');

            this.logger.oauth.debug('OAuth callback received', {
                hasCode: !!code,
                hasState: !!state,
                hasError: !!error,
            });

            // Check for error response
            if (error) {
                this.logger.oauth.warn('OAuth authorization denied', {
                    error,
                    errorDescription,
                });

                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(
                    this.createErrorPage(
                        errorDescription || error,
                        'Authorization Failed'
                    )
                );

                this.rejectCallback?.(
                    new OAuthFlowError(
                        `Authorization denied: ${errorDescription || error}`,
                        'AUTHORIZATION_DENIED',
                        { error, errorDescription }
                    )
                );
                return;
            }

            // Validar parámetros requeridos
            if (!code || !state) {
                this.logger.oauth.error('Missing required callback parameters', {
                    hasCode: !!code,
                    hasState: !!state,
                });

                res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(this.createErrorPage('Missing required parameters'));

                this.rejectCallback?.(
                    new OAuthFlowError(
                        'Missing code or state parameter in callback',
                        'INVALID_RESPONSE'
                    )
                );
                return;
            }

            // Success
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.createSuccessPage());

            this.resolveCallback?.({
                code,
                state,
            });
        } catch (error) {
            this.logger.oauth.error('Error handling OAuth callback', {
                error: error instanceof Error ? error.message : error,
            });

            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.createErrorPage('Internal server error'));

            this.rejectCallback?.(
                new OAuthFlowError(
                    'Failed to process OAuth callback',
                    'LOOPBACK_SERVER_FAILED',
                    { error }
                )
            );
        }
    }

    /**
     * Genera página HTML de éxito
     */
    private createSuccessPage(): string {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Successful - Levante</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      border-radius: 12px;
      padding: 48px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      max-width: 400px;
    }
    .icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 24px;
      background: #10b981;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .checkmark {
      color: white;
      font-size: 32px;
    }
    h1 {
      color: #1f2937;
      font-size: 24px;
      margin: 0 0 16px;
    }
    p {
      color: #6b7280;
      font-size: 16px;
      line-height: 1.5;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <span class="checkmark">✓</span>
    </div>
    <h1>Authorization Successful!</h1>
    <p>You can now close this window and return to Levante.</p>
  </div>
</body>
</html>
    `.trim();
    }

    /**
     * Genera página HTML de error
     */
    private createErrorPage(
        message: string,
        title: string = 'Authorization Error'
    ): string {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Levante</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #f87171 0%, #dc2626 100%);
    }
    .container {
      background: white;
      border-radius: 12px;
      padding: 48px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      max-width: 400px;
    }
    .icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 24px;
      background: #ef4444;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .cross {
      color: white;
      font-size: 32px;
    }
    h1 {
      color: #1f2937;
      font-size: 24px;
      margin: 0 0 16px;
    }
    p {
      color: #6b7280;
      font-size: 16px;
      line-height: 1.5;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <span class="cross">✕</span>
    </div>
    <h1>${title}</h1>
    <p>${message}</p>
    <p style="margin-top: 16px; font-size: 14px;">You can close this window.</p>
  </div>
</body>
</html>
    `.trim();
    }
}
