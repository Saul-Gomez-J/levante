/**
 * Window Control API
 * Provides IPC methods for window controls (minimize, maximize, close)
 */

import { ipcRenderer } from 'electron';

export const windowApi = {
  /**
   * Minimize the window
   */
  minimize: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('levante/window/minimize');
  },

  /**
   * Maximize or restore the window
   */
  maximize: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('levante/window/maximize');
  },

  /**
   * Close the window
   */
  close: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('levante/window/close');
  },

  /**
   * Check if window is maximized
   */
  isMaximized: (): Promise<{ success: boolean; data?: boolean; error?: string }> => {
    return ipcRenderer.invoke('levante/window/isMaximized');
  },

  /**
   * Listen for maximize state changes
   */
  onMaximizeChanged: (callback: (isMaximized: boolean) => void): (() => void) => {
    const handler = (_event: any, isMaximized: boolean) => callback(isMaximized);
    ipcRenderer.on('levante/window/maximize-changed', handler);

    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('levante/window/maximize-changed', handler);
    };
  },
};
