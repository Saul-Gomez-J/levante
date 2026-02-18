/**
 * Mini Chat Preload API
 * 
 * Exposes mini-chat window control functions to the renderer process.
 */

import { ipcRenderer } from 'electron';

export const miniChatApi = {
  /**
   * Hide the mini-chat window
   */
  hide: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('levante/mini-chat/hide');
  },

  /**
   * Resize the mini-chat window height
   */
  resize: (height: number): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('levante/mini-chat/resize', height);
  },

  /**
   * Toggle the mini-chat window visibility
   */
  toggle: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('levante/mini-chat/toggle');
  },

  /**
   * Get the current mini-chat window height
   */
  getHeight: (): Promise<{ success: boolean; height: number }> => {
    return ipcRenderer.invoke('levante/mini-chat/get-height');
  },

  /**
   * Open mini-chat conversation in main window
   */
  openInMainWindow: (data: {
    messages: any[];
    model: string;
    sessionId?: string;
  }): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
    return ipcRenderer.invoke('levante/mini-chat/open-in-main', data);
  },
};

/**
 * Subscribe to mini-chat shown event
 */
export function onMiniChatShown(callback: () => void): () => void {
  const handler = () => callback();
  ipcRenderer.on('levante/mini-chat/shown', handler);
  return () => {
    ipcRenderer.removeListener('levante/mini-chat/shown', handler);
  };
}

/**
 * Subscribe to mini-chat hidden event
 */
export function onMiniChatHidden(callback: () => void): () => void {
  const handler = () => callback();
  ipcRenderer.on('levante/mini-chat/hidden', handler);
  return () => {
    ipcRenderer.removeListener('levante/mini-chat/hidden', handler);
  };
}

/**
 * Subscribe to session load event (triggered when mini-chat transfers to main window)
 */
export function onSessionLoad(callback: (data: { sessionId: string }) => void): () => void {
  const handler = (_event: any, data: any) => callback(data);
  ipcRenderer.on('levante/session/load', handler);
  return () => {
    ipcRenderer.removeListener('levante/session/load', handler);
  };
}
