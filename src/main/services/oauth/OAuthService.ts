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
import { safeStorage } from 'electron';
import { PreferencesService } from '../preferencesService';
import { getLogger } from '../logging';
import type {
    OAuthTokens,
    AuthorizationServerMetadata,
    OAuthServiceError,
    OAuthClientCredentials,
} from './types';

const logger = getLogger();

export interface AuthorizeParams {
    serverId: string;
    mcpServerUrl: string;
    scopes?: string[];
    clientId?: string;  // Optional: from Dynamic Registration in Phase 5
    wwwAuthHeader?: string;
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
     * Flow:
     * 1. Discovery: Find authorization server
     * 2. Dynamic Client Registration (if needed and supported)
     * 3. Authorization flow: Open browser, get code (PKCE)
     * 4. Token exchange: Get access/refresh tokens
     * 5. Save: Store tokens and config
     */
    async authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
        const {
            serverId,
            mcpServerUrl,
            scopes,
            clientId: providedClientId,
            wwwAuthHeader,
        } = params;

        logger.oauth.info('Starting OAuth authorization flow', {
            serverId,
            mcpServerUrl,
            hasProvidedClientId: !!providedClientId,
        });

        try {
            // Resolve effective scopes: prefer parsed header -> provided -> defaults
            let effectiveScopes = scopes;
            if ((!effectiveScopes || effectiveScopes.length === 0) && wwwAuthHeader) {
                const parsedHeader = this.discoveryService.parseWWWAuthenticate(wwwAuthHeader);
                if (parsedHeader.scope) {
                    effectiveScopes = parsedHeader.scope.split(/\s+/).filter(Boolean);
                }
            }
            if (!effectiveScopes || effectiveScopes.length === 0) {
                effectiveScopes = ['mcp:read', 'mcp:write'];
            }

            // Step 1: Discovery of Authorization Server
            logger.oauth.debug('Step 1: Discovering authorization server', {
                serverId,
                scopes: effectiveScopes,
            });

            const { authorizationServer: authServerId, metadata } =
                await this.discoveryService.discoverFromUnauthorized(
                    mcpServerUrl,
                    wwwAuthHeader
                );

            logger.oauth.info('Authorization server discovered', {
                serverId,
                authServerId,
                hasRegistration: !!metadata.registration_endpoint,
            });

            // Step 2: Pre-allocate redirect server port (for DCR consistency)
            logger.oauth.info('Step 2: Pre-allocating redirect server port');

            // Start redirect server to get the port we'll use
            const redirectServer = this.flowManager['redirectServer'];
            const { redirectUri } = await redirectServer.start();

            logger.oauth.debug('Redirect server started', {
                redirectUri,
            });

            // Step 3: Dynamic Client Registration (if needed)
            let clientId = providedClientId;
            let clientSecret: string | undefined;

            if (!clientId) {
                logger.oauth.info(
                    'Step 3: No client_id provided, attempting Dynamic Client Registration'
                );

                // Check if AS supports Dynamic Client Registration
                if (this.discoveryService.supportsClientRegistration(metadata)) {
                    logger.oauth.info(
                        'Dynamic Client Registration supported, attempting registration'
                    );

                    try {
                        const credentials =
                            await this.discoveryService.registerClient(
                                metadata.registration_endpoint!,
                                authServerId,
                                [redirectUri] // Pass the pre-allocated redirect URI
                            );

                        clientId = credentials.clientId;
                        clientSecret = credentials.clientSecret;

                        // Save credentials to preferences (encrypted)
                        await this.saveClientCredentials(serverId, credentials);

                        logger.oauth.info('Dynamic Client Registration successful', {
                            clientId: this.sanitizeForLog(clientId),
                            hasClientSecret: !!clientSecret,
                        });
                    } catch (registrationError) {
                        // Cleanup redirect server
                        await redirectServer.stop();

                        // Dynamic Registration failed
                        logger.oauth.error('Dynamic Client Registration failed', {
                            error:
                                registrationError instanceof Error
                                    ? registrationError.message
                                    : registrationError,
                        });

                        // For now, we throw an error informing the user
                        return {
                            success: false,
                            error: `Dynamic Client Registration failed: ${registrationError instanceof Error
                                ? registrationError.message
                                : 'Unknown error'
                                }. This server requires manual client configuration (feature coming soon).`,
                        };
                    }
                } else {
                    // Cleanup redirect server
                    await redirectServer.stop();

                    // No Dynamic Registration available
                    logger.oauth.warn(
                        'Dynamic Client Registration not supported by Authorization Server'
                    );

                    return {
                        success: false,
                        error: 'This Authorization Server does not support Dynamic Client Registration. Manual client configuration will be required (feature coming soon).',
                    };
                }
            } else {
                logger.oauth.info('Step 3: Using provided client_id', {
                    clientId: this.sanitizeForLog(clientId),
                });
            }

            // Step 4: Authorization flow (PKCE) - reuse existing redirect server
            logger.oauth.debug('Step 4: Starting authorization flow', {
                serverId,
            });

            const authResult = await this.flowManager.authorize({
                serverId,
                authorizationEndpoint: metadata.authorization_endpoint,
                clientId,
                scopes: effectiveScopes || metadata.scopes_supported || ['mcp:read', 'mcp:write'],
                resource: mcpServerUrl,
                existingRedirectUri: redirectUri, // Reuse the same redirect URI
            });

            // Cleanup redirect server now that we have the auth code
            await redirectServer.stop();

            logger.oauth.info('Authorization code received', {
                serverId,
            });

            // Step 5: Token exchange
            logger.oauth.debug('Step 5: Exchanging code for tokens', {
                serverId,
            });

            const tokens = await this.flowManager.exchangeCodeForTokens({
                tokenEndpoint: metadata.token_endpoint,
                code: authResult.code,
                redirectUri: authResult.redirectUri, // Use the exact redirect URI from the flow
                clientId,
                codeVerifier: authResult.verifier,
                clientSecret, // Include if we have it from Dynamic Registration
            });

            logger.oauth.info('Tokens received', {
                serverId,
                expiresAt: new Date(tokens.expiresAt).toISOString(),
            });

            // Step 6: Save tokens and configuration
            logger.oauth.debug('Step 6: Saving tokens and config', {
                serverId,
            });

            await this.tokenStore.saveTokens(serverId, tokens);

            // Save OAuth configuration to preferences
            await this.saveOAuthConfig(serverId, {
                enabled: true,
                authServerId,
                clientId,
                clientSecret,
                scopes: tokens.scope?.split(' ') || effectiveScopes,
                redirectUri: authResult.redirectUri,
            });

            logger.oauth.info('OAuth authorization flow completed successfully', {
                serverId,
            });

            return {
                success: true,
                tokens,
                metadata,
            };
        } catch (error) {
            logger.oauth.error('OAuth authorization flow failed', {
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
     * Obtiene un token existente sin forzar autorización
     * Retorna null si no hay token o está expirado
     */
    async getExistingToken(serverId: string): Promise<OAuthTokens | null> {
        try {
            const tokens = await this.tokenStore.getTokens(serverId);

            if (!tokens) {
                return null;
            }

            // Si está expirado pero tiene refresh token, intentar refrescar
            if (this.tokenStore.isTokenExpired(tokens) && tokens.refreshToken) {
                logger.oauth.debug('Token expired, attempting refresh', { serverId });
                return await this.httpClient.refreshToken(serverId);
            }

            return tokens;
        } catch (error) {
            logger.oauth.debug('No existing token available', {
                serverId,
                error: error instanceof Error ? error.message : error
            });
            return null;
        }
    }

    /**
     * Obtiene el token válido o lanza error (usado internamente)
     */
    async ensureValidToken(serverId: string): Promise<OAuthTokens> {
        const token = await this.getExistingToken(serverId);

        if (!token) {
            throw new Error(`No valid OAuth token for server: ${serverId}`);
        }

        return token;
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
     * Disconnect server and optionally revoke tokens (Fase 6)
     */
    async disconnect(params: DisconnectParams): Promise<void> {
        const { serverId, revokeTokens = true } = params; // Default: true

        logger.oauth.info('Disconnecting OAuth server', {
            serverId,
            revokeTokens,
        });

        try {
            // Fase 6: Token revocation
            if (revokeTokens) {
                logger.oauth.info('Attempting token revocation', { serverId });

                // Get tokens
                const tokens = await this.tokenStore.getTokens(serverId);

                // Get OAuth config
                const config = (await this.preferencesService.get(
                    `mcpServers.${serverId}.oauth`
                )) as any;

                if (tokens && config?.authServerId) {
                    try {
                        // Get auth server metadata
                        const metadata = await this.discoveryService.fetchServerMetadata(
                            config.authServerId
                        );

                        // Check if revocation is supported
                        if (metadata.revocation_endpoint) {
                            // Revocar refresh token primero (invalida también el access token en muchos AS)
                            if (tokens.refreshToken) {
                                await this.flowManager.revokeToken({
                                    revocationEndpoint: metadata.revocation_endpoint,
                                    token: tokens.refreshToken,
                                    tokenTypeHint: 'refresh_token',
                                    clientId: config.clientId!,
                                    clientSecret: config.clientSecret,
                                });

                                logger.oauth.info('Refresh token revoked', { serverId });
                            }

                            // Revocar access token
                            await this.flowManager.revokeToken({
                                revocationEndpoint: metadata.revocation_endpoint,
                                token: tokens.accessToken,
                                tokenTypeHint: 'access_token',
                                clientId: config.clientId!,
                                clientSecret: config.clientSecret,
                            });

                            logger.oauth.info('Access token revoked', { serverId });
                        } else {
                            logger.oauth.warn(
                                'Authorization server does not support token revocation',
                                {
                                    serverId,
                                    authServerId: config.authServerId,
                                }
                            );
                        }
                    } catch (revocationError) {
                        // Log error but continue with disconnect
                        logger.oauth.error(
                            'Token revocation failed, continuing with disconnect',
                            {
                                serverId,
                                error:
                                    revocationError instanceof Error
                                        ? revocationError.message
                                        : revocationError,
                            }
                        );
                    }
                }
            }

            // Delete tokens (siempre, incluso si revocación falló)
            await this.tokenStore.deleteTokens(serverId);

            // Remove OAuth config
            await this.preferencesService.set(`mcpServers.${serverId}.oauth`, undefined);

            logger.oauth.info('Server disconnected successfully', { serverId });
        } catch (error) {
            logger.oauth.error('Error during disconnect', {
                serverId,
                error: error instanceof Error ? error.message : error,
            });

            throw error;
        }
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

    /**
     * Save client credentials to preferences (encrypted)
     *
     * @param serverId - MCP server ID
     * @param credentials - Client credentials from Dynamic Registration
     */
    private async saveClientCredentials(
        serverId: string,
        credentials: OAuthClientCredentials
    ): Promise<void> {
        // Encrypt sensitive fields
        const toSave = {
            ...credentials,
            clientSecret: credentials.clientSecret
                ? `ENCRYPTED:${safeStorage
                    .encryptString(credentials.clientSecret)
                    .toString('base64')}`
                : undefined,
            registrationMetadata: credentials.registrationMetadata
                ? {
                    ...credentials.registrationMetadata,
                    registration_access_token: credentials
                        .registrationMetadata.registration_access_token
                        ? `ENCRYPTED:${safeStorage
                            .encryptString(
                                credentials.registrationMetadata
                                    .registration_access_token
                            )
                            .toString('base64')}`
                        : undefined,
                }
                : undefined,
        };

        await this.preferencesService.set(
            `mcpServers.${serverId}.oauth.clientCredentials`,
            toSave
        );

        logger.oauth.info('Client credentials saved', {
            serverId,
            clientId: this.sanitizeForLog(credentials.clientId),
        });
    }

    /**
     * Get client credentials from preferences (decrypted)
     *
     * @param serverId - MCP server ID
     * @returns Client credentials or null if not found
     */
    private async getClientCredentials(
        serverId: string
    ): Promise<OAuthClientCredentials | null> {
        const stored = await this.preferencesService.get(
            `mcpServers.${serverId}.oauth.clientCredentials`
        );

        if (!stored) {
            return null;
        }

        // Decrypt sensitive fields
        return {
            ...stored,
            clientSecret:
                stored.clientSecret &&
                    stored.clientSecret.startsWith('ENCRYPTED:')
                    ? safeStorage.decryptString(
                        Buffer.from(
                            stored.clientSecret.replace('ENCRYPTED:', ''),
                            'base64'
                        )
                    )
                    : stored.clientSecret,
            registrationMetadata: stored.registrationMetadata
                ? {
                    ...stored.registrationMetadata,
                    registration_access_token:
                        stored.registrationMetadata
                            .registration_access_token &&
                            stored.registrationMetadata.registration_access_token.startsWith(
                                'ENCRYPTED:'
                            )
                            ? safeStorage.decryptString(
                                Buffer.from(
                                    stored.registrationMetadata.registration_access_token.replace(
                                        'ENCRYPTED:',
                                        ''
                                    ),
                                    'base64'
                                )
                            )
                            : stored.registrationMetadata
                                .registration_access_token,
                }
                : undefined,
        };
    }

    /**
     * Save OAuth configuration to preferences
     *
     * @param serverId - MCP server ID
     * @param config - OAuth configuration
     */
    private async saveOAuthConfig(
        serverId: string,
        config: {
            enabled: boolean;
            authServerId: string;
            clientId: string;
            clientSecret?: string;
            scopes: string[];
            redirectUri: string;
        }
    ): Promise<void> {
        await this.preferencesService.set(`mcpServers.${serverId}.oauth`, {
            ...config,
            // Keep existing clientCredentials if they exist
            clientCredentials: await this.getClientCredentials(serverId),
        });
    }

    /**
     * Sanitize sensitive data for logging
     *
     * @param value - Value to sanitize
     * @returns Sanitized value (first 8 chars + redacted)
     */
    private sanitizeForLog(value: string): string {
        if (!value || value.length < 16) return '[REDACTED]';
        return `${value.substring(0, 8)}...[REDACTED]`;
    }
}
