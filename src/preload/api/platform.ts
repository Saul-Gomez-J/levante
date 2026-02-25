/**
 * Preload API for Levante Platform operations
 * Exposes window.levante.platform.*
 */

import { ipcRenderer } from 'electron';

export const platformApi = {
  login: (baseUrl?: string) =>
    ipcRenderer.invoke('levante/platform/login', baseUrl),

  logout: () =>
    ipcRenderer.invoke('levante/platform/logout'),

  getStatus: () =>
    ipcRenderer.invoke('levante/platform/status'),

  getModels: (baseUrl?: string) =>
    ipcRenderer.invoke('levante/platform/models', baseUrl),
};
