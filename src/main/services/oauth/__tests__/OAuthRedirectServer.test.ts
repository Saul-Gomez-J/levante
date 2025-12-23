import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OAuthRedirectServer } from '../OAuthRedirectServer';

// Mock logger
vi.mock('../../logging', () => ({
    getLogger: () => ({
        core: {
            info: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
    }),
}));

describe('OAuthRedirectServer', () => {
    let redirectServer: OAuthRedirectServer;

    beforeEach(() => {
        redirectServer = new OAuthRedirectServer();
    });

    afterEach(async () => {
        await redirectServer.stop();
    });

    describe('start', () => {
        it('should start server on random port', async () => {
            const result = await redirectServer.start();

            expect(result.port).toBeGreaterThan(0);
            expect(result.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
        });

        it('should start server on preferred port if available', async () => {
            const result = await redirectServer.start({ port: 0 });

            expect(result.port).toBeGreaterThan(0);
            expect(result.redirectUri).toContain('127.0.0.1');
        });

        it('should use default config values', async () => {
            const result = await redirectServer.start();

            expect(result.redirectUri).toContain('127.0.0.1');
            expect(result.redirectUri).toContain('/callback');
        });
    });

    describe('waitForCallback', () => {
        it('should throw if server not started', async () => {
            await expect(redirectServer.waitForCallback()).rejects.toThrow(
                'Server not started'
            );
        });

        it('should timeout after configured duration', async () => {
            await redirectServer.start({ timeout: 100 });

            await expect(redirectServer.waitForCallback()).rejects.toThrow(
                'OAuth callback timeout'
            );
        }, 200);

        it('should resolve when callback received', async () => {
            const { port } = await redirectServer.start();

            // Simular callback en background
            setTimeout(async () => {
                await fetch(
                    `http://127.0.0.1:${port}/callback?code=test-code&state=test-state`
                );
            }, 50);

            const callback = await redirectServer.waitForCallback();

            expect(callback.code).toBe('test-code');
            expect(callback.state).toBe('test-state');
        });

        it('should handle error callback', async () => {
            const { port } = await redirectServer.start();

            setTimeout(async () => {
                await fetch(
                    `http://127.0.0.1:${port}/callback?error=access_denied&error_description=User%20denied`
                );
            }, 50);

            await expect(redirectServer.waitForCallback()).rejects.toThrow(
                'Authorization denied'
            );
        });
    });

    describe('stop', () => {
        it('should stop server gracefully', async () => {
            await redirectServer.start();
            await redirectServer.stop();

            // Verificar que no hay error al detener de nuevo
            await expect(redirectServer.stop()).resolves.not.toThrow();
        });

        it('should not throw if stopping without starting', async () => {
            await expect(redirectServer.stop()).resolves.not.toThrow();
        });
    });

    describe('callback handling', () => {
        it('should reject invalid callback path', async () => {
            const { port } = await redirectServer.start();

            const response = await fetch(`http://127.0.0.1:${port}/invalid-path`);

            expect(response.status).toBe(404);
        });

        it('should reject callback without required parameters', async () => {
            const { port } = await redirectServer.start();

            setTimeout(async () => {
                await fetch(`http://127.0.0.1:${port}/callback`); // Sin code ni state
            }, 50);

            await expect(redirectServer.waitForCallback()).rejects.toThrow(
                'Missing code or state'
            );
        });

        it('should return success HTML page', async () => {
            const { port } = await redirectServer.start();

            const response = await fetch(
                `http://127.0.0.1:${port}/callback?code=test&state=test`
            );

            const html = await response.text();

            expect(response.status).toBe(200);
            expect(html).toContain('Authorization Successful');
            expect(html).toContain('You can now close this window');
        });

        it('should return error HTML page on error', async () => {
            const { port } = await redirectServer.start();

            const callbackPromise = redirectServer.waitForCallback();

            // Ejecutamos la petición y esperamos el rechazo de la promesa simultáneamente
            const [response] = await Promise.all([
                fetch(`http://127.0.0.1:${port}/callback?error=access_denied&error_description=User%20denied`),
                expect(callbackPromise).rejects.toThrow('Authorization denied')
            ]);

            const html = await response.text();

            expect(response.status).toBe(200);
            expect(html).toContain('Authorization Failed');
            expect(html).toContain('User denied');
        });
    });
});
