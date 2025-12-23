import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OAuthFlowManager } from '../OAuthFlowManager';

// Mock electron
vi.mock('electron', () => ({
    shell: {
        openExternal: vi.fn(),
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

describe('OAuthFlowManager', () => {
    let flowManager: OAuthFlowManager;

    beforeEach(() => {
        flowManager = new OAuthFlowManager();
    });

    describe('generatePKCE', () => {
        it('should generate PKCE with S256', () => {
            const pkce = flowManager.generatePKCE();

            expect(pkce.verifier).toBeDefined();
            expect(pkce.challenge).toBeDefined();
            expect(pkce.method).toBe('S256');

            // Verificar longitud del verifier (43-128 caracteres)
            expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
            expect(pkce.verifier.length).toBeLessThanOrEqual(128);

            // Verificar que challenge es diferente de verifier
            expect(pkce.challenge).not.toBe(pkce.verifier);
        });

        it('should generate unique PKCE on each call', () => {
            const pkce1 = flowManager.generatePKCE();
            const pkce2 = flowManager.generatePKCE();

            expect(pkce1.verifier).not.toBe(pkce2.verifier);
            expect(pkce1.challenge).not.toBe(pkce2.challenge);
        });

        it('should generate valid base64url strings', () => {
            const pkce = flowManager.generatePKCE();

            // base64url no debe contener +, /, =
            expect(pkce.verifier).not.toMatch(/[+/=]/);
            expect(pkce.challenge).not.toMatch(/[+/=]/);
        });
    });

    describe('createAuthorizationUrl', () => {
        it('should create valid authorization URL', () => {
            const pkce = flowManager.generatePKCE();
            const url = flowManager.createAuthorizationUrl({
                authorizationEndpoint: 'https://auth.example.com/authorize',
                clientId: 'test-client-123',
                redirectUri: 'http://127.0.0.1:8080/callback',
                scopes: ['mcp:read', 'mcp:write'],
                state: 'random-state-abc',
                codeChallenge: pkce.challenge,
                codeChallengeMethod: 'S256',
            });

            const parsed = new URL(url);

            expect(parsed.origin).toBe('https://auth.example.com');
            expect(parsed.pathname).toBe('/authorize');
            expect(parsed.searchParams.get('response_type')).toBe('code');
            expect(parsed.searchParams.get('client_id')).toBe('test-client-123');
            expect(parsed.searchParams.get('redirect_uri')).toBe(
                'http://127.0.0.1:8080/callback'
            );
            expect(parsed.searchParams.get('scope')).toBe('mcp:read mcp:write');
            expect(parsed.searchParams.get('state')).toBe('random-state-abc');
            expect(parsed.searchParams.get('code_challenge')).toBe(pkce.challenge);
            expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
        });

        it('should include resource parameter when provided', () => {
            const pkce = flowManager.generatePKCE();
            const url = flowManager.createAuthorizationUrl({
                authorizationEndpoint: 'https://auth.example.com/authorize',
                clientId: 'test-client',
                redirectUri: 'http://127.0.0.1:8080/callback',
                scopes: ['mcp:read'],
                state: 'state',
                codeChallenge: pkce.challenge,
                codeChallengeMethod: 'S256',
                resource: 'https://mcp.example.com',
            });

            const parsed = new URL(url);
            expect(parsed.searchParams.get('resource')).toBe(
                'https://mcp.example.com'
            );
        });
    });

    describe('exchangeCodeForTokens', () => {
        it('should exchange code for tokens successfully', async () => {
            // Mock fetch
            const mockTokens = {
                access_token: 'test-access-token',
                refresh_token: 'test-refresh-token',
                expires_in: 3600,
                token_type: 'Bearer',
                scope: 'mcp:read mcp:write',
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => mockTokens,
            });

            const tokens = await flowManager.exchangeCodeForTokens({
                tokenEndpoint: 'https://auth.example.com/token',
                code: 'auth-code-123',
                redirectUri: 'http://127.0.0.1:8080/callback',
                clientId: 'test-client',
                codeVerifier: 'test-verifier',
            });

            expect(tokens.accessToken).toBe('test-access-token');
            expect(tokens.refreshToken).toBe('test-refresh-token');
            expect(tokens.tokenType).toBe('Bearer');
            expect(tokens.scope).toBe('mcp:read mcp:write');
            expect(tokens.expiresAt).toBeGreaterThan(Date.now());
        });

        it('should throw error on failed token exchange', async () => {
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

        it('should include client_secret for confidential clients', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    access_token: 'token',
                    expires_in: 3600,
                    token_type: 'Bearer',
                }),
            });

            await flowManager.exchangeCodeForTokens({
                tokenEndpoint: 'https://auth.example.com/token',
                code: 'code',
                redirectUri: 'http://127.0.0.1:8080/callback',
                clientId: 'client',
                codeVerifier: 'verifier',
                clientSecret: 'secret',
            });

            const fetchCall = vi.mocked(global.fetch).mock.calls[0];
            const body = fetchCall[1]?.body as string;

            expect(body).toContain('client_secret=secret');
        });
    });

    describe('refreshAccessToken', () => {
        it('should refresh tokens successfully', async () => {
            const mockTokens = {
                access_token: 'new-access-token',
                refresh_token: 'new-refresh-token',
                expires_in: 3600,
                token_type: 'Bearer',
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => mockTokens,
            });

            const tokens = await flowManager.refreshAccessToken({
                tokenEndpoint: 'https://auth.example.com/token',
                refreshToken: 'old-refresh-token',
                clientId: 'test-client',
            });

            expect(tokens.accessToken).toBe('new-access-token');
            expect(tokens.refreshToken).toBe('new-refresh-token');
        });
    });

    describe('Token Revocation (Fase 6)', () => {
        it('should revoke access token', async () => {
            const mockRevocationEndpoint = 'https://auth.example.com/revoke';

            // Mock fetch
            global.fetch = vi.fn().mockResolvedValueOnce(
                new Response(null, { status: 200 })
            );

            await flowManager.revokeToken({
                revocationEndpoint: mockRevocationEndpoint,
                token: 'mock-access-token',
                tokenTypeHint: 'access_token',
                clientId: 'test-client',
            });

            // Verify fetch was called correctly
            expect(global.fetch).toHaveBeenCalledWith(
                mockRevocationEndpoint,
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Content-Type': 'application/x-www-form-urlencoded',
                    }),
                    body: expect.stringContaining('token=mock-access-token'),
                })
            );
        });

        it('should revoke refresh token with client secret', async () => {
            global.fetch = vi.fn().mockResolvedValueOnce(
                new Response(null, { status: 200 })
            );

            await flowManager.revokeToken({
                revocationEndpoint: 'https://auth.example.com/revoke',
                token: 'mock-refresh-token',
                tokenTypeHint: 'refresh_token',
                clientId: 'test-client',
                clientSecret: 'test-secret',
            });

            const fetchCall = (global.fetch as any).mock.calls[0];
            const body = fetchCall[1].body;

            expect(body).toContain('token=mock-refresh-token');
            expect(body).toContain('token_type_hint=refresh_token');
            expect(body).toContain('client_secret=test-secret');
        });

        it('should throw error if revocation fails', async () => {
            global.fetch = vi.fn().mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        error: 'invalid_token',
                        error_description: 'Token is invalid',
                    }),
                    { status: 400 }
                )
            );

            await expect(
                flowManager.revokeToken({
                    revocationEndpoint: 'https://auth.example.com/revoke',
                    token: 'invalid-token',
                    tokenTypeHint: 'access_token',
                    clientId: 'test-client',
                })
            ).rejects.toThrow('Token revocation failed');
        });
    });
});
