import { ipcRenderer } from 'electron';

export const subscriptionOAuthApi = {
  start: (providerId: string) =>
    ipcRenderer.invoke('levante/subscription-oauth/start', { providerId }),

  exchange: (providerId: string, code: string) =>
    ipcRenderer.invoke('levante/subscription-oauth/exchange', {
      providerId,
      code,
    }),

  status: (providerId: string) =>
    ipcRenderer.invoke('levante/subscription-oauth/status', { providerId }),

  disconnect: (providerId: string) =>
    ipcRenderer.invoke('levante/subscription-oauth/disconnect', { providerId }),

  /** Listen for automatic callback completion (local server captured the code). */
  onCallback: (callback: (data: { success: boolean; providerId: string; error?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('levante/subscription-oauth/callback', handler);
    return () => {
      ipcRenderer.removeListener('levante/subscription-oauth/callback', handler);
    };
  },
};
