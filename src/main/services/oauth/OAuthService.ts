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
import { OAUTH_REDIRECT_URI } from './constants';
import { safeStorage } from 'electron';
import { PreferencesService } from '../preferencesService';
import { getLogger } from '../logging';
import type {
    OAuthTokens,
    AuthorizationServerMetadata,
    OAuthServiceError,
    OAuthClientCredentials,
    TokenEndpointAuthMethod,
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
            // Resolve effective scopes: prefer parsed header -> provided -> later metadata/defaults
            let effectiveScopes = scopes;
            if ((!effectiveScopes || effectiveScopes.length === 0) && wwwAuthHeader) {
                const parsedHeader = this.discoveryService.parseWWWAuthenticate(wwwAuthHeader);
                if (parsedHeader.scope) {
                    effectiveScopes = parsedHeader.scope.split(/\s+/).filter(Boolean);
                }
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

            // If no scopes yet, prefer those advertised by the AS, else fallback to MCP defaults
            if (!effectiveScopes || effectiveScopes.length === 0) {
                effectiveScopes = metadata.scopes_supported && metadata.scopes_supported.length > 0
                    ? metadata.scopes_supported
                    : ['mcp:read', 'mcp:write'];
            }

            // Step 2: Pre-allocate redirect server (puerto fijo)
            logger.oauth.info('Step 2: Starting redirect server on fixed port');

            // Start redirect server - siempre usa el puerto fijo
            const redirectServer = this.flowManager['redirectServer'];
            const { redirectUri } = await redirectServer.start();

            logger.oauth.debug('Redirect server started on fixed port', {
                redirectUri,
                expectedUri: OAUTH_REDIRECT_URI,
            });

            // Validar que el redirectUri sea el esperado
            if (redirectUri !== OAUTH_REDIRECT_URI) {
                await redirectServer.stop();
                throw this.createError(
                    'AUTHORIZATION_FAILED',
                    'Redirect URI mismatch',
                    { redirectUri, expected: OAUTH_REDIRECT_URI }
                );
            }

            // Step 3: Dynamic Client Registration (if needed)
            let clientId = providedClientId;
            let clientSecret: string | undefined;
            let tokenEndpointAuthMethod: TokenEndpointAuthMethod = 'none';

            if (!clientId) {
                logger.oauth.info(
                    'Step 3: No client_id provided, checking existing credentials'
                );

                // Primero verificar si hay credenciales existentes válidas
                const existingCredentials = await this.getValidClientCredentials(serverId);

                if (existingCredentials) {
                    logger.oauth.info('Using existing valid client credentials', {
                        serverId,
                        clientId: this.sanitizeForLog(existingCredentials.clientId),
                        hasSecret: !!existingCredentials.clientSecret,
                    });

                    clientId = existingCredentials.clientId;
                    clientSecret = existingCredentials.clientSecret;
                    tokenEndpointAuthMethod = existingCredentials.tokenEndpointAuthMethod ?? 'none';
                } else {
                    // No hay credenciales válidas, intentar DCR
                    logger.oauth.info('No valid credentials, attempting Dynamic Client Registration');

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
                                    {
                                        redirectUris: [redirectUri],
                                        // Por ahora, seguimos como public client
                                        // En fases futuras, esto podría venir de configuración
                                        preferConfidential: false,
                                    }
                                );

                            clientId = credentials.clientId;
                            clientSecret = credentials.clientSecret;
                            tokenEndpointAuthMethod = credentials.tokenEndpointAuthMethod ?? 'none';

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
                tokenEndpointAuthMethod,
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
            this.preferencesService.delete(`mcpServers.${serverId}.oauth`);

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
     * Save client credentials to preferences (plaintext)
     *
     * @param serverId - MCP server ID
     * @param credentials - Client credentials from Dynamic Registration
     */
    private async saveClientCredentials(
        serverId: string,
        credentials: OAuthClientCredentials
    ): Promise<void> {
        // Store in plaintext — file is in ~/levante/ with user-only access
        const toSave = {
            ...credentials,
            clientSecret: credentials.clientSecret || undefined,
            registrationMetadata: credentials.registrationMetadata
                ? {
                    ...credentials.registrationMetadata,
                    registration_access_token:
                        credentials.registrationMetadata.registration_access_token || undefined,
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
     * Get client credentials from preferences
     * Handles legacy ENCRYPTED: values via safeStorage migration
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

        // Read values, handling legacy ENCRYPTED: prefix via safeStorage migration
        const decryptIfLegacy = (value: string | undefined): string | undefined => {
            if (!value) return undefined;
            if (!value.startsWith('ENCRYPTED:')) return value;
            try {
                return safeStorage.decryptString(
                    Buffer.from(value.replace('ENCRYPTED:', ''), 'base64')
                );
            } catch {
                logger.oauth.error('Failed to decrypt legacy client credential');
                return undefined;
            }
        };

        const result: OAuthClientCredentials = {
            ...stored,
            clientSecret: decryptIfLegacy(stored.clientSecret),
            registrationMetadata: stored.registrationMetadata
                ? {
                    ...stored.registrationMetadata,
                    registration_access_token: decryptIfLegacy(
                        stored.registrationMetadata.registration_access_token
                    ),
                }
                : undefined,
        };

        // Re-save as plaintext if any legacy encrypted values were found
        const hadEncrypted =
            stored.clientSecret?.startsWith('ENCRYPTED:') ||
            stored.registrationMetadata?.registration_access_token?.startsWith('ENCRYPTED:');
        if (hadEncrypted) {
            logger.oauth.info('Migrating legacy encrypted client credentials to plaintext', { serverId });
            await this.saveClientCredentials(serverId, result);
        }

        return result;
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

    /**
     * Verifica si el client_secret ha expirado
     * RFC 7591: client_secret_expires_at = 0 significa que nunca expira
     *
     * @param credentials - Credenciales del cliente
     * @returns true si el secret es válido (no expirado), false si expiró
     */
    private isClientSecretValid(credentials: OAuthClientCredentials): boolean {
        const expiresAt = credentials.registrationMetadata?.client_secret_expires_at;

        // 0 = nunca expira (RFC 7591)
        if (!expiresAt || expiresAt === 0) {
            return true;
        }

        // Añadir buffer de 5 minutos para evitar race conditions
        const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
        const expiresAtMs = expiresAt * 1000; // RFC 7591 usa segundos

        return Date.now() < expiresAtMs - EXPIRY_BUFFER_MS;
    }

    /**
     * Obtiene credenciales válidas, verificando:
     * 1. Que existan
     * 2. Que el client_secret no haya expirado
     * 3. Que el redirect_uri coincida con el fijo actual
     *
     * Si el redirect_uri no coincide, las credenciales se invalidan
     * y se retorna null para forzar nuevo DCR.
     *
     * @param serverId - ID del servidor MCP
     * @returns Credenciales válidas o null si no hay/no se pueden usar
     */
    async getValidClientCredentials(
        serverId: string
    ): Promise<OAuthClientCredentials | null> {
        const credentials = await this.getClientCredentials(serverId);

        if (!credentials) {
            logger.oauth.debug('No client credentials found', { serverId });
            return null;
        }

        // NUEVO: Verificar que el redirect_uri coincida con el fijo actual
        const storedConfig = await this.preferencesService.get(
            `mcpServers.${serverId}.oauth`
        ) as any;

        if (storedConfig?.redirectUri && storedConfig.redirectUri !== OAUTH_REDIRECT_URI) {
            logger.oauth.warn('Stored redirect_uri does not match fixed port, invalidating credentials', {
                serverId,
                storedRedirectUri: storedConfig.redirectUri,
                expectedRedirectUri: OAUTH_REDIRECT_URI,
            });

            // Eliminar credenciales con redirect_uri antiguo
            await this.deleteClientCredentials(serverId);

            // También limpiar el oauth config
            this.preferencesService.delete(`mcpServers.${serverId}.oauth`);

            // Notificar que las credenciales fueron invalidadas
            this.notifyCredentialsExpired(serverId, 'registration_revoked');

            return null;
        }

        // Verificar expiración del client_secret
        if (!this.isClientSecretValid(credentials)) {
            logger.oauth.warn('Client secret expired', {
                serverId,
                expiresAt: credentials.registrationMetadata?.client_secret_expires_at,
                clientId: this.sanitizeForLog(credentials.clientId),
            });

            // Si tiene registration_client_uri, intentar actualizar
            if (credentials.registrationMetadata?.registration_client_uri) {
                try {
                    logger.oauth.info('Attempting client re-registration', { serverId });
                    const newCredentials = await this.refreshClientRegistration(
                        serverId,
                        credentials
                    );
                    return newCredentials;
                } catch (error) {
                    logger.oauth.error('Failed to refresh client registration', {
                        serverId,
                        error: error instanceof Error ? error.message : error,
                    });

                    // Eliminar credenciales expiradas
                    await this.deleteClientCredentials(serverId);

                    // Notificar al usuario
                    this.notifyCredentialsExpired(serverId, 'client_secret_expired');

                    return null;
                }
            }

            // No se puede actualizar, eliminar credenciales expiradas
            logger.oauth.warn(
                'Cannot refresh registration, deleting expired credentials',
                { serverId }
            );
            await this.deleteClientCredentials(serverId);

            // Notificar al usuario
            this.notifyCredentialsExpired(serverId, 'client_secret_expired');

            return null;
        }

        return credentials;
    }

    /**
     * Intenta refrescar el registro del cliente usando registration_client_uri
     * RFC 7592: OAuth 2.0 Dynamic Client Registration Management Protocol
     *
     * @param serverId - ID del servidor
     * @param credentials - Credenciales actuales (expiradas)
     */
    private async refreshClientRegistration(
        serverId: string,
        credentials: OAuthClientCredentials
    ): Promise<OAuthClientCredentials> {
        const registrationUri = credentials.registrationMetadata?.registration_client_uri;
        const registrationToken = credentials.registrationMetadata?.registration_access_token;

        if (!registrationUri || !registrationToken) {
            throw this.createError(
                'CLIENT_REREGISTRATION_FAILED',
                'Missing registration URI or token',
                { serverId }
            );
        }

        logger.oauth.debug('Refreshing client registration', {
            serverId,
            registrationUri: this.sanitizeForLog(registrationUri),
        });

        // GET current registration
        const response = await fetch(registrationUri, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${registrationToken}`,
                Accept: 'application/json',
            },
        });

        if (!response.ok) {
            throw this.createError(
                'CLIENT_REREGISTRATION_FAILED',
                `Registration refresh failed: ${response.status}`,
                { serverId, status: response.status }
            );
        }

        const registrationResponse = (await response.json()) as any;

        // Crear nuevas credenciales
        const newCredentials: OAuthClientCredentials = {
            clientId: registrationResponse.client_id,
            clientSecret: registrationResponse.client_secret,
            registeredAt: Date.now(),
            authServerId: credentials.authServerId,
            tokenEndpointAuthMethod: credentials.tokenEndpointAuthMethod,
            registrationMetadata: {
                client_secret_expires_at: registrationResponse.client_secret_expires_at,
                registration_access_token: registrationResponse.registration_access_token || registrationToken,
                registration_client_uri: registrationResponse.registration_client_uri || registrationUri,
            },
        };

        // Guardar nuevas credenciales
        await this.saveClientCredentials(serverId, newCredentials);

        logger.oauth.info('Client registration refreshed successfully', {
            serverId,
            clientId: this.sanitizeForLog(newCredentials.clientId),
            newExpiresAt: newCredentials.registrationMetadata?.client_secret_expires_at,
        });

        return newCredentials;
    }

    /**
     * Limpia TODAS las credenciales OAuth de un servidor (tokens + client credentials + config)
     * Usado cuando se elimina un MCP para evitar credenciales huérfanas.
     *
     * A diferencia de disconnect(), este método:
     * - NO intenta revocar tokens (el servidor ya no existe en config)
     * - Limpia TODO: tokens, client credentials y oauth config
     */
    async cleanupCredentials(serverId: string): Promise<void> {
        logger.oauth.info('Cleaning up all OAuth credentials for removed server', { serverId });

        try {
            // 1. Eliminar tokens (access_token, refresh_token)
            await this.tokenStore.deleteTokens(serverId);

            // 2. Eliminar client credentials (client_id, client_secret)
            await this.deleteClientCredentials(serverId);

            // 3. Eliminar oauth config completo
            this.preferencesService.delete(`mcpServers.${serverId}.oauth`);

            logger.oauth.info('OAuth credentials cleaned up successfully', { serverId });
        } catch (error) {
            // Log pero no fallar - la limpieza es best-effort
            logger.oauth.error('Error cleaning up OAuth credentials', {
                serverId,
                error: error instanceof Error ? error.message : error,
            });
        }
    }

    /**
     * Elimina credenciales de cliente del almacenamiento
     */
    async deleteClientCredentials(serverId: string): Promise<void> {
        this.preferencesService.delete(
            `mcpServers.${serverId}.oauth.clientCredentials`
        );

        logger.oauth.info('Client credentials deleted', { serverId });
    }

    /**
     * Notifica al renderer que las credenciales expiraron
     * El renderer mostrará un mensaje al usuario
     */
    private notifyCredentialsExpired(
        serverId: string,
        reason: 'client_secret_expired' | 'registration_revoked'
    ): void {
        // Import BrowserWindow lazily to avoid circular deps
        const electron = require('electron');
        const BrowserWindow = electron.BrowserWindow || (electron.default && electron.default.BrowserWindow);

        if (!BrowserWindow) {
            logger.oauth.warn('Could not find BrowserWindow to send notification');
            return;
        }

        const mainWindow = BrowserWindow.getAllWindows()[0];

        if (mainWindow) {
            mainWindow.webContents.send('levante/oauth/credentials-expired', {
                serverId,
                reason,
                timestamp: Date.now(),
            });

            logger.oauth.info('Credentials expiration notification sent', {
                serverId,
                reason,
            });
        }
    }
}
