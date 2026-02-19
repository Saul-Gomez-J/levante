import { ipcMain } from 'electron';
import { getLogger } from '../services/logging';
import {
  createPreviewWindow,
  loadPreviewUrl,
  reloadPreview,
  navigatePreview,
  togglePreviewDevTools,
  closePreviewWindow,
  getPreviewState,
  setPreviewAutoRefresh,
  openPreviewExternal,
} from './window';
import { initializeFileWatcher } from './fileWatcher';
import { discoverPreviewUrls } from './urlDiscovery';
import { preferencesService } from '../services/preferencesService';
import type { PreviewDiscoveryOptions } from '../../types/preview';

const logger = getLogger();

/**
 * Sets up all IPC handlers for preview functionality
 */
export function setupPreviewHandlers(): void {
  logger.core.info('Setting up preview IPC handlers');

  // Clean up any existing handlers first
  const invokeChannels = [
    'levante/preview/open',
    'levante/preview/load-url',
    'levante/preview/reload',
    'levante/preview/navigate',
    'levante/preview/toggle-devtools',
    'levante/preview/get-state',
    'levante/preview/close',
    'levante/preview/discover-urls',
  ];

  invokeChannels.forEach(channel => {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Handler didn't exist, that's fine
    }
  });

  // Register invoke handlers (from main window/preload principal)
  ipcMain.handle('levante/preview/open', (_event, payload?: { url?: string }) => {
    try {
      createPreviewWindow(payload?.url);
      return { success: true };
    } catch (error) {
      logger.core.error('Failed to open preview', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, error: 'Failed to open preview window' };
    }
  });

  ipcMain.handle('levante/preview/load-url', (_event, payload: { url: string }) => {
    return loadPreviewUrl(payload.url);
  });

  ipcMain.handle('levante/preview/reload', () => {
    reloadPreview();
    return { success: true };
  });

  ipcMain.handle('levante/preview/navigate', (_event, payload: { direction: 'back' | 'forward' }) => {
    navigatePreview(payload.direction);
    return { success: true };
  });

  ipcMain.handle('levante/preview/toggle-devtools', () => {
    const isOpen = togglePreviewDevTools();
    return { success: true, isOpen };
  });

  ipcMain.handle('levante/preview/get-state', () => {
    return getPreviewState();
  });

  ipcMain.handle('levante/preview/close', () => {
    closePreviewWindow();
    return { success: true };
  });

  ipcMain.handle('levante/preview/discover-urls', async (_event, options?: PreviewDiscoveryOptions) => {
    try {
      const cwd = preferencesService.get<string | null>('coworkModeCwd') ?? null;
      const result = await discoverPreviewUrls(cwd, options);
      return result;
    } catch (error) {
      logger.core.error('Failed to discover preview URLs', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        cwd: null,
        services: [],
        recommendedUrl: null,
        error: 'Discovery failed',
        durationMs: 0,
      };
    }
  });

  // Clean up nav listeners
  const navChannels = [
    'levante/preview/nav/navigate-to',
    'levante/preview/nav/go-back',
    'levante/preview/nav/go-forward',
    'levante/preview/nav/reload',
    'levante/preview/nav/toggle-devtools',
    'levante/preview/nav/open-external',
    'levante/preview/nav/set-auto-refresh',
  ];

  navChannels.forEach(channel => {
    ipcMain.removeAllListeners(channel);
  });

  // Register nav listeners (from nav bar preload)
  ipcMain.on('levante/preview/nav/navigate-to', (_event, payload: { url: string }) => {
    loadPreviewUrl(payload.url);
  });

  ipcMain.on('levante/preview/nav/go-back', () => {
    navigatePreview('back');
  });

  ipcMain.on('levante/preview/nav/go-forward', () => {
    navigatePreview('forward');
  });

  ipcMain.on('levante/preview/nav/reload', () => {
    reloadPreview();
  });

  ipcMain.on('levante/preview/nav/toggle-devtools', () => {
    togglePreviewDevTools();
  });

  ipcMain.on('levante/preview/nav/open-external', () => {
    openPreviewExternal();
  });

  ipcMain.on('levante/preview/nav/set-auto-refresh', (_event, payload: { enabled: boolean }) => {
    setPreviewAutoRefresh(!!payload.enabled);
  });

  // Initialize file watcher
  initializeFileWatcher().catch(error => {
    logger.core.error('Failed to initialize preview file watcher', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  logger.core.info('Preview IPC handlers registered');
}
