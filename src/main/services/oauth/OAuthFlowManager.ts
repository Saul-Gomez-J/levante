import * as crypto from 'crypto';
import { shell } from 'electron';
import { getLogger } from '../logging';
import { OAuthRedirectServer } from './OAuthRedirectServer';
import { OAuthStateManager } from './OAuthStateManager';
import type {
    PKCEParams,
    AuthorizationUrlParams,
    TokenExchangeParams,
    TokenRefreshParams,
    OAuthTokens,
    TokenRevocationParams,
    TokenEndpointAuthMethod,
} from './types';
import { OAuthFlowError } from './types';

/**
 * Aplica autenticación de cliente a un request según el método especificado
 * RFC 6749 Section 2.3.1
 *
 * @param headers - Headers del request (se modifican in-place)
 * @param body - URLSearchParams del body (se modifican in-place)
 * @param clientId - Client ID
 * @param clientSecret - Client secret (opcional para public clients)
 * @param authMethod - Método de autenticación
 */
function applyClientAuthentication(
    headers: Record<string, string>,
    body: URLSearchParams,
    clientId: string,
    clientSecret: string | undefined,
    authMethod: TokenEndpointAuthMethod = 'none'
): void {
    switch (authMethod) {
        case 'client_secret_basic':
            // RFC 6749 Section 2.3.1: HTTP Basic Authentication
            // client_id y client_secret deben ser URL-encoded antes de Base64
            if (!clientSecret) {
                throw new OAuthFlowError(
                    'client_secret_basic requires a client secret',
                    'TOKEN_EXCHANGE_FAILED',
                    { authMethod }
                );
            }
            const credentials = Buffer.from(
                `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`
            ).toString('base64');
            headers['Authorization'] = `Basic ${credentials}`;
            // NO incluir client_id/client_secret en el body
            break;

        case 'client_secret_post':
            // RFC 6749 Section 2.3.1: Client credentials in request body
            body.set('client_id', clientId);
            if (clientSecret) {
                body.set('client_secret', clientSecret);
            }
            break;

        case 'none':
        default:
            // Public client: solo client_id en el body
            body.set('client_id', clientId);
            break;
    }
}

/**
 * OAuthFlowManager
 *
 * Gestiona el flujo completo de OAuth 2.1 con PKCE
 * - Generación de PKCE (S256)
 * - Creación de Authorization URLs
 * - Intercambio de code por tokens
 * - Refresh de tokens
 */
export class OAuthFlowManager {
    private logger = getLogger();
    private redirectServer: OAuthRedirectServer;
    private stateManager: OAuthStateManager;

    constructor() {
        this.redirectServer = new OAuthRedirectServer();
        this.stateManager = new OAuthStateManager();
    }

    /**
     * Genera parámetros PKCE (S256)
     * RFC 7636 - Proof Key for Code Exchange
     */
    generatePKCE(): PKCEParams {
        try {
            // Generar code_verifier (43-128 caracteres)
            // 32 bytes = 43 caracteres en base64url
            const verifier = crypto.randomBytes(32).toString('base64url');

            // Generar code_challenge = BASE64URL(SHA256(verifier))
            const challenge = crypto
                .createHash('sha256')
                .update(verifier)
                .digest('base64url');

            this.logger.oauth.debug('PKCE generated', {
                verifierLength: verifier.length,
                challengeLength: challenge.length,
            });

            return {
                verifier,
                challenge,
                method: 'S256',
            };
        } catch (error) {
            this.logger.oauth.error('Failed to generate PKCE', {
                error: error instanceof Error ? error.message : error,
            });
            throw new OAuthFlowError(
                'Failed to generate PKCE parameters',
                'PKCE_GENERATION_FAILED',
                { error }
            );
        }
    }

    /**
     * Crea Authorization URL para iniciar OAuth flow
     */
    createAuthorizationUrl(params: AuthorizationUrlParams): string {
        try {
            const url = new URL(params.authorizationEndpoint);

            // Parámetros OAuth 2.1
            url.searchParams.set('response_type', 'code');
            url.searchParams.set('client_id', params.clientId);
            url.searchParams.set('redirect_uri', params.redirectUri);
            url.searchParams.set('scope', params.scopes.join(' '));
            url.searchParams.set('state', params.state);
            url.searchParams.set('code_challenge', params.codeChallenge);
            url.searchParams.set('code_challenge_method', params.codeChallengeMethod);

            // RFC 8707: Resource Indicators (opcional)
            if (params.resource) {
                url.searchParams.set('resource', params.resource);
            }

            this.logger.oauth.debug('Authorization URL created', {
                endpoint: params.authorizationEndpoint,
                clientId: params.clientId,
                scopes: params.scopes,
            });

            return url.toString();
        } catch (error) {
            this.logger.oauth.error('Failed to create authorization URL', {
                error: error instanceof Error ? error.message : error,
            });
            throw new OAuthFlowError(
                'Failed to create authorization URL',
                'INVALID_RESPONSE',
                { error }
            );
        }
    }

    /**
     * Ejecuta el flujo completo de autorización
     * 1. Genera PKCE
     * 2. Inicia loopback server (o usa uno existente)
     * 3. Abre browser
     * 4. Espera callback
     * 5. Valida state
     * 6. Retorna code y verifier para exchange
     */
    async authorize(params: {
        serverId: string;
        authorizationEndpoint: string;
        clientId: string;
        scopes: string[];
        resource?: string;
        existingRedirectUri?: string; // If provided, skips server start
    }): Promise<{ code: string; verifier: string; redirectUri: string }> {
        try {
            this.logger.oauth.info('Starting OAuth authorization flow', {
                serverId: params.serverId,
                authorizationEndpoint: params.authorizationEndpoint,
                usingExistingServer: !!params.existingRedirectUri,
            });

            // 1. Generar PKCE
            const pkce = this.generatePKCE();

            // 2. Generar state
            const state = this.stateManager.generateState();

            // 3. Iniciar loopback server (o usar existente)
            let redirectUri: string;
            if (params.existingRedirectUri) {
                redirectUri = params.existingRedirectUri;
                this.logger.oauth.debug('Using existing redirect server', {
                    redirectUri,
                });
            } else {
                const result = await this.redirectServer.start();
                redirectUri = result.redirectUri;
            }

            // 4. Almacenar state
            this.stateManager.storeState(
                state,
                params.serverId,
                pkce.verifier,
                redirectUri
            );

            // 5. Crear authorization URL
            const authUrl = this.createAuthorizationUrl({
                authorizationEndpoint: params.authorizationEndpoint,
                clientId: params.clientId,
                redirectUri,
                scopes: params.scopes,
                state,
                codeChallenge: pkce.challenge,
                codeChallengeMethod: 'S256',
                resource: params.resource,
            });

            this.logger.oauth.info('Opening browser for authorization', {
                serverId: params.serverId,
            });

            // 6. Abrir browser
            await shell.openExternal(authUrl);

            // 7. Esperar callback
            const callback = await this.redirectServer.waitForCallback();

            // 8. Detener server (solo si lo iniciamos nosotros)
            if (!params.existingRedirectUri) {
                await this.redirectServer.stop();
            }

            // 9. Validar state
            const storedState = this.stateManager.validateAndRetrieveState(
                callback.state
            );

            this.logger.oauth.info('Authorization successful', {
                serverId: storedState.serverId,
            });

            return {
                code: callback.code,
                verifier: storedState.codeVerifier,
                redirectUri: storedState.redirectUri,
            };
        } catch (error) {
            // Cleanup
            await this.redirectServer.stop();

            this.logger.oauth.error('Authorization flow failed', {
                serverId: params.serverId,
                error: error instanceof Error ? error.message : error,
            });

            throw error;
        }
    }

    /**
     * Intercambia authorization code por tokens
     */
    async exchangeCodeForTokens(
        params: TokenExchangeParams
    ): Promise<OAuthTokens> {
        try {
            this.logger.oauth.info('Exchanging code for tokens', {
                tokenEndpoint: params.tokenEndpoint,
            });

            // Construir body base (sin credenciales de cliente)
            const body = new URLSearchParams({
                grant_type: 'authorization_code',
                code: params.code,
                redirect_uri: params.redirectUri,
                code_verifier: params.codeVerifier,
            });

            // Preparar headers
            const headers: Record<string, string> = {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            };

            // Aplicar autenticación de cliente según método configurado
            applyClientAuthentication(
                headers,
                body,
                params.clientId,
                params.clientSecret,
                params.tokenEndpointAuthMethod ?? (params.clientSecret ? 'client_secret_post' : 'none')
            );

            this.logger.oauth.debug('Token exchange request prepared', {
                authMethod: params.tokenEndpointAuthMethod ?? 'auto',
                hasBasicAuth: !!headers['Authorization'],
            });

            // Hacer request
            const response = await fetch(params.tokenEndpoint, {
                method: 'POST',
                headers,
                body: body.toString(),
            });

            // Parse response
            const data = await response.json();

            if (!response.ok) {
                this.logger.oauth.error('Token exchange failed', {
                    status: response.status,
                    error: data.error,
                    errorDescription: data.error_description,
                });

                throw new OAuthFlowError(
                    `Token exchange failed: ${data.error_description || data.error}`,
                    'TOKEN_EXCHANGE_FAILED',
                    {
                        status: response.status,
                        error: data.error,
                        errorDescription: data.error_description,
                    }
                );
            }

            // Validar respuesta
            if (!data.access_token) {
                throw new OAuthFlowError(
                    'Token response missing access_token',
                    'INVALID_RESPONSE',
                    { response: data }
                );
            }

            // Calcular expiración
            const expiresIn = data.expires_in || 3600; // Default 1 hora
            const expiresAt = Date.now() + expiresIn * 1000;

            this.logger.oauth.info('Tokens received successfully', {
                hasRefreshToken: !!data.refresh_token,
                expiresIn,
                tokenType: data.token_type,
            });

            return {
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                expiresAt,
                tokenType: data.token_type || 'Bearer',
                scope: data.scope,
            };
        } catch (error) {
            if (error instanceof OAuthFlowError) {
                throw error;
            }

            this.logger.oauth.error('Token exchange error', {
                error: error instanceof Error ? error.message : error,
            });

            throw new OAuthFlowError(
                'Failed to exchange code for tokens',
                'TOKEN_EXCHANGE_FAILED',
                { error }
            );
        }
    }

    /**
     * Refresca access token usando refresh token
     */
    async refreshAccessToken(params: TokenRefreshParams): Promise<OAuthTokens> {
        try {
            this.logger.oauth.info('Refreshing access token', {
                tokenEndpoint: params.tokenEndpoint,
            });

            // Construir body base (sin credenciales de cliente)
            const body = new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: params.refreshToken,
            });

            // Scopes (opcional)
            if (params.scopes && params.scopes.length > 0) {
                body.set('scope', params.scopes.join(' '));
            }

            // Preparar headers
            const headers: Record<string, string> = {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            };

            // Aplicar autenticación de cliente según método configurado
            applyClientAuthentication(
                headers,
                body,
                params.clientId,
                params.clientSecret,
                params.tokenEndpointAuthMethod ?? (params.clientSecret ? 'client_secret_post' : 'none')
            );

            this.logger.oauth.debug('Token refresh request prepared', {
                authMethod: params.tokenEndpointAuthMethod ?? 'auto',
                hasBasicAuth: !!headers['Authorization'],
            });

            // Hacer request
            const response = await fetch(params.tokenEndpoint, {
                method: 'POST',
                headers,
                body: body.toString(),
            });

            // Parse response
            const data = await response.json();

            if (!response.ok) {
                this.logger.oauth.error('Token refresh failed', {
                    status: response.status,
                    error: data.error,
                    errorDescription: data.error_description,
                });

                throw new OAuthFlowError(
                    `Token refresh failed: ${data.error_description || data.error}`,
                    'TOKEN_REFRESH_FAILED',
                    {
                        status: response.status,
                        error: data.error,
                        errorDescription: data.error_description,
                    }
                );
            }

            // Validar respuesta
            if (!data.access_token) {
                throw new OAuthFlowError(
                    'Token response missing access_token',
                    'INVALID_RESPONSE',
                    { response: data }
                );
            }

            // Calcular expiración
            const expiresIn = data.expires_in || 3600;
            const expiresAt = Date.now() + expiresIn * 1000;

            this.logger.oauth.info('Token refreshed successfully', {
                hasNewRefreshToken: !!data.refresh_token,
                expiresIn,
            });

            return {
                accessToken: data.access_token,
                refreshToken: data.refresh_token || params.refreshToken, // Usar el anterior si no hay nuevo
                expiresAt,
                tokenType: data.token_type || 'Bearer',
                scope: data.scope,
            };
        } catch (error) {
            if (error instanceof OAuthFlowError) {
                throw error;
            }

            this.logger.oauth.error('Token refresh error', {
                error: error instanceof Error ? error.message : error,
            });

            throw new OAuthFlowError(
                'Failed to refresh access token',
                'TOKEN_REFRESH_FAILED',
                { error }
            );
        }
    }

    /**
     * Cleanup: limpia states expirados
     */
    cleanup(): void {
        this.stateManager.cleanExpiredStates();
    }

    /**
     * Revoca un token (access o refresh) según RFC 7009
     *
     * @param params - Parámetros de revocación
     */
    async revokeToken(params: TokenRevocationParams): Promise<void> {
        try {
            this.logger.oauth.info('Revoking token', {
                revocationEndpoint: params.revocationEndpoint,
                tokenTypeHint: params.tokenTypeHint,
            });

            // Construir body base según RFC 7009 (sin credenciales de cliente)
            const body = new URLSearchParams({
                token: params.token,
            });

            // Token type hint (opcional pero recomendado)
            if (params.tokenTypeHint) {
                body.set('token_type_hint', params.tokenTypeHint);
            }

            // Preparar headers
            const headers: Record<string, string> = {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            };

            // Aplicar autenticación de cliente según método configurado
            applyClientAuthentication(
                headers,
                body,
                params.clientId,
                params.clientSecret,
                params.tokenEndpointAuthMethod ?? (params.clientSecret ? 'client_secret_post' : 'none')
            );

            this.logger.oauth.debug('Token revocation request prepared', {
                tokenTypeHint: params.tokenTypeHint,
                authMethod: params.tokenEndpointAuthMethod ?? 'auto',
                hasBasicAuth: !!headers['Authorization'],
            });

            // Hacer request
            const response = await fetch(params.revocationEndpoint, {
                method: 'POST',
                headers,
                body: body.toString(),
            });

            // RFC 7009: El servidor DEBE responder con 200 OK
            // incluso si el token era inválido o ya estaba revocado
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                this.logger.oauth.error('Token revocation failed', {
                    status: response.status,
                    error: data.error,
                    errorDescription: data.error_description,
                });

                throw new OAuthFlowError(
                    `Token revocation failed: ${data.error_description || data.error || response.statusText}`,
                    'TOKEN_REVOCATION_FAILED',
                    {
                        status: response.status,
                        error: data.error,
                        errorDescription: data.error_description,
                    }
                );
            }

            this.logger.oauth.info('Token revoked successfully');
        } catch (error) {
            if (error instanceof OAuthFlowError) {
                throw error;
            }

            this.logger.oauth.error('Token revocation error', {
                error: error instanceof Error ? error.message : error,
            });

            throw new OAuthFlowError(
                'Failed to revoke token',
                'TOKEN_REVOCATION_FAILED',
                { error }
            );
        }
    }
}
