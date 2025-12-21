/**
 * OAuth Services
 *
 * Fase 1: Token Store Seguro
 * Fase 2: OAuth Flow con PKCE
 */

// Fase 1
export { OAuthTokenStore } from './OAuthTokenStore';

// Fase 2
export { OAuthFlowManager } from './OAuthFlowManager';
export { OAuthRedirectServer } from './OAuthRedirectServer';
export { OAuthStateManager } from './OAuthStateManager';

// Types
export type {
    OAuthTokens,
    StoredOAuthTokens,
    OAuthConfig,
    MCPServerConfigWithOAuth,
    UIPreferencesWithOAuth,
    PKCEParams,
    AuthorizationUrlParams,
    TokenExchangeParams,
    TokenRefreshParams,
    AuthorizationCallback,
    LoopbackServerConfig,
    LoopbackServerResult,
    StoredState,
} from './types';

export { OAuthTokenStoreError, OAuthFlowError } from './types';
