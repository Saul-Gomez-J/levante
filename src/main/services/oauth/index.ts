/**
 * OAuth Services
 *
 * Fase 1: Token Store Seguro
 * Fase 2: OAuth Flow con PKCE
 * Fase 3: Discovery Automático
 * Fase 4: HTTP Client & Service
 */

// Fase 1
export { OAuthTokenStore } from './OAuthTokenStore';

// Fase 2
export { OAuthFlowManager } from './OAuthFlowManager';
export { OAuthRedirectServer } from './OAuthRedirectServer';
export { OAuthStateManager } from './OAuthStateManager';

// Fase 3
export { OAuthDiscoveryService } from './OAuthDiscoveryService';

// Fase 4
export { OAuthHttpClient } from './OAuthHttpClient';
export { OAuthService } from './OAuthService';

// Types
export * from './types';

// Constantes OAuth
export {
    OAUTH_LOOPBACK_PORT,
    OAUTH_LOOPBACK_HOST,
    OAUTH_CALLBACK_PATH,
    OAUTH_REDIRECT_URI,
    OAUTH_CALLBACK_TIMEOUT,
} from './constants';

import { OAuthService } from './OAuthService';
import { preferencesService } from '../preferencesService';

let oauthServiceInstance: OAuthService | null = null;

/**
 * Get the singleton instance of OAuthService
 */
export function getOAuthService(): OAuthService {
    if (!oauthServiceInstance) {
        oauthServiceInstance = new OAuthService(preferencesService);
    }
    return oauthServiceInstance;
}
