import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OAuthFlowManager } from '../OAuthFlowManager';
import { OAuthTokenStore } from '../OAuthTokenStore';
import type { PreferencesService } from '../../preferencesService';

// Mock electron
vi.mock('electron', () => ({
    shell: {
        openExternal: vi.fn(),
    },
    safeStorage: {
        isEncryptionAvailable: vi.fn(() => true),
        encryptString: vi.fn((str: string) => Buffer.from(str, 'utf8')),
        decryptString: vi.fn((buffer: Buffer) => buffer.toString('utf8')),
    },
}));

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

// Mock PreferencesService
class MockPreferencesService {
    private store: Record<string, any> = {};

    async get<T>(key: string): Promise<T | undefined> {
        const keys = key.split('.');
        let value: any = this.store;

        for (const k of keys) {
            value = value?.[k];
            if (value === undefined) return undefined;
        }

        return value as T;
    }

    async set(key: string, value: any): Promise<void> {
        const keys = key.split('.');
        const lastKey = keys.pop()!;
        let target: any = this.store;

        for (const k of keys) {
            if (!target[k]) target[k] = {};
            target = target[k];
        }

        target[lastKey] = value;
    }

    async getAll(): Promise<any> {
        return this.store;
    }

    reset(): void {
        this.store = {};
    }
}

describe('OAuth Integration Tests', () => {
    let flowManager: OAuthFlowManager;
    let tokenStore: OAuthTokenStore;
    let mockPreferences: MockPreferencesService;

    beforeEach(() => {
        mockPreferences = new MockPreferencesService();
        flowManager = new OAuthFlowManager();
        tokenStore = new OAuthTokenStore(mockPreferences as any as PreferencesService);
    });

    afterEach(() => {
        mockPreferences.reset();
    });

    describe('Full OAuth Flow', () => {
        it('should complete authorization and token storage', async () => {
            // Mock token endpoint
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    access_token: 'test-access-token',
                    refresh_token: 'test-refresh-token',
                    expires_in: 3600,
                    token_type: 'Bearer',
                    scope: 'mcp:read mcp:write',
                }),
            });

            // 1. Generar PKCE
            const pkce = flowManager.generatePKCE();
            expect(pkce.verifier).toBeDefined();
            expect(pkce.challenge).toBeDefined();

            // 2. Exchange code (simulado)
            const tokens = await flowManager.exchangeCodeForTokens({
                tokenEndpoint: 'https://auth.example.com/token',
                code: 'test-code',
                redirectUri: 'http://127.0.0.1:8080/callback',
                clientId: 'test-client',
                codeVerifier: pkce.verifier,
            });

            expect(tokens.accessToken).toBe('test-access-token');
            expect(tokens.refreshToken).toBe('test-refresh-token');

            // 3. Guardar tokens
            await tokenStore.saveTokens('test-server', tokens);

            // 4. Recuperar tokens
            const retrieved = await tokenStore.getTokens('test-server');

            expect(retrieved).toBeDefined();
            expect(retrieved!.accessToken).toBe('test-access-token');
            expect(retrieved!.refreshToken).toBe('test-refresh-token');
        });

        it('should refresh expired tokens', async () => {
            // 1. Guardar tokens expirados
            const expiredTokens = {
                accessToken: 'expired-access-token',
                refreshToken: 'valid-refresh-token',
                expiresAt: Date.now() - 1000, // Expirado
                tokenType: 'Bearer' as const,
            };

            await tokenStore.saveTokens('test-server', expiredTokens);

            // 2. Verificar que está expirado
            expect(tokenStore.isTokenExpired(expiredTokens)).toBe(true);

            // 3. Mock refresh endpoint
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    access_token: 'new-access-token',
                    refresh_token: 'new-refresh-token',
                    expires_in: 3600,
                    token_type: 'Bearer',
                }),
            });

            // 4. Refresh tokens
            const newTokens = await flowManager.refreshAccessToken({
                tokenEndpoint: 'https://auth.example.com/token',
                refreshToken: 'valid-refresh-token',
                clientId: 'test-client',
            });

            expect(newTokens.accessToken).toBe('new-access-token');
            expect(tokenStore.isTokenExpired(newTokens)).toBe(false);

            // 5. Guardar nuevos tokens
            await tokenStore.saveTokens('test-server', newTokens);

            // 6. Verificar guardado
            const retrieved = await tokenStore.getTokens('test-server');
            expect(retrieved!.accessToken).toBe('new-access-token');
        });
    });

    describe('PKCE Verification', () => {
        it('should validate PKCE challenge matches verifier', async () => {
            const pkce = flowManager.generatePKCE();

            // Verificar que el challenge es SHA256(verifier)
            const crypto = await import('crypto');
            const expectedChallenge = crypto
                .createHash('sha256')
                .update(pkce.verifier)
                .digest('base64url');

            expect(pkce.challenge).toBe(expectedChallenge);
        });

        it('should generate different PKCE on each call', () => {
            const pkce1 = flowManager.generatePKCE();
            const pkce2 = flowManager.generatePKCE();

            expect(pkce1.verifier).not.toBe(pkce2.verifier);
            expect(pkce1.challenge).not.toBe(pkce2.challenge);
        });
    });

    describe('Error Handling', () => {
        it('should handle token exchange errors gracefully', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
                json: async () => ({
                    error: 'invalid_grant',
                    error_description: 'Invalid authorization code',
                }),
            });

            await expect(
                flowManager.exchangeCodeForTokens({
                    tokenEndpoint: 'https://auth.example.com/token',
                    code: 'invalid-code',
                    redirectUri: 'http://127.0.0.1:8080/callback',
                    clientId: 'test-client',
                    codeVerifier: 'test-verifier',
                })
            ).rejects.toThrow('Token exchange failed');
        });

        it('should handle refresh errors gracefully', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
                json: async () => ({
                    error: 'invalid_grant',
                    error_description: 'Refresh token expired',
                }),
            });

            await expect(
                flowManager.refreshAccessToken({
                    tokenEndpoint: 'https://auth.example.com/token',
                    refreshToken: 'expired-refresh',
                    clientId: 'test-client',
                })
            ).rejects.toThrow('Token refresh failed');
        });
    });
});
