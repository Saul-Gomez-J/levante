import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OAuthHttpClient } from '../OAuthHttpClient';
import { OAuthTokenStore } from '../OAuthTokenStore';
import { OAuthFlowManager } from '../OAuthFlowManager';
import { PreferencesService } from '../../preferencesService';
import type { OAuthTokens } from '../types';

// Mock dependencies
vi.mock('../OAuthTokenStore');
vi.mock('../OAuthFlowManager');
vi.mock('../../preferencesService');
vi.mock('../OAuthDiscoveryService');

describe('OAuthHttpClient', () => {
    let httpClient: OAuthHttpClient;
    let mockPrefs: PreferencesService;
    let mockTokenStore: any;
    let mockFlowManager: any;
    let mockDiscoveryService: any;

    beforeEach(() => {
        mockPrefs = new PreferencesService();
        httpClient = new OAuthHttpClient(mockPrefs);

        // Access private properties for testing
        mockTokenStore = (httpClient as any).tokenStore;
        mockFlowManager = (httpClient as any).flowManager;
        mockDiscoveryService = (httpClient as any).discoveryService;

        vi.clearAllMocks();
    });

    describe('ensureValidToken', () => {
        it('should return valid token if not expired', async () => {
            const validTokens: OAuthTokens = {
                accessToken: 'valid-token',
                refreshToken: 'refresh-token',
                expiresAt: Date.now() + 3600000, // 1 hour from now
                tokenType: 'Bearer',
            };

            mockTokenStore.getTokens.mockResolvedValue(validTokens);
            mockTokenStore.isTokenExpired.mockReturnValue(false);

            const result = await httpClient.ensureValidToken('server-1');

            expect(result).toEqual(validTokens);
            expect(mockTokenStore.getTokens).toHaveBeenCalledWith('server-1');
            expect(mockFlowManager.refreshAccessToken).not.toHaveBeenCalled();
        });

        it('should refresh expired token', async () => {
            const expiredTokens: OAuthTokens = {
                accessToken: 'expired-token',
                refreshToken: 'refresh-token',
                expiresAt: Date.now() - 1000, // Expired
                tokenType: 'Bearer',
            };

            const newTokens: OAuthTokens = {
                accessToken: 'new-token',
                refreshToken: 'new-refresh-token',
                expiresAt: Date.now() + 3600000,
                tokenType: 'Bearer',
            };

            mockTokenStore.getTokens.mockResolvedValue(expiredTokens);
            mockTokenStore.isTokenExpired.mockReturnValue(true);
            mockFlowManager.refreshAccessToken.mockResolvedValue(newTokens);
            mockTokenStore.saveTokens.mockResolvedValue(undefined);

            // Mock getOAuthConfig through preferencesService.get
            (mockPrefs.get as any).mockResolvedValue({
                authServerId: 'https://auth.example.com',
                clientId: 'test-client',
                enabled: true,
                scopes: ['read']
            });

            // Mock discovery
            mockDiscoveryService.fetchServerMetadata.mockResolvedValue({
                token_endpoint: 'https://auth.example.com/token'
            });

            const result = await httpClient.ensureValidToken('server-1');

            expect(result).toEqual(newTokens);
            expect(mockFlowManager.refreshAccessToken).toHaveBeenCalled();
            expect(mockTokenStore.saveTokens).toHaveBeenCalledWith('server-1', newTokens);
        });

        it('should throw error if no tokens found', async () => {
            mockTokenStore.getTokens.mockResolvedValue(null);

            await expect(httpClient.ensureValidToken('server-1')).rejects.toThrow(
                'No OAuth tokens found'
            );
        });

        it('should throw error if no refresh token available', async () => {
            const tokensWithoutRefresh: OAuthTokens = {
                accessToken: 'expired-token',
                expiresAt: Date.now() - 1000,
                tokenType: 'Bearer',
            };

            mockTokenStore.getTokens.mockResolvedValue(tokensWithoutRefresh);
            mockTokenStore.isTokenExpired.mockReturnValue(true);

            await expect(httpClient.ensureValidToken('server-1')).rejects.toThrow(
                'No refresh token available'
            );
        });
    });

    describe('getAuthHeaders', () => {
        it('should return authorization header', async () => {
            const tokens: OAuthTokens = {
                accessToken: 'test-token-123',
                expiresAt: Date.now() + 3600000,
                tokenType: 'Bearer',
            };

            mockTokenStore.getTokens.mockResolvedValue(tokens);
            mockTokenStore.isTokenExpired.mockReturnValue(false);

            const headers = await httpClient.getAuthHeaders('server-1');

            expect(headers).toEqual({
                Authorization: 'Bearer test-token-123',
            });
        });
    });

    describe('handleUnauthorized', () => {
        it('should refresh token and return true on 401', async () => {
            const tokens: OAuthTokens = {
                accessToken: 'old-token',
                refreshToken: 'refresh-token',
                expiresAt: Date.now() + 3600000,
                tokenType: 'Bearer',
            };

            const newTokens: OAuthTokens = {
                accessToken: 'new-token',
                refreshToken: 'new-refresh-token',
                expiresAt: Date.now() + 3600000,
                tokenType: 'Bearer',
            };

            const response = new Response(null, {
                status: 401,
                headers: {
                    'WWW-Authenticate': 'Bearer error="invalid_token"',
                },
            });

            mockTokenStore.getTokens.mockResolvedValue(tokens);
            mockFlowManager.refreshAccessToken.mockResolvedValue(newTokens);
            mockTokenStore.saveTokens.mockResolvedValue(undefined);

            (mockPrefs.get as any).mockResolvedValue({
                authServerId: 'https://auth.example.com',
                clientId: 'test-client',
                enabled: true,
                scopes: ['read']
            });

            mockDiscoveryService.fetchServerMetadata.mockResolvedValue({
                token_endpoint: 'https://auth.example.com/token'
            });

            const canRetry = await httpClient.handleUnauthorized('server-1', response);

            expect(canRetry).toBe(true);
            expect(mockFlowManager.refreshAccessToken).toHaveBeenCalled();
        });

        it('should return false if no refresh token', async () => {
            const tokens: OAuthTokens = {
                accessToken: 'old-token',
                expiresAt: Date.now() + 3600000,
                tokenType: 'Bearer',
            };

            const response = new Response(null, { status: 401 });

            mockTokenStore.getTokens.mockResolvedValue(tokens);

            const canRetry = await httpClient.handleUnauthorized('server-1', response);

            expect(canRetry).toBe(false);
        });
    });
});
