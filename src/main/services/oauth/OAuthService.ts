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
            scopes = ['mcp:read', 'mcp:write'],
            clientId: providedClientId,
        } = params;

        logger.core.info('Starting OAuth authorization flow', {
            serverId,
            mcpServerUrl,
            hasProvidedClientId: !!providedClientId,
        });

        try {
            // Step 1: Discovery of Authorization Server
            logger.core.debug('Step 1: Discovering authorization server', {
                serverId,
            });

            const { authorizationServer: authServerId, metadata } =
                await this.discoveryService.discoverFromUnauthorized(mcpServerUrl);

            logger.core.info('Authorization server discovered', {
                serverId,
                authServerId,
                hasRegistration: !!metadata.registration_endpoint,
            });

            // Step 2: Dynamic Client Registration (if needed)
            let clientId = providedClientId;
            let clientSecret: string | undefined;

            if (!clientId) {
                logger.core.info(
                    'Step 2: No client_id provided, checking for Dynamic Client Registration'
                );

                // Check if AS supports Dynamic Client Registration
                if (this.discoveryService.supportsClientRegistration(metadata)) {
                    logger.core.info(
                        'Dynamic Client Registration supported, attempting registration'
                    );

                    try {
                        const credentials =
                            await this.discoveryService.registerClient(
                                metadata.registration_endpoint!,
                                authServerId
                            );

                        clientId = credentials.clientId;
                        clientSecret = credentials.clientSecret;

                        // Save credentials to preferences (encrypted)
                        await this.saveClientCredentials(serverId, credentials);

                        logger.core.info('Dynamic Client Registration successful', {
                            clientId: this.sanitizeForLog(clientId),
                            hasClientSecret: !!clientSecret,
                        });
                    } catch (registrationError) {
                        // Dynamic Registration failed
                        logger.core.error('Dynamic Client Registration failed', {
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
                    // No Dynamic Registration available
                    logger.core.warn(
                        'Dynamic Client Registration not supported by Authorization Server'
                    );

                    return {
                        success: false,
                        error: 'This Authorization Server does not support Dynamic Client Registration. Manual client configuration will be required (feature coming soon).',
                    };
                }
            } else {
                logger.core.info('Step 2: Using provided client_id', {
                    clientId: this.sanitizeForLog(clientId),
                });
            }

            // Step 3: Authorization flow (PKCE)
            logger.core.debug('Step 3: Starting authorization flow', {
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

            // Step 4: Token exchange
            logger.core.debug('Step 4: Exchanging code for tokens', {
                serverId,
            });

            const tokens = await this.flowManager.exchangeCodeForTokens({
                tokenEndpoint: metadata.token_endpoint,
                code,
                redirectUri: `http://127.0.0.1/callback`, // From loopback server
                clientId,
                codeVerifier: verifier,
                clientSecret, // Include if we have it from Dynamic Registration
            });

            logger.core.info('Tokens received', {
                serverId,
                expiresAt: new Date(tokens.expiresAt).toISOString(),
            });

            // Step 5: Save tokens and configuration
            logger.core.debug('Step 5: Saving tokens and config', {
                serverId,
            });

            await this.tokenStore.saveTokens(serverId, tokens);

            // Save OAuth configuration to preferences
            await this.saveOAuthConfig(serverId, {
                enabled: true,
                authServerId,
                clientId,
                clientSecret,
                scopes: tokens.scope?.split(' ') || scopes,
                redirectUri: 'http://127.0.0.1/callback',
            });

            logger.core.info('OAuth authorization flow completed successfully', {
                serverId,
            });

            return {
                success: true,
                tokens,
                metadata,
            };
        } catch (error) {
            logger.core.error('OAuth authorization flow failed', {
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

        logger.core.info('Client credentials saved', {
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
