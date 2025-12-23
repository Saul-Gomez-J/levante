import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OAuthService } from '../OAuthService';
import { PreferencesService } from '../../preferencesService';
import type { OAuthTokens } from '../types';

// Mock dependencies
vi.mock('../../preferencesService');
vi.mock('../OAuthDiscoveryService');
vi.mock('../OAuthFlowManager');
vi.mock('../OAuthTokenStore');
vi.mock('../OAuthHttpClient');

describe('OAuthService', () => {
    let service: OAuthService;
    let mockPrefs: PreferencesService;
    let mockDiscoveryService: any;
    let mockFlowManager: any;
    let mockTokenStore: any;
    let mockHttpClient: any;

    beforeEach(() => {
        mockPrefs = new PreferencesService();
        service = new OAuthService(mockPrefs);

        // Access private properties for testing
        mockDiscoveryService = (service as any).discoveryService;
        mockFlowManager = (service as any).flowManager;
        mockTokenStore = (service as any).tokenStore;
        mockHttpClient = (service as any).httpClient;

        vi.clearAllMocks();
    });

    describe('authorize', () => {
        it('should complete full authorization flow', async () => {
            // Mock discovery
            mockDiscoveryService.discoverFromUnauthorized.mockResolvedValue({
                authorizationServer: 'https://auth.example.com',
                metadata: {
                    authorization_endpoint: 'https://auth.example.com/authorize',
                    token_endpoint: 'https://auth.example.com/token',
                    response_types_supported: ['code'],
                    code_challenge_methods_supported: ['S256'],
                },
            });

            // Mock authorization flow
            mockFlowManager.authorize.mockResolvedValue({
                code: 'auth-code-123',
                verifier: 'verifier-123',
            });

            // Mock token exchange
            const tokens: OAuthTokens = {
                accessToken: 'access-token-123',
                refreshToken: 'refresh-token-123',
                expiresAt: Date.now() + 3600000,
                tokenType: 'Bearer',
            };

            mockFlowManager.exchangeCodeForTokens.mockResolvedValue(tokens);

            // Mock save
            mockTokenStore.saveTokens.mockResolvedValue(undefined);
            (mockPrefs.set as any).mockResolvedValue(undefined);

            const result = await service.authorize({
                serverId: 'test-server',
                mcpServerUrl: 'https://mcp.example.com',
                clientId: 'test-client',
                scopes: ['mcp:read', 'mcp:write'],
            });

            expect(result.success).toBe(true);
            expect(result.tokens).toEqual(tokens);
            expect(mockTokenStore.saveTokens).toHaveBeenCalled();
            expect(mockPrefs.set).toHaveBeenCalled();
        });

        it('should return error if no client ID', async () => {
            // Mock discovery (needed because it happens before client ID check)
            mockDiscoveryService.discoverFromUnauthorized.mockResolvedValue({
                authorizationServer: 'https://auth.example.com',
                metadata: {
                    authorization_endpoint: 'https://auth.example.com/authorize',
                    token_endpoint: 'https://auth.example.com/token',
                },
            });

            const result = await service.authorize({
                serverId: 'test-server',
                mcpServerUrl: 'https://mcp.example.com',
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain('Client ID required');
        });
    });

    describe('hasValidConfig', () => {
        it('should return true if config is valid', async () => {
            (mockPrefs.get as any).mockResolvedValue({
                enabled: true,
                clientId: 'test-client',
            });

            const result = await service.hasValidConfig('test-server');

            expect(result).toBe(true);
        });

        it('should return false if config is missing', async () => {
            (mockPrefs.get as any).mockResolvedValue(null);

            const result = await service.hasValidConfig('test-server');

            expect(result).toBe(false);
        });
    });

    describe('disconnect', () => {
        it('should delete tokens and config', async () => {
            mockTokenStore.deleteTokens.mockResolvedValue(undefined);
            (mockPrefs.set as any).mockResolvedValue(undefined);

            await service.disconnect({ serverId: 'test-server' });

            expect(mockTokenStore.deleteTokens).toHaveBeenCalledWith('test-server');
            expect(mockPrefs.set).toHaveBeenCalledWith(
                'mcpServers.test-server.oauth',
                undefined
            );
        });
    });
});
