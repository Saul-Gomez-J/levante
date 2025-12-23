import type { UIPreferences } from '../../../types/preferences';

/**
 * OAuth Token Types
 *
 * Tipos para almacenamiento seguro de tokens OAuth 2.1
 * Compatible con Authorization Code Flow + PKCE
 */

/**
 * OAuth tokens obtenidos del Authorization Server
 */
export interface OAuthTokens {
    /** Access token (JWT o opaque) */
    accessToken: string;

    /** Refresh token para renovar access token */
    refreshToken?: string;

    /** Timestamp de expiración del access token (milliseconds desde epoch) */
    expiresAt: number;

    /** Tipo de token (siempre "Bearer" para OAuth 2.1) */
    tokenType: 'Bearer';

    /** Scopes concedidos (puede diferir de los solicitados) */
    scope?: string;
}

/**
 * OAuth tokens almacenados (con encriptación)
 */
export interface StoredOAuthTokens {
    /** Access token encriptado */
    accessToken: string;

    /** Refresh token encriptado (opcional) */
    refreshToken?: string;

    /** Timestamp de expiración (no encriptado para validación rápida) */
    expiresAt: number;

    /** Tipo de token */
    tokenType: 'Bearer';

    /** Scopes concedidos */
    scope?: string;

    /** Timestamp de cuando se emitió el token */
    issuedAt: number;
}

/**
 * Configuración OAuth para un servidor MCP
 */
export interface OAuthConfig {
    /** OAuth habilitado para este servidor */
    enabled: boolean;

    /** URL del Authorization Server */
    authServerId?: string;

    /** Client ID registrado */
    clientId?: string;

    /** Client Secret (solo para confidential clients) */
    clientSecret?: string;

    /** Scopes a solicitar */
    scopes?: string[];

    /** Redirect URI configurado */
    redirectUri?: string;
}

/**
 * Extensión de MCPServerConfig para incluir OAuth
 */
export interface MCPServerConfigWithOAuth {
    id: string;
    transport: 'http' | 'sse' | 'streamable-http' | 'stdio';
    baseUrl?: string;
    command?: string;
    args?: string[];
    headers?: Record<string, string>;

    /** Configuración OAuth (opcional) */
    oauth?: OAuthConfig & {
        /** NUEVO Fase 5: Credenciales de cliente registradas dinámicamente */
        clientCredentials?: OAuthClientCredentials;
    };
}

/**
 * Estructura de preferencias extendida con OAuth
 */
export interface UIPreferencesWithOAuth extends UIPreferences {
    /** Configuración de servidores MCP con OAuth */
    mcpServers?: {
        [serverId: string]: MCPServerConfigWithOAuth;
    };

    /** Tokens OAuth almacenados (encriptados) */
    oauthTokens?: {
        [serverId: string]: StoredOAuthTokens;
    };
}

/**
 * Errores relacionados con OAuth Token Store
 */
export class OAuthTokenStoreError extends Error {
    constructor(
        message: string,
        public readonly code: 'ENCRYPTION_FAILED' | 'DECRYPTION_FAILED' | 'NOT_FOUND' | 'INVALID_FORMAT',
        public readonly serverId?: string
    ) {
        super(message);
        this.name = 'OAuthTokenStoreError';
    }
}
/**
 * OAuth Flow Types - Fase 2
 */

/**
 * Parámetros PKCE (Proof Key for Code Exchange)
 */
export interface PKCEParams {
    /** Code verifier (43-128 caracteres, base64url) */
    verifier: string;

    /** Code challenge (SHA-256 del verifier, base64url) */
    challenge: string;

    /** Método usado: siempre 'S256' para OAuth 2.1 */
    method: 'S256';
}

/**
 * Parámetros para crear Authorization URL
 */
export interface AuthorizationUrlParams {
    /** Endpoint de autorización del AS */
    authorizationEndpoint: string;

    /** Client ID registrado */
    clientId: string;

    /** Redirect URI (loopback) */
    redirectUri: string;

    /** Scopes a solicitar */
    scopes: string[];

    /** State parameter (anti-CSRF) */
    state: string;

    /** PKCE code challenge */
    codeChallenge: string;

    /** PKCE code challenge method */
    codeChallengeMethod: 'S256';

    /** Resource indicator (RFC 8707) - opcional */
    resource?: string;
}

/**
 * Parámetros para token exchange
 */
export interface TokenExchangeParams {
    /** Token endpoint del AS */
    tokenEndpoint: string;

    /** Authorization code recibido */
    code: string;

    /** Redirect URI usado en authorization */
    redirectUri: string;

    /** Client ID */
    clientId: string;

    /** PKCE code verifier */
    codeVerifier: string;

    /** Client secret (solo confidential clients) */
    clientSecret?: string;
}

/**
 * Parámetros para refresh token
 */
export interface TokenRefreshParams {
    /** Token endpoint del AS */
    tokenEndpoint: string;

    /** Refresh token */
    refreshToken: string;

    /** Client ID */
    clientId: string;

    /** Client secret (solo confidential clients) */
    clientSecret?: string;

    /** Scopes a solicitar (opcional) */
    scopes?: string[];
}

/**
 * Callback recibido del authorization server
 */
export interface AuthorizationCallback {
    /** Authorization code */
    code: string;

    /** State parameter (debe coincidir) */
    state: string;

    /** Error code si authorization falló */
    error?: string;

    /** Error description */
    errorDescription?: string;
}

/**
 * Configuración del loopback server
 */
export interface LoopbackServerConfig {
    /** Puerto a usar (0 = aleatorio) */
    port?: number;

    /** Hostname (siempre 127.0.0.1) */
    hostname?: string;

    /** Path del callback (siempre /callback) */
    callbackPath?: string;

    /** Timeout en ms (default: 5 minutos) */
    timeout?: number;
}

/**
 * Resultado del loopback server
 */
export interface LoopbackServerResult {
    /** Puerto asignado */
    port: number;

    /** URL completa del redirect */
    redirectUri: string;
}

/**
 * State almacenado temporalmente
 */
export interface StoredState {
    /** Server ID asociado */
    serverId: string;

    /** PKCE verifier asociado */
    codeVerifier: string;

    /** Timestamp de expiración */
    expiresAt: number;

    /** Redirect URI usado */
    redirectUri: string;
}

/**
 * Errores relacionados con OAuth Flow
 */
export class OAuthFlowError extends Error {
    constructor(
        message: string,
        public readonly code:
            | 'PKCE_GENERATION_FAILED'
            | 'INVALID_STATE'
            | 'STATE_EXPIRED'
            | 'AUTHORIZATION_DENIED'
            | 'TOKEN_EXCHANGE_FAILED'
            | 'TOKEN_REFRESH_FAILED'
            | 'TOKEN_REVOCATION_FAILED'
            | 'LOOPBACK_SERVER_FAILED'
            | 'CALLBACK_TIMEOUT'
            | 'INVALID_RESPONSE',
        public readonly details?: any
    ) {
        super(message);
        this.name = 'OAuthFlowError';
    }
}
/**
 * OAuth Discovery Types - Fase 3
 */

/**
 * Protected Resource Metadata (RFC 9728)
 */
export interface ProtectedResourceMetadata {
    /** Resource server URL */
    resource: string;

    /** Array of authorization server URLs */
    authorization_servers: string[];

    /** Bearer token usage (opcional) */
    bearer_methods_supported?: string[];

    /** Resource documentation (opcional) */
    resource_documentation?: string;
}

/**
 * Authorization Server Metadata (RFC 8414)
 */
export interface AuthorizationServerMetadata {
    /** Issuer identifier */
    issuer: string;

    /** Authorization endpoint URL */
    authorization_endpoint: string;

    /** Token endpoint URL */
    token_endpoint: string;

    /** JWKS URI (opcional) */
    jwks_uri?: string;

    /** Registration endpoint (opcional) */
    registration_endpoint?: string;

    /** Scopes supported (opcional) */
    scopes_supported?: string[];

    /** Response types supported */
    response_types_supported: string[];

    /** Response modes supported (opcional) */
    response_modes_supported?: string[];

    /** Grant types supported (opcional) */
    grant_types_supported?: string[];

    /** Token endpoint auth methods (opcional) */
    token_endpoint_auth_methods_supported?: string[];

    /** Token endpoint auth signing algs (opcional) */
    token_endpoint_auth_signing_alg_values_supported?: string[];

    /** Service documentation (opcional) */
    service_documentation?: string;

    /** UI locales supported (opcional) */
    ui_locales_supported?: string[];

    /** OP policy URI (opcional) */
    op_policy_uri?: string;

    /** OP ToS URI (opcional) */
    op_tos_uri?: string;

    /** Revocation endpoint (opcional) */
    revocation_endpoint?: string;

    /** Revocation endpoint auth methods (opcional) */
    revocation_endpoint_auth_methods_supported?: string[];

    /** Introspection endpoint (opcional) */
    introspection_endpoint?: string;

    /** Code challenge methods supported */
    code_challenge_methods_supported: string[];

    /** DPOP signing algs supported (opcional) */
    dpop_signing_alg_values_supported?: string[];
}

/**
 * WWW-Authenticate header parsed data
 */
export interface WWWAuthenticateParams {
    /** Authentication scheme (e.g., "Bearer") */
    scheme?: string;

    /** Realm parameter */
    realm?: string;

    /** Authorization server URI */
    as_uri?: string;

    /** Resource metadata URL */
    resource_metadata?: string;

    /** Error code */
    error?: string;

    /** Error description */
    error_description?: string;

    /** Scope required */
    scope?: string;
}

/**
 * Metadata cache entry
 */
export interface CachedMetadata<T> {
    /** Cached data */
    data: T;

    /** Cache timestamp */
    cachedAt: number;

    /** Expiration timestamp */
    expiresAt: number;
}

/**
 * Discovery result
 */
export interface DiscoveryResult {
    /** Authorization server URL */
    authorizationServer: string;

    /** Authorization server metadata */
    metadata: AuthorizationServerMetadata;

    /** Was retrieved from cache */
    fromCache: boolean;
}

/**
 * Errores relacionados con OAuth Discovery
 */
export class OAuthDiscoveryError extends Error {
    constructor(
        message: string,
        public readonly code:
            | 'METADATA_FETCH_FAILED'
            | 'METADATA_NOT_SUPPORTED'
            | 'INVALID_METADATA'
            | 'PKCE_NOT_SUPPORTED'
            | 'NETWORK_ERROR'
            | 'VALIDATION_FAILED'
            | 'PARSE_ERROR',
        public readonly details?: any
    ) {
        super(message);
        this.name = 'OAuthDiscoveryError';
    }
}
/**
 * OAuth HttpClient and Service Types - Fase 4
 */

/**
 * OAuthHttpClient error
 */
export interface OAuthHttpClientError extends Error {
    code:
    | 'NO_TOKENS'
    | 'NO_REFRESH_TOKEN'
    | 'REFRESH_FAILED'
    | 'NO_OAUTH_CONFIG'
    | 'NETWORK_ERROR'
    | 'UNAUTHORIZED';
    details?: Record<string, unknown>;
}

/**
 * OAuthService error
 */
export interface OAuthServiceError extends Error {
    code:
    | 'DISCOVERY_FAILED'
    | 'AUTHORIZATION_FAILED'
    | 'TOKEN_EXCHANGE_FAILED'
    | 'NO_CLIENT_ID'
    | 'SAVE_FAILED'
    | 'AUTH_SERVER_NOT_FOUND'
    | 'MISSING_CLIENT_ID';
    details?: Record<string, unknown>;
}

/**
 * OAuth configuration stored in preferences
 */
export interface OAuthServerConfig {
    enabled: boolean;
    authServerId: string;
    clientId: string;
    clientSecret?: string;
    scopes: string[];
    redirectUri?: string;
}

/**
 * RFC 7591: Dynamic Client Registration Request - Fase 5
 */
export interface OAuthClientRegistrationRequest {
    /** Human-readable name of the client */
    client_name: string;

    /** Array of redirect URIs */
    redirect_uris: string[];

    /** Grant types the client can use */
    grant_types?: string[];

    /** Response types the client can use */
    response_types?: string[];

    /** Token endpoint authentication method */
    token_endpoint_auth_method?: 'none' | 'client_secret_post' | 'client_secret_basic';

    /** Requested scopes */
    scope?: string;

    /** URL of the client application */
    client_uri?: string;

    /** Logo URI */
    logo_uri?: string;
}

/**
 * RFC 7591: Dynamic Client Registration Response
 */
export interface OAuthClientRegistrationResponse {
    /** Unique client identifier */
    client_id: string;

    /** Client secret (only for confidential clients) */
    client_secret?: string;

    /** Timestamp when client_secret expires (0 = never) */
    client_secret_expires_at?: number;

    /** Registration access token */
    registration_access_token?: string;

    /** Registration client URI for updates */
    registration_client_uri?: string;

    /** Timestamp when the client was registered */
    client_id_issued_at?: number;

    /** Echo of request fields */
    client_name?: string;
    redirect_uris?: string[];
    grant_types?: string[];
    response_types?: string[];
    token_endpoint_auth_method?: string;
    scope?: string;
}

/**
 * Stored client credentials after registration
 */
export interface OAuthClientCredentials {
    clientId: string;
    clientSecret?: string; // Encrypted if exists
    registeredAt: number;
    authServerId: string;
    registrationMetadata?: {
        client_secret_expires_at?: number;
        registration_access_token?: string; // Encrypted
        registration_client_uri?: string;
    };
}

/**
 * Error de registro de cliente
 */
export class ClientRegistrationError extends Error {
    constructor(
        message: string,
        public code: string,
        public statusCode?: number
    ) {
        super(message);
        this.name = 'ClientRegistrationError';
    }
}

/**
 * Parámetros para revocación de token (RFC 7009)
 */
export interface TokenRevocationParams {
    /** Revocation endpoint del AS */
    revocationEndpoint: string;

    /** Token a revocar (access o refresh) */
    token: string;

    /** Hint del tipo de token */
    tokenTypeHint?: 'access_token' | 'refresh_token';

    /** Client ID */
    clientId: string;

    /** Client secret (solo confidential clients) */
    clientSecret?: string;
}

/**
 * Parámetros para desconectar un servidor (Fase 6)
 */
export interface DisconnectParams {
    /** ID del servidor a desconectar */
    serverId: string;

    /** Si se deben revocar los tokens en el AS (default: true) */
    revokeTokens?: boolean;
}
