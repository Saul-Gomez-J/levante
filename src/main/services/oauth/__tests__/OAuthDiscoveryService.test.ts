import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OAuthDiscoveryService } from '../OAuthDiscoveryService';
import { OAuthDiscoveryError } from '../types';
import type {
    ProtectedResourceMetadata,
    AuthorizationServerMetadata,
} from '../types';

// Mock logger
vi.mock('../../logging', () => ({
    getLogger: () => ({
        core: {
            info: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
        mcp: {
            info: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
    }),
}));

describe('OAuthDiscoveryService', () => {
    let discoveryService: OAuthDiscoveryService;

    beforeEach(() => {
        discoveryService = new OAuthDiscoveryService();
        vi.clearAllMocks();
    });

    afterEach(() => {
        discoveryService.clearCache();
    });

    describe('discoverAuthServer', () => {
        it('should discover authorization servers from protected resource', async () => {
            const mockMetadata: ProtectedResourceMetadata = {
                resource: 'https://mcp.example.com',
                authorization_servers: ['https://auth.example.com'],
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => mockMetadata,
            });

            const result = await discoveryService.discoverAuthServer(
                'https://mcp.example.com'
            );

            expect(result.resource).toBe('https://mcp.example.com');
            expect(result.authorization_servers).toHaveLength(1);
            expect(result.authorization_servers[0]).toBe('https://auth.example.com');

            // Verify fetch was called with correct URL
            expect(global.fetch).toHaveBeenCalledWith(
                'https://mcp.example.com/.well-known/oauth-protected-resource',
                expect.objectContaining({
                    method: 'GET',
                    headers: expect.objectContaining({
                        Accept: 'application/json',
                    }),
                })
            );
        });

        it('should use cached metadata if available', async () => {
            const mockMetadata: ProtectedResourceMetadata = {
                resource: 'https://mcp.example.com',
                authorization_servers: ['https://auth.example.com'],
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => mockMetadata,
            });

            // Primera llamada - fetch
            await discoveryService.discoverAuthServer('https://mcp.example.com');

            // Segunda llamada - debe usar cache
            const result = await discoveryService.discoverAuthServer(
                'https://mcp.example.com'
            );

            expect(result.resource).toBe('https://mcp.example.com');
            // Fetch debe haber sido llamado solo una vez
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        it('should throw error if metadata fetch fails', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
                statusText: 'Not Found',
            });

            await expect(
                discoveryService.discoverAuthServer('https://mcp.example.com')
            ).rejects.toThrow(OAuthDiscoveryError);

            await expect(
                discoveryService.discoverAuthServer('https://mcp.example.com')
            ).rejects.toThrow('Failed to fetch protected resource metadata');
        });

        it('should throw error if resource field is missing', async () => {
            const invalidMetadata = {
                authorization_servers: ['https://auth.example.com'],
                // Falta "resource"
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => invalidMetadata,
            });

            await expect(
                discoveryService.discoverAuthServer('https://mcp.example.com')
            ).rejects.toThrow('missing "resource" field');
        });

        it('should throw error if authorization_servers is missing', async () => {
            const invalidMetadata = {
                resource: 'https://mcp.example.com',
                // Falta "authorization_servers"
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => invalidMetadata,
            });

            await expect(
                discoveryService.discoverAuthServer('https://mcp.example.com')
            ).rejects.toThrow('missing or invalid "authorization_servers"');
        });

        it('should throw error if resource origin does not match', async () => {
            const invalidMetadata: ProtectedResourceMetadata = {
                resource: 'https://different-origin.com', // Diferente origin
                authorization_servers: ['https://auth.example.com'],
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => invalidMetadata,
            });

            await expect(
                discoveryService.discoverAuthServer('https://mcp.example.com')
            ).rejects.toThrow('does not match actual resource origin');
        });
    });

    describe('fetchServerMetadata', () => {
        it('should fetch authorization server metadata', async () => {
            const mockMetadata: AuthorizationServerMetadata = {
                issuer: 'https://auth.example.com',
                authorization_endpoint: 'https://auth.example.com/authorize',
                token_endpoint: 'https://auth.example.com/token',
                response_types_supported: ['code'],
                code_challenge_methods_supported: ['S256'],
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => mockMetadata,
            });

            const result = await discoveryService.fetchServerMetadata(
                'https://auth.example.com'
            );

            expect(result.issuer).toBe('https://auth.example.com');
            expect(result.authorization_endpoint).toBe(
                'https://auth.example.com/authorize'
            );
            expect(result.token_endpoint).toBe('https://auth.example.com/token');
            expect(result.code_challenge_methods_supported).toContain('S256');

            // Verify fetch was called with correct URL
            expect(global.fetch).toHaveBeenCalledWith(
                'https://auth.example.com/.well-known/oauth-authorization-server',
                expect.objectContaining({
                    method: 'GET',
                    headers: expect.objectContaining({
                        Accept: 'application/json',
                    }),
                })
            );
        });

        it('should use cached metadata if available', async () => {
            const mockMetadata: AuthorizationServerMetadata = {
                issuer: 'https://auth.example.com',
                authorization_endpoint: 'https://auth.example.com/authorize',
                token_endpoint: 'https://auth.example.com/token',
                response_types_supported: ['code'],
                code_challenge_methods_supported: ['S256'],
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => mockMetadata,
            });

            // Primera llamada
            await discoveryService.fetchServerMetadata('https://auth.example.com');

            // Segunda llamada - debe usar cache
            const result = await discoveryService.fetchServerMetadata(
                'https://auth.example.com'
            );

            expect(result.issuer).toBe('https://auth.example.com');
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        it('should throw error if metadata fetch fails', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
            });

            await expect(
                discoveryService.fetchServerMetadata('https://auth.example.com')
            ).rejects.toThrow('Failed to fetch authorization server metadata');
        });

        it('should throw error if required fields are missing', async () => {
            const invalidMetadata = {
                issuer: 'https://auth.example.com',
                // Faltan campos obligatorios
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => invalidMetadata,
            });

            await expect(
                discoveryService.fetchServerMetadata('https://auth.example.com')
            ).rejects.toThrow('missing required field');
        });

        it('should throw error if PKCE is not supported', async () => {
            const invalidMetadata: Partial<AuthorizationServerMetadata> = {
                issuer: 'https://auth.example.com',
                authorization_endpoint: 'https://auth.example.com/authorize',
                token_endpoint: 'https://auth.example.com/token',
                response_types_supported: ['code'],
                // No code_challenge_methods_supported
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => invalidMetadata,
            });

            await expect(
                discoveryService.fetchServerMetadata('https://auth.example.com')
            ).rejects.toThrow('does not advertise PKCE support');
        });

        it('should throw error if PKCE S256 is not supported', async () => {
            const invalidMetadata: Partial<AuthorizationServerMetadata> = {
                issuer: 'https://auth.example.com',
                authorization_endpoint: 'https://auth.example.com/authorize',
                token_endpoint: 'https://auth.example.com/token',
                response_types_supported: ['code'],
                code_challenge_methods_supported: ['plain'], // Solo plain, no S256
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => invalidMetadata,
            });

            await expect(
                discoveryService.fetchServerMetadata('https://auth.example.com')
            ).rejects.toThrow('does not support PKCE with S256');
        });

        it('should accept metadata with optional fields', async () => {
            const fullMetadata: AuthorizationServerMetadata = {
                issuer: 'https://auth.example.com',
                authorization_endpoint: 'https://auth.example.com/authorize',
                token_endpoint: 'https://auth.example.com/token',
                response_types_supported: ['code'],
                code_challenge_methods_supported: ['S256'],
                registration_endpoint: 'https://auth.example.com/register',
                revocation_endpoint: 'https://auth.example.com/revoke',
                scopes_supported: ['mcp:read', 'mcp:write'],
                grant_types_supported: ['authorization_code', 'refresh_token'],
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => fullMetadata,
            });

            const result = await discoveryService.fetchServerMetadata(
                'https://auth.example.com'
            );

            expect(result.registration_endpoint).toBe(
                'https://auth.example.com/register'
            );
            expect(result.revocation_endpoint).toBe(
                'https://auth.example.com/revoke'
            );
            expect(result.scopes_supported).toContain('mcp:read');
        });
    });

    describe('parseWWWAuthenticate', () => {
        it('should parse Bearer header with quoted values', () => {
            const header =
                'Bearer realm="mcp", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"';

            const result = discoveryService.parseWWWAuthenticate(header);

            expect(result.scheme).toBe('Bearer');
            expect(result.realm).toBe('mcp');
            expect(result.resource_metadata).toBe(
                'https://mcp.example.com/.well-known/oauth-protected-resource'
            );
        });

        it('should parse header with as_uri parameter', () => {
            const header =
                'Bearer realm="mcp", as_uri="https://auth.example.com"';

            const result = discoveryService.parseWWWAuthenticate(header);

            expect(result.scheme).toBe('Bearer');
            expect(result.as_uri).toBe('https://auth.example.com');
        });

        it('should parse header with error parameters', () => {
            const header =
                'Bearer error="invalid_token", error_description="Token expired"';

            const result = discoveryService.parseWWWAuthenticate(header);

            expect(result.error).toBe('invalid_token');
            expect(result.error_description).toBe('Token expired');
        });

        it('should parse header with scope parameter', () => {
            const header = 'Bearer realm="mcp", scope="mcp:read mcp:write"';

            const result = discoveryService.parseWWWAuthenticate(header);

            expect(result.scope).toBe('mcp:read mcp:write');
        });

        it('should handle unquoted values', () => {
            const header = 'Bearer realm=mcp, scope=read';

            const result = discoveryService.parseWWWAuthenticate(header);

            expect(result.realm).toBe('mcp');
            expect(result.scope).toBe('read');
        });

        it('should handle empty header', () => {
            const result = discoveryService.parseWWWAuthenticate('');

            expect(result).toEqual({});
        });

        it('should handle header without scheme', () => {
            const header = 'realm="mcp"';

            const result = discoveryService.parseWWWAuthenticate(header);

            expect(result.scheme).toBeUndefined();
            expect(result.realm).toBe('mcp');
        });
    });

    describe('discoverFromUnauthorized', () => {
        it('should perform full discovery flow', async () => {
            const resourceMetadata: ProtectedResourceMetadata = {
                resource: 'https://mcp.example.com',
                authorization_servers: ['https://auth.example.com'],
            };

            const serverMetadata: AuthorizationServerMetadata = {
                issuer: 'https://auth.example.com',
                authorization_endpoint: 'https://auth.example.com/authorize',
                token_endpoint: 'https://auth.example.com/token',
                response_types_supported: ['code'],
                code_challenge_methods_supported: ['S256'],
            };

            global.fetch = vi
                .fn()
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => resourceMetadata,
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => serverMetadata,
                });

            const result = await discoveryService.discoverFromUnauthorized(
                'https://mcp.example.com'
            );

            expect(result.authorizationServer).toBe('https://auth.example.com');
            expect(result.metadata.issuer).toBe('https://auth.example.com');
            expect(result.fromCache).toBe(false);
        });

        it('should use as_uri from WWW-Authenticate header', async () => {
            const wwwAuth = 'Bearer as_uri="https://custom-auth.example.com"';

            const resourceMetadata: ProtectedResourceMetadata = {
                resource: 'https://mcp.example.com',
                authorization_servers: ['https://auth.example.com'],
            };

            const serverMetadata: AuthorizationServerMetadata = {
                issuer: 'https://custom-auth.example.com',
                authorization_endpoint: 'https://custom-auth.example.com/authorize',
                token_endpoint: 'https://custom-auth.example.com/token',
                response_types_supported: ['code'],
                code_challenge_methods_supported: ['S256'],
            };

            global.fetch = vi
                .fn()
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => resourceMetadata,
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => serverMetadata,
                });

            const result = await discoveryService.discoverFromUnauthorized(
                'https://mcp.example.com',
                wwwAuth
            );

            // Debe usar as_uri del header, no el primer servidor de la lista
            expect(result.authorizationServer).toBe(
                'https://custom-auth.example.com'
            );
        });

        it('should throw error if no authorization server found', async () => {
            const resourceMetadata: ProtectedResourceMetadata = {
                resource: 'https://mcp.example.com',
                authorization_servers: [], // Array vacío
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => resourceMetadata,
            });

            await expect(
                discoveryService.discoverFromUnauthorized('https://mcp.example.com')
            ).rejects.toThrow('missing or invalid "authorization_servers"');
        });
    });

    describe('cache management', () => {
        it('should clean expired cache entries', async () => {
            const mockMetadata: AuthorizationServerMetadata = {
                issuer: 'https://auth.example.com',
                authorization_endpoint: 'https://auth.example.com/authorize',
                token_endpoint: 'https://auth.example.com/token',
                response_types_supported: ['code'],
                code_challenge_methods_supported: ['S256'],
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => mockMetadata,
            });

            // Fetch metadata
            await discoveryService.fetchServerMetadata('https://auth.example.com');

            // Verificar que está en cache
            let stats = discoveryService.getCacheStats();
            expect(stats.metadataCount).toBe(1);

            // Limpiar cache expirado (no debería eliminar nada todavía)
            const cleaned = discoveryService.cleanExpiredCache();
            expect(cleaned).toBe(0);

            // Cache debe seguir con 1 entrada
            stats = discoveryService.getCacheStats();
            expect(stats.metadataCount).toBe(1);
        });

        it('should clear all cache', async () => {
            const mockMetadata: AuthorizationServerMetadata = {
                issuer: 'https://auth.example.com',
                authorization_endpoint: 'https://auth.example.com/authorize',
                token_endpoint: 'https://auth.example.com/token',
                response_types_supported: ['code'],
                code_challenge_methods_supported: ['S256'],
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => mockMetadata,
            });

            await discoveryService.fetchServerMetadata('https://auth.example.com');

            let stats = discoveryService.getCacheStats();
            expect(stats.metadataCount).toBe(1);

            discoveryService.clearCache();

            stats = discoveryService.getCacheStats();
            expect(stats.metadataCount).toBe(0);
            expect(stats.total).toBe(0);
        });

        it('should return cache statistics', async () => {
            const resourceMetadata: ProtectedResourceMetadata = {
                resource: 'https://mcp.example.com',
                authorization_servers: ['https://auth.example.com'],
            };

            const serverMetadata: AuthorizationServerMetadata = {
                issuer: 'https://auth.example.com',
                authorization_endpoint: 'https://auth.example.com/authorize',
                token_endpoint: 'https://auth.example.com/token',
                response_types_supported: ['code'],
                code_challenge_methods_supported: ['S256'],
            };

            global.fetch = vi
                .fn()
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => resourceMetadata,
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => serverMetadata,
                });

            await discoveryService.discoverAuthServer('https://mcp.example.com');
            await discoveryService.fetchServerMetadata('https://auth.example.com');

            const stats = discoveryService.getCacheStats();

            expect(stats.resourceCount).toBe(1);
            expect(stats.metadataCount).toBe(1);
            expect(stats.total).toBe(2);
        });
    });

    describe('registerClient', () => {
        it('should register client successfully', async () => {
            const mockResponse = {
                client_id: 'test-client-id',
                client_secret: 'test-client-secret',
                client_id_issued_at: Date.now() / 1000,
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => mockResponse,
            });

            const result = await discoveryService.registerClient(
                'https://auth.example.com/register',
                'https://auth.example.com'
            );

            expect(result.clientId).toBe('test-client-id');
            expect(result.clientSecret).toBe('test-client-secret');
            expect(result.authServerId).toBe('https://auth.example.com');

            expect(global.fetch).toHaveBeenCalledWith(
                'https://auth.example.com/register',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                    }),
                    body: expect.stringContaining('Levante'),
                })
            );
        });

        it('should throw error if registration fails', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
                json: async () => ({
                    error: 'invalid_redirect_uri',
                    error_description: 'Invalid redirect URI',
                }),
            });

            await expect(
                discoveryService.registerClient(
                    'https://auth.example.com/register',
                    'https://auth.example.com'
                )
            ).rejects.toThrow('Invalid redirect URI');
        });

        it('should throw error if registration response is missing client_id', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({}), // Missing client_id
            });

            await expect(
                discoveryService.registerClient(
                    'https://auth.example.com/register',
                    'https://auth.example.com'
                )
            ).rejects.toThrow('Registration response missing client_id');
        });

        it('should throw error if registration endpoint is not HTTPS', async () => {
            await expect(
                discoveryService.registerClient(
                    'http://insecure.example.com/register',
                    'http://insecure.example.com'
                )
            ).rejects.toThrow('Registration endpoint must use HTTPS');
        });

        it('should allow HTTP for localhost registration', async () => {
            const mockResponse = { client_id: 'local-client' };
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => mockResponse,
            });

            const result = await discoveryService.registerClient(
                'http://127.0.0.1:8080/register',
                'http://127.0.0.1:8080'
            );

            expect(result.clientId).toBe('local-client');
        });
    });

    describe('supportsClientRegistration', () => {
        it('should return true if registration_endpoint is present', () => {
            const metadata: any = {
                registration_endpoint: 'https://auth.example.com/register',
            };

            expect(discoveryService.supportsClientRegistration(metadata)).toBe(true);
        });

        it('should return false if registration_endpoint is missing', () => {
            const metadata: any = {
                issuer: 'https://auth.example.com',
            };

            expect(discoveryService.supportsClientRegistration(metadata)).toBe(
                false
            );
        });
    });
});
