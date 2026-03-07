import { ipcRenderer } from 'electron';

export const filesystemApi = {
  setWorkingDir: (path: string) =>
    ipcRenderer.invoke('levante/fs:setWorkingDir', { path }),

  getWorkingDir: () =>
    ipcRenderer.invoke('levante/fs:getWorkingDir'),

  readDir: (
    path: string,
    options?: { showHidden?: boolean; sortBy?: 'name' | 'type' | 'modified' }
  ) => ipcRenderer.invoke('levante/fs:readDir', { path, options }),

  readFile: (
    path: string,
    options?: { maxSize?: number; encoding?: string }
  ) => ipcRenderer.invoke('levante/fs:readFile', { path, options }),
};
