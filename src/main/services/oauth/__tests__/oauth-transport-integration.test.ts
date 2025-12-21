import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTransport } from '../../mcp/transports';
import { OAuthService } from '../OAuthService';
import type { MCPServerConfig } from '../../../types/mcp';
import type { OAuthTokens } from '../types';

// Mock dependencies
vi.mock('../OAuthService');
vi.mock('../../preferencesService');
vi.mock('../../mcp/commandResolver', () => ({
    resolveCommand: vi.fn().mockResolvedValue({ command: 'node', args: ['server.js'] }),
    detectNodePaths: vi.fn().mockResolvedValue([]),
    getEnhancedPath: vi.fn().mockReturnValue(''),
}));
vi.mock('../../mcp/registry', () => ({
    loadMCPRegistry: vi.fn(),
}));

describe('OAuth Transport Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should create standard transport for non-OAuth server', async () => {
        const config: MCPServerConfig = {
            id: 'test-server',
            name: 'Test Server',
            transport: 'http',
            baseUrl: 'https://mcp.example.com',
            headers: {
                'X-Custom': 'value',
            },
        };

        const { client, transport } = await createTransport(config);

        expect(client).toBeDefined();
        expect(transport).toBeDefined();
        expect(OAuthService.prototype.ensureValidToken).not.toHaveBeenCalled();
    });

    it('should create OAuth transport for OAuth-enabled server', async () => {
        const config: MCPServerConfig = {
            id: 'oauth-server',
            name: 'OAuth Server',
            transport: 'http',
            baseUrl: 'https://mcp.example.com',
            oauth: {
                enabled: true,
                clientId: 'test-client',
            },
        };

        const tokens: OAuthTokens = {
            accessToken: 'test-token',
            refreshToken: 'refresh-token',
            expiresAt: Date.now() + 3600000,
            tokenType: 'Bearer',
        };

        // Mock OAuthService
        vi.spyOn(OAuthService.prototype, 'ensureValidToken').mockResolvedValue(tokens);

        const { client, transport } = await createTransport(config);

        expect(client).toBeDefined();
        expect(transport).toBeDefined();
        expect(OAuthService.prototype.ensureValidToken).toHaveBeenCalledWith('oauth-server');
    });

    it('should throw error if OAuth token retrieval fails', async () => {
        const config: MCPServerConfig = {
            id: 'oauth-server',
            name: 'OAuth Server',
            transport: 'http',
            baseUrl: 'https://mcp.example.com',
            oauth: {
                enabled: true,
                clientId: 'test-client',
            },
        };

        vi.spyOn(OAuthService.prototype, 'ensureValidToken').mockRejectedValue(
            new Error('No tokens found')
        );

        await expect(createTransport(config)).rejects.toThrow('OAuth transport creation failed');
    });

    it('should not use OAuth for stdio transport', async () => {
        const config: MCPServerConfig = {
            id: 'stdio-server',
            name: 'Stdio Server',
            transport: 'stdio',
            command: 'node',
            args: ['server.js'],
            oauth: {
                enabled: true, // Should be ignored for stdio (not handled in createOAuthTransport)
            },
        } as any;

        // Based on the implementation, if oauth is enabled it calls createOAuthTransport 
        // BUT only if isHttpTransport is true.
        // In createTransport: if (config.oauth?.enabled && isHttpTransport(transportType))

        // For stdio, it should call createStandardTransport which throws if command is missing or returns transport
        // However, createStandardTransport doesn't handle OAuth.

        const { client, transport } = await createTransport(config);
        expect(client).toBeDefined();
        expect(transport).toBeDefined();
        expect(OAuthService.prototype.ensureValidToken).not.toHaveBeenCalled();
    });
});
