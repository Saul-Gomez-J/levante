import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OAuthService } from '../OAuthService';
import { PreferencesService } from '../../preferencesService';
import { OAuthDiscoveryService } from '../OAuthDiscoveryService';
import { OAuthFlowManager } from '../OAuthFlowManager';
import { OAuthTokenStore } from '../OAuthTokenStore';

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

// Mock electron
vi.mock('electron', () => ({
    shell: {
        openExternal: vi.fn().mockResolvedValue(undefined),
    },
    safeStorage: {
        encryptString: (str: string) => Buffer.from(str),
        decryptString: (buf: Buffer) => buf.toString(),
        isEncryptionAvailable: () => true,
    },
}));

describe('Dynamic Client Registration Integration', () => {
    let oauthService: OAuthService;
    let preferencesService: PreferencesService;

    beforeEach(() => {
        preferencesService = {
            get: vi.fn(),
            set: vi.fn(),
            delete: vi.fn(),
        } as any;
        oauthService = new OAuthService(preferencesService);
        vi.clearAllMocks();
    });

    it('should complete full flow with dynamic registration', async () => {
        const mcpServerUrl = 'https://mcp.example.com';
        const serverId = 'test-server';

        // 1. Mock Discovery
        const resourceMetadata = {
            resource: 'https://mcp.example.com',
            authorization_servers: ['https://auth.example.com'],
        };
        const serverMetadata = {
            issuer: 'https://auth.example.com',
            authorization_endpoint: 'https://auth.example.com/authorize',
            token_endpoint: 'https://auth.example.com/token',
            registration_endpoint: 'https://auth.example.com/register',
            response_types_supported: ['code'],
            code_challenge_methods_supported: ['S256'],
        };

        // 2. Mock Registration
        const registrationResponse = {
            client_id: 'dynamic-client-id',
            client_secret: 'dynamic-client-secret',
        };

        // 3. Mock Token Exchange
        const tokenResponse = {
            access_token: 'test-access-token',
            refresh_token: 'test-refresh-token',
            expires_in: 3600,
            token_type: 'Bearer',
        };

        // Setup global fetch mocks
        global.fetch = vi.fn().mockImplementation((url) => {
            if (url.includes('.well-known/oauth-protected-resource')) {
                return Promise.resolve({ ok: true, json: async () => resourceMetadata });
            }
            if (url.includes('.well-known/oauth-authorization-server')) {
                return Promise.resolve({ ok: true, json: async () => serverMetadata });
            }
            if (url.includes('/register')) {
                return Promise.resolve({ ok: true, json: async () => registrationResponse });
            }
            if (url.includes('/token')) {
                return Promise.resolve({ ok: true, json: async () => tokenResponse });
            }
            return Promise.reject(new Error(`Unexpected fetch call to ${url}`));
        });

        // Mock OAuthFlowManager.authorize to skip browser/redirect server
        vi.spyOn(OAuthFlowManager.prototype, 'authorize').mockResolvedValue({
            code: 'test-auth-code',
            verifier: 'test-verifier',
        });

        // Mock OAuthTokenStore.saveTokens
        vi.spyOn(OAuthTokenStore.prototype, 'saveTokens').mockResolvedValue(undefined);

        // Execute authorize
        const result = await oauthService.authorize({
            serverId,
            mcpServerUrl,
        });

        // Assertions
        if (!result.success) {
            throw new Error(`Authorization failed with error: ${result.error}`);
        }
        expect(result.success).toBe(true);
        expect(global.fetch).toHaveBeenCalledWith(
            'https://auth.example.com/register',
            expect.objectContaining({ method: 'POST' })
        );

        // Verify client credentials were saved
        expect(preferencesService.set).toHaveBeenCalledWith(
            `mcpServers.${serverId}.oauth.clientCredentials`,
            expect.objectContaining({
                clientId: 'dynamic-client-id',
            })
        );

        // Verify configuration was saved with the dynamic client id
        expect(preferencesService.set).toHaveBeenCalledWith(
            `mcpServers.${serverId}.oauth`,
            expect.objectContaining({
                clientId: 'dynamic-client-id',
                enabled: true,
            })
        );
    });

    it('should fail if dynamic registration is not supported and no client_id provided', async () => {
        const mcpServerUrl = 'https://mcp.example.com';
        const serverId = 'test-server';

        const resourceMetadata = {
            resource: 'https://mcp.example.com',
            authorization_servers: ['https://auth.example.com'],
        };
        const serverMetadata = {
            issuer: 'https://auth.example.com',
            authorization_endpoint: 'https://auth.example.com/authorize',
            token_endpoint: 'https://auth.example.com/token',
            // No registration_endpoint
            response_types_supported: ['code'],
            code_challenge_methods_supported: ['S256'],
        };

        global.fetch = vi.fn().mockImplementation((url) => {
            if (url.includes('.well-known/oauth-protected-resource')) {
                return Promise.resolve({ ok: true, json: async () => resourceMetadata });
            }
            if (url.includes('.well-known/oauth-authorization-server')) {
                return Promise.resolve({ ok: true, json: async () => serverMetadata });
            }
            return Promise.reject(new Error(`Unexpected fetch call to ${url}`));
        });

        const result = await oauthService.authorize({
            serverId,
            mcpServerUrl,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('does not support Dynamic Client Registration');
    });
});
