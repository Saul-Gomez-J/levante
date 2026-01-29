import { ipcMain, BrowserWindow } from 'electron';
import { logViewerService } from '../services/logViewer';
import { getLogger } from '../services/logging';

const logger = getLogger();

/**
 * Setup IPC handlers for log viewer functionality
 */
export function setupLogViewerHandlers(mainWindow: BrowserWindow): void {
  /**
   * Start watching log file for changes
   */
  ipcMain.handle('levante/logs/start-watching', async () => {
    try {
      logViewerService.startWatching(mainWindow);
      logger.core.info('IPC: Started watching logs');
      return { success: true };
    } catch (error) {
      logger.core.error('IPC: Failed to start watching logs', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start watching logs',
      };
    }
  });

  /**
   * Stop watching log file
   */
  ipcMain.handle('levante/logs/stop-watching', async () => {
    try {
      logViewerService.stopWatching();
      logger.core.info('IPC: Stopped watching logs');
      return { success: true };
    } catch (error) {
      logger.core.error('IPC: Failed to stop watching logs', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop watching logs',
      };
    }
  });

  /**
   * Check if currently watching logs
   */
  ipcMain.handle('levante/logs/is-watching', async () => {
    try {
      const isWatching = logViewerService.isWatching();
      logger.core.debug('IPC: Checked watching status', { isWatching });
      return { success: true, data: isWatching };
    } catch (error) {
      logger.core.error('IPC: Failed to check watching status', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check watching status',
      };
    }
  });

  /**
   * Get recent log entries
   */
  ipcMain.handle('levante/logs/get-recent', async (_event, limit: number = 500) => {
    try {
      const entries = await logViewerService.getRecentEntries(limit);
      logger.core.debug('IPC: Retrieved recent log entries', {
        count: entries.length,
        limit,
      });
      return { success: true, data: entries };
    } catch (error) {
      logger.core.error('IPC: Failed to get recent log entries', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get recent log entries',
      };
    }
  });

  /**
   * Get current log file path
   */
  ipcMain.handle('levante/logs/get-current-file', async () => {
    try {
      const currentFile = logViewerService.getCurrentLogFile();
      return { success: true, data: currentFile };
    } catch (error) {
      logger.core.error('IPC: Failed to get current log file', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get current log file',
      };
    }
  });

  /**
   * Get log directory path
   */
  ipcMain.handle('levante/logs/get-directory', async () => {
    try {
      const directory = logViewerService.getLogDirectory();
      return { success: true, data: directory };
    } catch (error) {
      logger.core.error('IPC: Failed to get log directory', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get log directory',
      };
    }
  });

  logger.core.info('Log viewer IPC handlers registered');
}

/**
 * Cleanup log viewer handlers
 */
export function cleanupLogViewerHandlers(): void {
  logViewerService.dispose();
  logger.core.info('Log viewer handlers cleaned up');
}
