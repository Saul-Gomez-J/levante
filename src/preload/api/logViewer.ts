import { ipcRenderer } from 'electron';
import type { LogEntryUI } from '../../main/types/logger';

/**
 * Log viewer API exposed to renderer process
 */
export const logViewerApi = {
  /**
   * Start watching the log file for changes
   */
  startWatching: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('levante/logs/start-watching'),

  /**
   * Stop watching the log file
   */
  stopWatching: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('levante/logs/stop-watching'),

  /**
   * Check if currently watching logs
   */
  isWatching: (): Promise<{ success: boolean; data?: boolean; error?: string }> =>
    ipcRenderer.invoke('levante/logs/is-watching'),

  /**
   * Get recent log entries
   */
  getRecent: (limit: number): Promise<{ success: boolean; data?: LogEntryUI[]; error?: string }> =>
    ipcRenderer.invoke('levante/logs/get-recent', limit),

  /**
   * Get current log file path
   */
  getCurrentFile: (): Promise<{ success: boolean; data?: string; error?: string }> =>
    ipcRenderer.invoke('levante/logs/get-current-file'),

  /**
   * Get log directory path
   */
  getDirectory: (): Promise<{ success: boolean; data?: string; error?: string }> =>
    ipcRenderer.invoke('levante/logs/get-directory'),

  /**
   * Subscribe to new log entries
   * Returns cleanup function to remove listener
   */
  onNewEntry: (callback: (entry: LogEntryUI) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: LogEntryUI) => {
      callback(entry);
    };

    ipcRenderer.on('levante/logs/new-entry', listener);

    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('levante/logs/new-entry', listener);
    };
  },
};

export type LogViewerAPI = typeof logViewerApi;
