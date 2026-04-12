/**
 * Todos API
 *
 * Preload API for agent todo/task management.
 */

import { ipcRenderer } from 'electron';

export const todosApi = {
  list: (sessionId: string) =>
    ipcRenderer.invoke('levante/todos:list', sessionId),

  onUpdated: (callback: (data: { sessionId: string }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { sessionId: string }) => {
      callback(data);
    };
    ipcRenderer.on('levante/todos:updated', handler);
    return () => ipcRenderer.removeListener('levante/todos:updated', handler);
  },
};
