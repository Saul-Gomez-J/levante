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
};
