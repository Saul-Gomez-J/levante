import { ipcRenderer } from 'electron';
import type { MessageAttachment } from '../../types/database';

export const attachmentsApi = {
  /**
   * Save an attachment file
   */
  save: (
    sessionId: string,
    messageId: string,
    buffer: ArrayBuffer,
    filename: string,
    mimeType: string
  ) =>
    ipcRenderer.invoke(
      'levante/attachments/save',
      sessionId,
      messageId,
      buffer,
      filename,
      mimeType
    ),

  /**
   * Load an attachment and get data URL
   */
  load: (attachment: MessageAttachment) =>
    ipcRenderer.invoke('levante/attachments/load', attachment),

  /**
   * Load multiple attachments
   */
  loadMany: (attachments: MessageAttachment[]) =>
    ipcRenderer.invoke('levante/attachments/load-many', attachments),

  /**
   * Delete all attachments for a session
   */
  deleteSession: (sessionId: string) =>
    ipcRenderer.invoke('levante/attachments/delete-session', sessionId),

  /**
   * Delete attachments for a specific message
   */
  deleteMessage: (sessionId: string, messageId: string) =>
    ipcRenderer.invoke('levante/attachments/delete-message', sessionId, messageId),

  /**
   * Get storage statistics
   */
  stats: () => ipcRenderer.invoke('levante/attachments/stats'),
};
