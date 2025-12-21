/**
 * OAuthService - High-level OAuth orchestrator
 *
 * Provides unified API for:
 * - Discovery and authorization
 * - Token management
 * - Connection lifecycle
 */

import { OAuthDiscoveryService } from './OAuthDiscoveryService';
import { OAuthFlowManager } from './OAuthFlowManager';
import { OAuthTokenStore } from './OAuthTokenStore';
import { OAuthHttpClient } from './OAuthHttpClient';
import { PreferencesService } from '../preferencesService';
import { getLogger } from '../logging';
import type {
    OAuthTokens,
    AuthorizationServerMetadata,
    OAuthServiceError,
} from './types';

const logger = getLogger();

export interface AuthorizeParams {
    serverId: string;
    mcpServerUrl: string;
    scopes?: string[];
    clientId?: string;  // Optional: from Dynamic Registration in Phase 5
}

export interface AuthorizeResult {
    success: boolean;
    tokens?: OAuthTokens;
    metadata?: AuthorizationServerMetadata;
    error?: string;
}

export interface DisconnectParams {
    serverId: string;
    revokeTokens?: boolean;  // Phase 6: Token revocation
}

export class OAuthService {
    private discoveryService: OAuthDiscoveryService;
    private flowManager: OAuthFlowManager;
    private tokenStore: OAuthTokenStore;
    private httpClient: OAuthHttpClient;
    private preferencesService: PreferencesService;

    constructor(preferencesService: PreferencesService) {
        this.preferencesService = preferencesService;
        this.discoveryService = new OAuthDiscoveryService();
        this.flowManager = new OAuthFlowManager();
        this.tokenStore = new OAuthTokenStore(preferencesService);
        this.httpClient = new OAuthHttpClient(preferencesService);
    }

    /**
     * Complete OAuth authorization flow for MCP server
     *
     * Steps:
     * 1. Discovery: Find authorization server
     * 2. Authorization: Open browser, get code
     * 3. Token exchange: Get access/refresh tokens
     * 4. Save: Store tokens and config
     */
    async authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
        const { serverId, mcpServerUrl, scopes, clientId } = params;

        logger.core.info('Starting OAuth authorization', {
            serverId,
            mcpServerUrl,
        });

        try {
            // 1. Discovery
            logger.core.debug('Step 1: Discovering authorization server', {
                serverId,
            });

            const { authorizationServer, metadata } =
                await this.discoveryService.discoverFromUnauthorized(mcpServerUrl);

            logger.core.info('Authorization server discovered', {
                serverId,
                authServer: authorizationServer,
                hasRegistration: !!metadata.registration_endpoint,
            });

            // 2. Validate client ID
            if (!clientId) {
                // Phase 5: Dynamic Client Registration
                // For now, require manual client ID
                throw this.createError(
                    'NO_CLIENT_ID',
                    'Client ID required. Dynamic registration not yet implemented.',
                    { serverId }
                );
            }

            // 3. Authorization flow
            logger.core.debug('Step 2: Starting authorization flow', {
                serverId,
            });

            const { code, verifier } = await this.flowManager.authorize({
                serverId,
                authorizationEndpoint: metadata.authorization_endpoint,
                clientId,
                scopes: scopes || metadata.scopes_supported || ['mcp:read', 'mcp:write'],
                resource: mcpServerUrl,
            });

            logger.core.info('Authorization code received', {
                serverId,
            });

            // 4. Token exchange
            logger.core.debug('Step 3: Exchanging code for tokens', {
                serverId,
            });

            const tokens = await this.flowManager.exchangeCodeForTokens({
                tokenEndpoint: metadata.token_endpoint,
                code,
                redirectUri: `http://127.0.0.1/callback`, // From loopback server
                clientId,
                codeVerifier: verifier,
            });

            logger.core.info('Tokens received', {
                serverId,
                expiresAt: new Date(tokens.expiresAt).toISOString(),
            });

            // 5. Save tokens
            logger.core.debug('Step 4: Saving tokens and config', {
                serverId,
            });

            await this.tokenStore.saveTokens(serverId, tokens);

            // 6. Save OAuth config
            await this.preferencesService.set(`mcpServers.${serverId}.oauth`, {
                enabled: true,
                authServerId: authorizationServer,
                clientId,
                scopes: tokens.scope?.split(' ') || scopes,
            });

            logger.core.info('OAuth authorization completed successfully', {
                serverId,
            });

            return {
                success: true,
                tokens,
                metadata,
            };
        } catch (error) {
            logger.core.error('OAuth authorization failed', {
                serverId,
                error: error instanceof Error ? error.message : error,
            });

            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Ensure valid token exists for server
     * Used by transports before making requests
     */
    async ensureValidToken(serverId: string): Promise<OAuthTokens> {
        return this.httpClient.ensureValidToken(serverId);
    }

    /**
     * Get authentication headers for HTTP request
     */
    async getAuthHeaders(serverId: string): Promise<Record<string, string>> {
        return this.httpClient.getAuthHeaders(serverId);
    }

    /**
     * Handle 401 Unauthorized response
     */
    async handleUnauthorized(
        serverId: string,
        response: Response
    ): Promise<boolean> {
        return this.httpClient.handleUnauthorized(serverId, response);
    }

    /**
     * Disconnect server and optionally revoke tokens
     */
    async disconnect(params: DisconnectParams): Promise<void> {
        const { serverId, revokeTokens = false } = params;

        logger.core.info('Disconnecting OAuth server', {
            serverId,
            revokeTokens,
        });

        // Phase 6: Token revocation
        if (revokeTokens) {
            logger.core.warn('Token revocation not yet implemented (Phase 6)', {
                serverId,
            });
        }

        // Delete tokens
        await this.tokenStore.deleteTokens(serverId);

        // Remove OAuth config
        await this.preferencesService.set(`mcpServers.${serverId}.oauth`, undefined);

        logger.core.info('Server disconnected', { serverId });
    }

    /**
     * Check if server has valid OAuth configuration
     */
    async hasValidConfig(serverId: string): Promise<boolean> {
        const config = await this.preferencesService.get(
            `mcpServers.${serverId}.oauth`
        );

        return !!(config && (config as any).enabled && (config as any).clientId);
    }

    /**
     * Check if server has valid tokens
     */
    async hasValidTokens(serverId: string): Promise<boolean> {
        const tokens = await this.tokenStore.getTokens(serverId);

        if (!tokens) return false;

        // Check if expired
        return !this.tokenStore.isTokenExpired(tokens);
    }

    /**
     * Create typed error
     *
     * @private
     */
    private createError(
        code: OAuthServiceError['code'],
        message: string,
        details?: Record<string, unknown>
    ): OAuthServiceError {
        const error = new Error(message) as OAuthServiceError;
        error.code = code;
        error.details = details;
        return error;
    }
}
