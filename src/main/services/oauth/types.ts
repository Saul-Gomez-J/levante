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
    oauth?: OAuthConfig;
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
            | 'LOOPBACK_SERVER_FAILED'
            | 'CALLBACK_TIMEOUT'
            | 'INVALID_RESPONSE',
        public readonly details?: any
    ) {
        super(message);
        this.name = 'OAuthFlowError';
    }
}
