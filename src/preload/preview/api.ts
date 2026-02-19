import { ipcRenderer } from 'electron';
import type { ConsoleError, NavigationEvent, PreviewState } from '../../types/preview';

export const previewApi = {
  open: (url?: string) => ipcRenderer.invoke('levante/preview/open', { url }),
  loadUrl: (url: string) => ipcRenderer.invoke('levante/preview/load-url', { url }),
  reload: () => ipcRenderer.invoke('levante/preview/reload'),
  navigate: (direction: 'back' | 'forward') =>
    ipcRenderer.invoke('levante/preview/navigate', { direction }),
  toggleDevTools: () => ipcRenderer.invoke('levante/preview/toggle-devtools'),
  getState: () => ipcRenderer.invoke('levante/preview/get-state') as Promise<PreviewState>,
  close: () => ipcRenderer.invoke('levante/preview/close'),

  onConsoleError: (callback: (error: ConsoleError) => void) => {
    const listener = (_event: unknown, data: ConsoleError) => callback(data);
    ipcRenderer.on('levante/preview/console-error', listener);
    return () => ipcRenderer.removeListener('levante/preview/console-error', listener);
  },
  onNavigationEvent: (callback: (event: NavigationEvent) => void) => {
    const listener = (_event: unknown, data: NavigationEvent) => callback(data);
    ipcRenderer.on('levante/preview/navigation-event', listener);
    return () => ipcRenderer.removeListener('levante/preview/navigation-event', listener);
  },
  onFileChanged: (callback: (data: { filePath: string; timestamp: number }) => void) => {
    const listener = (_event: unknown, data: { filePath: string; timestamp: number }) => callback(data);
    ipcRenderer.on('levante/preview/file-changed', listener);
    return () => ipcRenderer.removeListener('levante/preview/file-changed', listener);
  },
  onClosed: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('levante/preview/preview-closed', listener);
    return () => ipcRenderer.removeListener('levante/preview/preview-closed', listener);
  },
};
