import { contextBridge, ipcRenderer } from 'electron';
import type {
  ConsoleError,
  NavigationEvent,
  WebAppLoadError,
  PreviewDiscoveryResult,
  PreviewDiscoveryOptions,
} from '../../types/preview';

const api = {
  // Commands (send to main)
  navigateTo: (url: string) => ipcRenderer.send('levante/preview/nav/navigate-to', { url }),
  goBack: () => ipcRenderer.send('levante/preview/nav/go-back'),
  goForward: () => ipcRenderer.send('levante/preview/nav/go-forward'),
  reload: () => ipcRenderer.send('levante/preview/nav/reload'),
  toggleDevTools: () => ipcRenderer.send('levante/preview/nav/toggle-devtools'),
  openExternal: () => ipcRenderer.send('levante/preview/nav/open-external'),
  setAutoRefresh: (enabled: boolean) =>
    ipcRenderer.send('levante/preview/nav/set-auto-refresh', { enabled }),

  // Discovery (invoke to main)
  discoverUrls: (options?: PreviewDiscoveryOptions): Promise<PreviewDiscoveryResult> =>
    ipcRenderer.invoke('levante/preview/discover-urls', options),

  // Event listeners (receive from main)
  onUrlChanged: (cb: (data: { url: string }) => void) => {
    const listener = (_event: unknown, data: { url: string }) => cb(data);
    ipcRenderer.on('levante/preview/nav/url-changed', listener);
    return () => ipcRenderer.removeListener('levante/preview/nav/url-changed', listener);
  },

  onLoading: (cb: (data: { isLoading: boolean }) => void) => {
    const listener = (_event: unknown, data: { isLoading: boolean }) => cb(data);
    ipcRenderer.on('levante/preview/nav/webapp-loading', listener);
    return () => ipcRenderer.removeListener('levante/preview/nav/webapp-loading', listener);
  },

  onNavigated: (cb: (data: NavigationEvent) => void) => {
    const listener = (_event: unknown, data: NavigationEvent) => cb(data);
    ipcRenderer.on('levante/preview/nav/webapp-navigated', listener);
    return () => ipcRenderer.removeListener('levante/preview/nav/webapp-navigated', listener);
  },

  onConsoleError: (cb: (data: ConsoleError) => void) => {
    const listener = (_event: unknown, data: ConsoleError) => cb(data);
    ipcRenderer.on('levante/preview/nav/console-error', listener);
    return () => ipcRenderer.removeListener('levante/preview/nav/console-error', listener);
  },

  onDevToolsToggled: (cb: (data: { isOpen: boolean }) => void) => {
    const listener = (_event: unknown, data: { isOpen: boolean }) => cb(data);
    ipcRenderer.on('levante/preview/nav/devtools-toggled', listener);
    return () => ipcRenderer.removeListener('levante/preview/nav/devtools-toggled', listener);
  },

  onLoadError: (cb: (data: WebAppLoadError) => void) => {
    const listener = (_event: unknown, data: WebAppLoadError) => cb(data);
    ipcRenderer.on('levante/preview/nav/webapp-load-error', listener);
    return () => ipcRenderer.removeListener('levante/preview/nav/webapp-load-error', listener);
  },

  onFileChanged: (cb: (data: { filePath: string; timestamp: number }) => void) => {
    const listener = (_event: unknown, data: { filePath: string; timestamp: number }) => cb(data);
    ipcRenderer.on('levante/preview/nav/file-changed', listener);
    return () => ipcRenderer.removeListener('levante/preview/nav/file-changed', listener);
  },
};

contextBridge.exposeInMainWorld('levantePreviewNav', api);

// Type declaration for the nav bar window
declare global {
  interface Window {
    levantePreviewNav: typeof api;
  }
}
