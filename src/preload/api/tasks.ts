/**
 * Tasks API
 *
 * Preload API for background task management.
 */

import { ipcRenderer } from 'electron';

export const tasksApi = {
  list: (filter?: { status?: string }) =>
    ipcRenderer.invoke('levante/tasks:list', filter),

  get: (taskId: string) =>
    ipcRenderer.invoke('levante/tasks:get', taskId),

  getOutput: (taskId: string, options?: { includeTimestamps?: boolean; tail?: number }) =>
    ipcRenderer.invoke('levante/tasks:getOutput', taskId, options),

  wait: (taskId: string, options?: { timeoutMs?: number }) =>
    ipcRenderer.invoke('levante/tasks:wait', taskId, options),

  kill: (taskId: string) =>
    ipcRenderer.invoke('levante/tasks:kill', taskId),

  stats: () =>
    ipcRenderer.invoke('levante/tasks:stats'),

  cleanup: (maxAgeMs?: number) =>
    ipcRenderer.invoke('levante/tasks:cleanup', maxAgeMs),

  // Evento push: el main process notifica cuando se detecta un puerto
  onPortDetected: (
    callback: (data: { taskId: string; port: number; command: string; description?: string }) => void
  ): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { taskId: string; port: number; command: string; description?: string }) => {
      callback(data);
    };
    ipcRenderer.on('levante/tasks:portDetected', handler);
    return () => ipcRenderer.removeListener('levante/tasks:portDetected', handler);
  },
};
