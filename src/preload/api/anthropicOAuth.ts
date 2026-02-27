import { ipcRenderer } from 'electron';

export const anthropicOAuthApi = {
  start: (mode: 'max' | 'console') =>
    ipcRenderer.invoke('levante/anthropic/oauth/start', { mode }),

  exchange: (code: string) =>
    ipcRenderer.invoke('levante/anthropic/oauth/exchange', { code }),

  status: () =>
    ipcRenderer.invoke('levante/anthropic/oauth/status'),

  disconnect: () =>
    ipcRenderer.invoke('levante/anthropic/oauth/disconnect'),
};
