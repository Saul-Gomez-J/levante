import { shell } from 'electron';
import { randomBytes, createHash } from 'crypto';
import { OAuthTokenStore } from '../oauth/OAuthTokenStore';
import { preferencesService } from '../preferencesService';
import { getLogger } from '../logging';

const logger = getLogger();

const ANTHROPIC_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const ANTHROPIC_REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
const ANTHROPIC_TOKEN_ENDPOINT = 'https://console.anthropic.com/v1/oauth/token';
const ANTHROPIC_OAUTH_SCOPES = 'org:create_api_key user:profile user:inference';

export const ANTHROPIC_CLAUDE_AUTH_SERVER_ID = 'anthropic-claude-subscription';

export interface AnthropicAuthFlowResult {
  authUrl: string;
  codeVerifier: string;
  expectedState: string;
}

export interface AnthropicOAuthStatus {
  isConnected: boolean;
  isExpired: boolean;
  expiresAt?: number;
}

export class AnthropicOAuthService {
  private tokenStore = new OAuthTokenStore(preferencesService);

  async startAuthorizationFlow(mode: 'max' | 'console'): Promise<AnthropicAuthFlowResult> {
    const { verifier, challenge, state } = this.generatePKCEAndState();

    const baseUrl = mode === 'max'
      ? 'https://claude.ai/oauth/authorize'
      : 'https://console.anthropic.com/oauth/authorize';

    const url = new URL(baseUrl);
    url.searchParams.set('code', 'true');
    url.searchParams.set('client_id', ANTHROPIC_CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', ANTHROPIC_REDIRECT_URI);
    url.searchParams.set('scope', ANTHROPIC_OAUTH_SCOPES);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);

    const authUrl = url.toString();
    await shell.openExternal(authUrl);

    return { authUrl, codeVerifier: verifier, expectedState: state };
  }

  async exchangeCode(input: string, codeVerifier: string, expectedState: string): Promise<void> {
    const parsed = this.parseAuthorizationInput(input);

    if (parsed.state && parsed.state !== expectedState) {
      throw new Error('Invalid OAuth state. Please restart the authorization flow.');
    }

    const payload: Record<string, string> = {
      code: parsed.code,
      grant_type: 'authorization_code',
      client_id: ANTHROPIC_CLIENT_ID,
      redirect_uri: ANTHROPIC_REDIRECT_URI,
      code_verifier: codeVerifier,
    };

    if (parsed.state) {
      payload.state = parsed.state;
    }

    const response = await fetch(ANTHROPIC_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => response.statusText);
      throw new Error(`Token exchange failed (${response.status}): ${error}`);
    }

    const json = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    await this.tokenStore.saveTokens(ANTHROPIC_CLAUDE_AUTH_SERVER_ID, {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + json.expires_in * 1000,
      tokenType: 'Bearer',
      scope: ANTHROPIC_OAUTH_SCOPES,
    });
  }

  async getValidAccessToken(): Promise<string> {
    const tokens = await this.tokenStore.getTokens(ANTHROPIC_CLAUDE_AUTH_SERVER_ID);
    if (!tokens) {
      throw new Error('No Claude subscription tokens found. Please connect your account first.');
    }

    if (!this.tokenStore.isTokenExpired(tokens)) {
      return tokens.accessToken;
    }

    if (!tokens.refreshToken) {
      throw new Error('Token expired and no refresh token available. Please reconnect.');
    }

    return this.refreshAccessToken(tokens.refreshToken);
  }

  async getStatus(): Promise<AnthropicOAuthStatus> {
    const tokens = await this.tokenStore.getTokens(ANTHROPIC_CLAUDE_AUTH_SERVER_ID);
    if (!tokens) return { isConnected: false, isExpired: false };

    return {
      isConnected: true,
      isExpired: this.tokenStore.isTokenExpired(tokens),
      expiresAt: tokens.expiresAt,
    };
  }

  async disconnect(): Promise<void> {
    await this.tokenStore.deleteTokens(ANTHROPIC_CLAUDE_AUTH_SERVER_ID);
  }

  private async refreshAccessToken(refreshToken: string): Promise<string> {
    const response = await fetch(ANTHROPIC_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: ANTHROPIC_CLIENT_ID,
      }),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => response.statusText);
      throw new Error(`Token refresh failed (${response.status}): ${error}`);
    }

    const json = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    await this.tokenStore.saveTokens(ANTHROPIC_CLAUDE_AUTH_SERVER_ID, {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || refreshToken,
      expiresAt: Date.now() + json.expires_in * 1000,
      tokenType: 'Bearer',
      scope: ANTHROPIC_OAUTH_SCOPES,
    });

    return json.access_token;
  }

  private generatePKCEAndState(): { verifier: string; challenge: string; state: string } {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(24).toString('base64url');
    return { verifier, challenge, state };
  }

  private parseAuthorizationInput(input: string): { code: string; state?: string } {
    const raw = input.trim();
    if (!raw) throw new Error('Authorization code is empty.');

    // Caso 1: URL completa
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const url = new URL(raw);
      const code = url.searchParams.get('code')?.trim();
      const state = url.searchParams.get('state')?.trim() || undefined;
      if (!code) throw new Error('Could not find code parameter in URL.');
      return { code, state };
    }

    // Caso 2: query string pegada (code=...&state=...)
    const qs = raw.startsWith('?') ? raw.slice(1) : raw;
    const sp = new URLSearchParams(qs);
    if (sp.has('code')) {
      const code = sp.get('code')?.trim();
      const state = sp.get('state')?.trim() || undefined;
      if (!code) throw new Error('Code parameter is empty.');
      return { code, state };
    }

    // Caso 3: formato code#state
    if (raw.includes('#')) {
      const [codePart, statePart] = raw.split('#', 2);
      const code = codePart.trim();
      const state = statePart?.trim() || undefined;
      if (!code) throw new Error('Code part is empty.');
      return { code, state };
    }

    // Caso 4: codigo plano
    return { code: raw };
  }
}

let instance: AnthropicOAuthService | null = null;

export function getAnthropicOAuthService(): AnthropicOAuthService {
  if (!instance) {
    instance = new AnthropicOAuthService();
  }
  return instance;
}
