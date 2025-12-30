/**
 * OAuthHttpClient - HTTP client con auto-refresh de tokens OAuth
 *
 * Responsabilidades:
 * - Obtener tokens válidos para requests HTTP
 * - Auto-refresh de tokens expirados
 * - Manejar respuestas 401
 * - Proveer headers de autenticación
 */

import { OAuthTokenStore } from './OAuthTokenStore';
import { OAuthFlowManager } from './OAuthFlowManager';
import { OAuthDiscoveryService } from './OAuthDiscoveryService';
import { PreferencesService } from '../preferencesService';
import { getLogger } from '../logging';
import type {
    OAuthTokens,
    OAuthServerConfig,
    OAuthHttpClientError,
} from './types';

const logger = getLogger();

export class OAuthHttpClient {
    private tokenStore: OAuthTokenStore;
    private flowManager: OAuthFlowManager;
    private discoveryService: OAuthDiscoveryService;
    private preferencesService: PreferencesService;

    constructor(preferencesService: PreferencesService) {
        this.preferencesService = preferencesService;
        this.tokenStore = new OAuthTokenStore(preferencesService);
        this.flowManager = new OAuthFlowManager();
        this.discoveryService = new OAuthDiscoveryService();
    }

    /**
     * Ensure valid token exists for serverId
     * Refreshes automatically if expired
     *
     * @throws OAuthHttpClientError if no tokens or refresh fails
     */
    async ensureValidToken(serverId: string): Promise<OAuthTokens> {
        logger.oauth.debug('Ensuring valid token', { serverId });

        // 1. Get current tokens
        let tokens = await this.tokenStore.getTokens(serverId);

        if (!tokens) {
            throw this.createError(
                'NO_TOKENS',
                'No OAuth tokens found. Please authorize first.',
                { serverId }
            );
        }

        // 2. Check expiration
        if (this.tokenStore.isTokenExpired(tokens)) {
            logger.oauth.info('Access token expired, refreshing', { serverId });
            tokens = await this.refreshToken(serverId, tokens);
        }

        return tokens;
    }

    /**
     * Get authorization headers for HTTP request
     */
    async getAuthHeaders(serverId: string): Promise<Record<string, string>> {
        const tokens = await this.ensureValidToken(serverId);

        return {
            Authorization: `${tokens.tokenType} ${tokens.accessToken}`,
        };
    }

    /**
     * Handle 401 Unauthorized response
     * Attempts token refresh and returns retry decision
     *
     * @returns true if request should be retried, false otherwise
     */
    async handleUnauthorized(
        serverId: string,
        response: Response
    ): Promise<boolean> {
        logger.oauth.warn('Received 401 Unauthorized', {
            serverId,
            status: response.status,
        });

        // Parse WWW-Authenticate header for diagnostics
        const wwwAuth = response.headers.get('WWW-Authenticate');
        if (wwwAuth) {
            const parsed = this.discoveryService.parseWWWAuthenticate(wwwAuth);
            logger.oauth.debug('WWW-Authenticate header', {
                serverId,
                parsed,
            });
        }

        try {
            // Get current tokens
            const tokens = await this.tokenStore.getTokens(serverId);

            if (!tokens?.refreshToken) {
                logger.oauth.error('No refresh token available', { serverId });
                return false;
            }

            // Attempt refresh
            await this.refreshToken(serverId, tokens);

            logger.oauth.info('Token refreshed after 401, retry possible', {
                serverId,
            });

            return true; // Retry the request
        } catch (error) {
            logger.oauth.error('Failed to handle 401', {
                serverId,
                error: error instanceof Error ? error.message : error,
            });

            return false; // Cannot retry
        }
    }

    /**
     * Refresh access token using refresh token
     */
    async refreshToken(
        serverId: string,
        oldTokens?: OAuthTokens
    ): Promise<OAuthTokens> {
        if (!oldTokens) {
            const storedTokens = await this.tokenStore.getTokens(serverId);
            if (!storedTokens) {
                throw this.createError(
                    'NO_TOKENS',
                    'No tokens available to refresh',
                    { serverId }
                );
            }
            oldTokens = storedTokens;
        }

        if (!oldTokens.refreshToken) {
            throw this.createError(
                'NO_REFRESH_TOKEN',
                'No refresh token available. Re-authorization required.',
                { serverId }
            );
        }

        try {
            // 1. Get OAuth config from preferences
            const oauthConfig = await this.getOAuthConfig(serverId);

            // 2. Get auth server metadata
            const metadata = await this.discoveryService.fetchServerMetadata(
                oauthConfig.authServerId
            );

            logger.oauth.debug('Refreshing token', {
                serverId,
                tokenEndpoint: metadata.token_endpoint,
            });

            // 3. Refresh tokens
            const newTokens = await this.flowManager.refreshAccessToken({
                tokenEndpoint: metadata.token_endpoint,
                refreshToken: oldTokens.refreshToken,
                clientId: oauthConfig.clientId,
                clientSecret: oauthConfig.clientSecret,
            });

            // 4. Save new tokens
            await this.tokenStore.saveTokens(serverId, newTokens);

            logger.oauth.info('Successfully refreshed access token', {
                serverId,
                expiresAt: new Date(newTokens.expiresAt).toISOString(),
            });

            return newTokens;
        } catch (error) {
            logger.oauth.error('Failed to refresh token', {
                serverId,
                error: error instanceof Error ? error.message : error,
            });

            // Delete invalid tokens
            await this.tokenStore.deleteTokens(serverId);

            throw this.createError(
                'REFRESH_FAILED',
                'Token refresh failed. Re-authorization required.',
                {
                    serverId,
                    originalError: error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    /**
     * Get OAuth configuration for server
     *
     * @private
     */
    private async getOAuthConfig(serverId: string): Promise<OAuthServerConfig> {
        const config = (await this.preferencesService.get(
            `mcpServers.${serverId}.oauth`
        )) as any;

        if (!config) {
            throw this.createError(
                'NO_OAUTH_CONFIG',
                'OAuth configuration not found for server',
                { serverId }
            );
        }

        // Verificar si hay client credentials y si están expiradas
        const clientCredentials = config.clientCredentials;
        if (clientCredentials?.registrationMetadata?.client_secret_expires_at) {
            const expiresAt =
                clientCredentials.registrationMetadata.client_secret_expires_at;

            // 0 = nunca expira, cualquier otro valor es timestamp en segundos
            if (expiresAt !== 0 && Date.now() >= expiresAt * 1000) {
                logger.oauth.warn('Client credentials expired during token refresh', {
                    serverId,
                    expiresAt,
                });

                // Notificar - el refresh fallará pero queremos informar
                // La re-autorización será necesaria
            }
        }

        return config as unknown as OAuthServerConfig;
    }

    /**
     * Create typed error
     *
     * @private
     */
    private createError(
        code: OAuthHttpClientError['code'],
        message: string,
        details?: Record<string, unknown>
    ): OAuthHttpClientError {
        const error = new Error(message) as OAuthHttpClientError;
        error.code = code;
        error.details = details;
        return error;
    }
}
