export type SubscriptionOAuthProviderId = 'anthropic' | 'openai';

export interface SubscriptionOAuthProviderConfig {
  id: SubscriptionOAuthProviderId;
  displayName: string;
  oauthButtonLabel: string;
  oauthDescription: string;
  tokenStoreServerId: string;
  clientId: string;
  authorizeUrl: string;
  tokenEndpoint: string;
  redirectUri: string;
  scopes: string;
  extraAuthorizeParams?: Record<string, string>;
  apiKey: {
    label: string;
    placeholder: string;
    helpUrl: string;
    helpText: string;
  };
  extraFields?: Array<{
    key: 'organizationId' | 'projectId';
    label: string;
    placeholder: string;
    description: string;
  }>;
  modelsEndpoint: string;
  oauthModelFetchHeaders?: Record<string, string>;
  fallbackModels: Array<{ id: string; display_name?: string }>;
  /** Base URL for runtime API calls when using subscription OAuth (e.g. chatgpt.com backend). */
  oauthBaseUrl?: string;
  /**
   * Extra headers to inject on every runtime API call when using subscription OAuth.
   * These are applied after auth headers are set.
   */
  oauthApiHeaders?: Record<string, string>;
  /**
   * Beta flags to merge with any existing SDK-provided Anthropic beta header.
   */
  oauthApiBetaFlags?: string[];
  /**
   * Whether the token exchange POST body must include `state`.
   * Anthropic requires it. OpenAI does not.
   */
  sendStateInTokenExchange?: boolean;
  /**
   * System prompt prefix that must be prepended for runtime OAuth requests.
   */
  oauthSystemPromptPrefix?: string;
}

export const SUBSCRIPTION_OAUTH_PROVIDERS: Record<
  SubscriptionOAuthProviderId,
  SubscriptionOAuthProviderConfig
> = {
  anthropic: {
    id: 'anthropic',
    displayName: 'Anthropic',
    oauthButtonLabel: 'Claude Max/Pro',
    oauthDescription:
      'Connect your Claude Max or Claude Pro subscription to use it without an API key.',
    tokenStoreServerId: 'anthropic-claude-subscription',
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    authorizeUrl: 'https://claude.ai/oauth/authorize',
    tokenEndpoint: 'https://console.anthropic.com/v1/oauth/token',
    redirectUri: 'https://console.anthropic.com/oauth/code/callback',
    scopes: 'org:create_api_key user:profile user:inference',
    extraAuthorizeParams: { code: 'true' },
    apiKey: {
      label: 'Anthropic API Key',
      placeholder: 'sk-ant-...',
      helpUrl: 'https://console.anthropic.com/settings/keys',
      helpText: 'Get your API key from Anthropic Console',
    },
    modelsEndpoint: 'https://api.anthropic.com/v1/models',
    oauthModelFetchHeaders: {
      'anthropic-beta': 'oauth-2025-04-20',
      'anthropic-version': '2023-06-01',
    },
    fallbackModels: [
      { id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' },
      { id: 'claude-opus-4-1', display_name: 'Claude Opus 4.1' },
      { id: 'claude-opus-4-5', display_name: 'Claude Opus 4.5' },
      { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
      { id: 'claude-3-7-sonnet-latest', display_name: 'Claude 3.7 Sonnet (latest)' },
      { id: 'claude-3-5-haiku-latest', display_name: 'Claude 3.5 Haiku (latest)' },
    ],
    oauthApiHeaders: {
      'anthropic-dangerous-direct-browser-access': 'true',
      'user-agent': 'claude-cli/2.1.2 (external, cli)',
      'x-app': 'cli',
    },
    oauthApiBetaFlags: ['claude-code-20250219', 'oauth-2025-04-20'],
    sendStateInTokenExchange: true,
    oauthSystemPromptPrefix: 'You are Claude Code, Anthropic\'s official CLI for Claude.',
  },

  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    oauthButtonLabel: 'ChatGPT Plus/Pro',
    oauthDescription:
      'Connect your ChatGPT Plus or Pro subscription to use OpenAI models without an API key.',
    tokenStoreServerId: 'openai-codex-subscription',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    authorizeUrl: 'https://auth.openai.com/oauth/authorize',
    tokenEndpoint: 'https://auth.openai.com/oauth/token',
    redirectUri: 'http://localhost:1455/auth/callback',
    scopes: 'openid profile email offline_access',
    apiKey: {
      label: 'OpenAI API Key',
      placeholder: 'sk-...',
      helpUrl: 'https://platform.openai.com/api-keys',
      helpText: 'Get your API key from OpenAI Platform',
    },
    extraFields: [
      {
        key: 'organizationId',
        label: 'Organization ID (optional)',
        placeholder: 'org-...',
        description: 'Only needed for organization-scoped access.',
      },
    ],
    modelsEndpoint: 'https://api.openai.com/v1/models',
    /** Runtime base URL for subscription OAuth (chatgpt backend, not api.openai.com) */
    oauthBaseUrl: 'https://chatgpt.com/backend-api/codex',
    fallbackModels: [
      { id: 'gpt-5.4', display_name: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', display_name: 'GPT-5.4 Mini' },
      { id: 'gpt-5.3-codex', display_name: 'GPT-5.3 Codex' },
      { id: 'gpt-5.1-codex', display_name: 'GPT-5.1 Codex' },
      { id: 'codex-mini-latest', display_name: 'Codex Mini (Latest)' },
    ],
  },
};

export function getProviderConfig(
  providerId: SubscriptionOAuthProviderId
): SubscriptionOAuthProviderConfig {
  return SUBSCRIPTION_OAUTH_PROVIDERS[providerId];
}

export function isSubscriptionOAuthProviderId(
  value: string
): value is SubscriptionOAuthProviderId {
  return value === 'anthropic' || value === 'openai';
}
