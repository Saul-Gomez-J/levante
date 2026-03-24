import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionOAuthService } from '../SubscriptionOAuthService';

const saveTokensMock = vi.fn();

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock('../../preferencesService', () => ({
  preferencesService: {},
}));

vi.mock('../../oauth/OAuthTokenStore', () => ({
  OAuthTokenStore: vi.fn().mockImplementation(() => ({
    saveTokens: saveTokensMock,
    getTokens: vi.fn(),
    isTokenExpired: vi.fn(),
    deleteTokens: vi.fn(),
  })),
}));

describe('SubscriptionOAuthService.exchangeCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600,
      }),
    }) as typeof fetch;
  });

  it('sends parsed state for Anthropic when full callback URL is provided', async () => {
    const service = new SubscriptionOAuthService('anthropic');

    await service.exchangeCode(
      'https://console.anthropic.com/oauth/code/callback?code=test-code&state=state-from-url',
      'test-verifier',
      'state-from-url'
    );

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body).toMatchObject({
      code: 'test-code',
      code_verifier: 'test-verifier',
      state: 'state-from-url',
    });
  });

  it('falls back to expectedState for Anthropic when only the code is pasted', async () => {
    const service = new SubscriptionOAuthService('anthropic');

    await service.exchangeCode('test-code', 'test-verifier', 'expected-state');

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body).toMatchObject({
      code: 'test-code',
      code_verifier: 'test-verifier',
      state: 'expected-state',
    });
  });

  it('does not send state for OpenAI token exchange', async () => {
    const service = new SubscriptionOAuthService('openai');

    await service.exchangeCode('test-code', 'test-verifier', 'expected-state');

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body.code).toBe('test-code');
    expect(body.code_verifier).toBe('test-verifier');
    expect(body.state).toBeUndefined();
  });

  it('rejects mismatched callback state', async () => {
    const service = new SubscriptionOAuthService('anthropic');

    await expect(
      service.exchangeCode(
        'https://console.anthropic.com/oauth/code/callback?code=test-code&state=wrong-state',
        'test-verifier',
        'expected-state'
      )
    ).rejects.toThrow('Invalid OAuth state');

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
