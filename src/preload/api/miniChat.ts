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
