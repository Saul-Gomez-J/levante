import { shell } from 'electron';
import { createHash, randomBytes } from 'crypto';
import { OAuthTokenStore } from '../oauth/OAuthTokenStore';
import { preferencesService } from '../preferencesService';
import {
  getProviderConfig,
  type SubscriptionOAuthProviderId,
} from './providers';

export interface AuthFlowResult {
  authUrl: string;
  codeVerifier: string;
  expectedState: string;
}

export interface OAuthStatus {
  isConnected: boolean;
  isExpired: boolean;
  expiresAt?: number;
}

export class SubscriptionOAuthService {
  private tokenStore = new OAuthTokenStore(preferencesService);
  private providerId: SubscriptionOAuthProviderId;

  constructor(providerId: SubscriptionOAuthProviderId) {
    this.providerId = providerId;
  }

  private get config() {
    return getProviderConfig(this.providerId);
  }

  private get serverId(): string {
    return this.config.tokenStoreServerId;
  }

  async startAuthorizationFlow(): Promise<AuthFlowResult> {
    const { verifier, challenge, state } = this.generatePKCEAndState();

    const url = new URL(this.config.authorizeUrl);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('scope', this.config.scopes);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);

    if (this.config.extraAuthorizeParams) {
      for (const [key, value] of Object.entries(this.config.extraAuthorizeParams)) {
        url.searchParams.set(key, value);
      }
    }

    const authUrl = url.toString();
    await shell.openExternal(authUrl);

    return {
      authUrl,
      codeVerifier: verifier,
      expectedState: state,
    };
  }

  async exchangeCode(
    input: string,
    codeVerifier: string,
    expectedState: string
  ): Promise<void> {
    const parsed = this.parseAuthorizationInput(input);

    if (parsed.state && parsed.state !== expectedState) {
      throw new Error('Invalid OAuth state. Please restart the authorization flow.');
    }

    const payload: Record<string, string> = {
      code: parsed.code,
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      code_verifier: codeVerifier,
    };

    if (this.config.sendStateInTokenExchange) {
      payload.state = parsed.state || expectedState;
    }

    const response = await fetch(this.config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => response.statusText);
      throw new Error(`Token exchange failed (${response.status}): ${error}`);
    }

    const json = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    console.log(
      `[SubscriptionOAuth][${this.providerId}] Token saved, prefix:`,
      json.access_token?.substring(0, 20)
    );

    await this.tokenStore.saveTokens(this.serverId, {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
      tokenType: 'Bearer',
      scope: this.config.scopes,
    });
  }

  async getValidAccessToken(): Promise<string> {
    const tokens = await this.tokenStore.getTokens(this.serverId);
    if (!tokens) {
      throw new Error(
        `No ${this.config.displayName} subscription tokens found. Please connect your account first.`
      );
    }

    if (!this.tokenStore.isTokenExpired(tokens)) {
      return tokens.accessToken;
    }

    if (!tokens.refreshToken) {
      throw new Error('Token expired and no refresh token available. Please reconnect.');
    }

    return this.refreshAccessToken(tokens.refreshToken);
  }

  async getStatus(): Promise<OAuthStatus> {
    const tokens = await this.tokenStore.getTokens(this.serverId);
    if (!tokens) {
      return { isConnected: false, isExpired: false };
    }

    return {
      isConnected: true,
      isExpired: this.tokenStore.isTokenExpired(tokens),
      expiresAt: tokens.expiresAt,
    };
  }

  async disconnect(): Promise<void> {
    await this.tokenStore.deleteTokens(this.serverId);
  }

  private async refreshAccessToken(refreshToken: string): Promise<string> {
    const response = await fetch(this.config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.config.clientId,
      }),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => response.statusText);
      throw new Error(`Token refresh failed (${response.status}): ${error}`);
    }

    const json = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    await this.tokenStore.saveTokens(this.serverId, {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || refreshToken,
      expiresAt: Date.now() + json.expires_in * 1000,
      tokenType: 'Bearer',
      scope: this.config.scopes,
    });

    return json.access_token;
  }

  private generatePKCEAndState(): {
    verifier: string;
    challenge: string;
    state: string;
  } {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(24).toString('base64url');
    return { verifier, challenge, state };
  }

  private parseAuthorizationInput(input: string): { code: string; state?: string } {
    const raw = input.trim();
    if (!raw) {
      throw new Error('Authorization code is empty.');
    }

    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const url = new URL(raw);
      const code = url.searchParams.get('code')?.trim();
      const state = url.searchParams.get('state')?.trim() || undefined;
      if (!code) {
        throw new Error('Could not find code parameter in URL.');
      }
      return { code, state };
    }

    const qs = raw.startsWith('?') ? raw.slice(1) : raw;
    const sp = new URLSearchParams(qs);
    if (sp.has('code')) {
      const code = sp.get('code')?.trim();
      const state = sp.get('state')?.trim() || undefined;
      if (!code) {
        throw new Error('Code parameter is empty.');
      }
      return { code, state };
    }

    if (raw.includes('#')) {
      const [codePart, statePart] = raw.split('#', 2);
      const code = codePart.trim();
      const state = statePart?.trim() || undefined;
      if (!code) {
        throw new Error('Code part is empty.');
      }
      return { code, state };
    }

    return { code: raw };
  }
}

const instances = new Map<SubscriptionOAuthProviderId, SubscriptionOAuthService>();

export function getSubscriptionOAuthService(
  providerId: SubscriptionOAuthProviderId
): SubscriptionOAuthService {
  let instance = instances.get(providerId);

  if (!instance) {
    instance = new SubscriptionOAuthService(providerId);
    instances.set(providerId, instance);
  }

  return instance;
}
