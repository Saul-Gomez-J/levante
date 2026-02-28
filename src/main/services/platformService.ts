/**
 * PlatformService - Manages Levante Platform authentication and models
 *
 * Centralizes all platform-specific logic:
 * - OAuth login/logout via existing OAuthService
 * - JWT decoding for user info and allowedModels
 * - Model fetching with metadata from /api/v1/models
 */

import { jwtDecode } from 'jwt-decode';
import { getOAuthService } from './oauth';
import { userProfileService } from './userProfileService';
import { safeFetch } from '../utils/urlValidator';
import { getLogger } from './logging';
import type { PlatformUser, PlatformStatus } from '../../types/userProfile';

const logger = getLogger();

const LEVANTE_PLATFORM_SERVER_ID = 'levante-platform';
const LEVANTE_PLATFORM_DEFAULT_URL = process.env.LEVANTE_PLATFORM_URL || 'http://localhost:3000';

interface JWTPayload {
  sub?: string;
  email?: string;
  allowed_models?: string[];
  org_id?: string;
  team_id?: string;
  exp?: number;
  iat?: number;
}

interface ModelMetadata {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  [key: string]: any;
}

class PlatformService {
  private cachedAllowedModels: string[] = [];
  private cachedUser: PlatformUser | null = null;

  /**
   * Login to Levante Platform via OAuth
   * Reuses existing OAuthService infrastructure
   */
  async login(baseUrl?: string): Promise<PlatformStatus> {
    const effectiveBaseUrl = baseUrl || LEVANTE_PLATFORM_DEFAULT_URL;

    logger.oauth.info('Starting Levante Platform login', { baseUrl: effectiveBaseUrl });

    const oauthService = getOAuthService();
    const result = await oauthService.authorize({
      serverId: LEVANTE_PLATFORM_SERVER_ID,
      mcpServerUrl: effectiveBaseUrl,
      scopes: ['openid', 'email'],
    });

    if (!result.success) {
      throw new Error(result.error || 'OAuth authorization failed');
    }

    // Decode JWT to extract user info and allowedModels
    const status = await this.decodeTokenAndUpdateProfile();

    logger.oauth.info('Levante Platform login successful', {
      email: status.user?.email,
      modelsCount: status.allowedModels.length,
    });

    return status;
  }

  /**
   * Logout from Levante Platform
   * Revokes tokens and clears platform state
   */
  async logout(): Promise<void> {
    logger.oauth.info('Logging out from Levante Platform');

    const oauthService = getOAuthService();
    await oauthService.disconnect({
      serverId: LEVANTE_PLATFORM_SERVER_ID,
      revokeTokens: true,
    });

    // Clear platform state
    this.cachedAllowedModels = [];
    this.cachedUser = null;

    await userProfileService.updateProfile({
      appMode: 'standalone',
    });

    logger.oauth.info('Levante Platform logout complete');
  }

  /**
   * Get current platform status
   * Checks token validity and returns user + allowedModels
   */
  async getStatus(): Promise<PlatformStatus> {
    try {
      const oauthService = getOAuthService();
      const tokens = await oauthService.getExistingToken(LEVANTE_PLATFORM_SERVER_ID);

      if (!tokens) {
        return { isAuthenticated: false, user: null, allowedModels: [] };
      }

      // Decode the JWT to get fresh data
      return await this.decodeTokenAndUpdateProfile();
    } catch (error) {
      logger.oauth.debug('Platform status check failed', {
        error: error instanceof Error ? error.message : error,
      });
      return { isAuthenticated: false, user: null, allowedModels: [] };
    }
  }

  /**
   * Get access token for API calls (handles auto-refresh via ensureValidToken)
   */
  async getAccessToken(): Promise<string | null> {
    try {
      const oauthService = getOAuthService();
      const tokens = await oauthService.ensureValidToken(LEVANTE_PLATFORM_SERVER_ID);
      return tokens.accessToken;
    } catch {
      return null;
    }
  }

  /**
   * Get auth headers for API calls (handles auto-refresh + 401 retry)
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const oauthService = getOAuthService();
    return oauthService.getAuthHeaders(LEVANTE_PLATFORM_SERVER_ID);
  }

  /**
   * Check if currently authenticated with Levante Platform
   */
  async isAuthenticated(): Promise<boolean> {
    const oauthService = getOAuthService();
    const tokens = await oauthService.getExistingToken(LEVANTE_PLATFORM_SERVER_ID);
    return !!tokens;
  }

  /**
   * Get allowed model IDs from the JWT
   */
  getAllowedModels(): string[] {
    return this.cachedAllowedModels;
  }

  /**
   * Get current platform user
   */
  getUser(): PlatformUser | null {
    return this.cachedUser;
  }

  /**
   * Fetch models with full metadata from /api/v1/models
   * Filters by allowedModels from JWT
   */
  async fetchModelsWithMetadata(baseUrl?: string): Promise<ModelMetadata[]> {
    const effectiveBaseUrl = baseUrl || LEVANTE_PLATFORM_DEFAULT_URL;
    const url = `${effectiveBaseUrl}/api/v1/models`;

    let authHeaders: Record<string, string>;
    try {
      authHeaders = await this.getAuthHeaders();
    } catch {
      logger.models.warn('No valid access token for Levante Platform model fetch');
      return [];
    }

    // Re-decode to get latest allowedModels
    const accessToken = await this.getAccessToken();
    const allowedModels = accessToken
      ? (this.decodeJWT(accessToken).allowed_models || [])
      : [];
    this.cachedAllowedModels = allowedModels;

    try {
      let response = await safeFetch(url, {
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
      });

      // Handle 401: attempt token refresh and retry once
      if (response.status === 401) {
        logger.oauth.info('Got 401 from platform API, attempting token refresh');
        const oauthService = getOAuthService();
        const retried = await oauthService.handleUnauthorized(LEVANTE_PLATFORM_SERVER_ID, response);

        if (retried) {
          const freshHeaders = await this.getAuthHeaders();
          response = await safeFetch(url, {
            headers: {
              ...freshHeaders,
              'Content-Type': 'application/json',
            },
          });
        }
      }

      if (!response.ok) {
        throw new Error(`Levante Platform API error: ${response.statusText}`);
      }

      const data = await response.json();
      const allModels: ModelMetadata[] = data.data || [];

      // Filter by allowedModels if present in JWT
      if (allowedModels.length > 0) {
        const allowedSet = new Set(allowedModels);
        return allModels.filter((model) => allowedSet.has(model.id));
      }

      // If no allowedModels in JWT, return all from API (already filtered by user's plan)
      return allModels;
    } catch (error) {
      logger.models.error('Failed to fetch Levante Platform models', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Decode JWT and update user profile with platform info
   */
  private async decodeTokenAndUpdateProfile(): Promise<PlatformStatus> {
    const accessToken = await this.getAccessToken();

    if (!accessToken) {
      return { isAuthenticated: false, user: null, allowedModels: [] };
    }

    const decoded = this.decodeJWT(accessToken);

    const user: PlatformUser = {
      email: decoded.email,
      sub: decoded.sub,
      orgId: decoded.org_id,
      teamId: decoded.team_id,
    };

    const allowedModels = decoded.allowed_models || [];

    // Cache locally
    this.cachedUser = user;
    this.cachedAllowedModels = allowedModels;

    // Persist to user profile
    await userProfileService.updateProfile({
      appMode: 'platform',
      platformUser: user,
    });

    return {
      isAuthenticated: true,
      user,
      allowedModels,
    };
  }

  /**
   * Decode JWT without verification (backend handles verification)
   */
  private decodeJWT(token: string): JWTPayload {
    try {
      return jwtDecode<JWTPayload>(token);
    } catch (error) {
      logger.oauth.error('Failed to decode JWT', {
        error: error instanceof Error ? error.message : error,
      });
      return {};
    }
  }
}

// Singleton
export const platformService = new PlatformService();
