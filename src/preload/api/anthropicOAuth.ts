import { subscriptionOAuthApi } from './subscriptionOAuth';

export const anthropicOAuthApi = {
  start: (_mode: 'max' | 'console') =>
    subscriptionOAuthApi.start('anthropic'),

  exchange: (code: string) =>
    subscriptionOAuthApi.exchange('anthropic', code),

  status: () =>
    subscriptionOAuthApi.status('anthropic'),

  disconnect: () =>
    subscriptionOAuthApi.disconnect('anthropic'),
};
