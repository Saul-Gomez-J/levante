import { ipcMain } from 'electron';
import { attachmentStorage } from '../services/attachmentStorage';
import { getLogger } from '../services/logging';
import type { MessageAttachment } from '../../types/database';

const logger = getLogger();

export function setupAttachmentHandlers() {
  // Save attachment
  ipcMain.removeHandler('levante/attachments/save');
  ipcMain.handle(
    'levante/attachments/save',
    async (
      _,
      sessionId: string,
      messageId: string,
      buffer: ArrayBuffer,
      filename: string,
      mimeType: string
    ) => {
      try {
        const nodeBuffer = Buffer.from(buffer);
        const attachment = await attachmentStorage.saveAttachment(
          sessionId,
          messageId,
          nodeBuffer,
          filename,
          mimeType
        );

        return {
          success: true,
          data: attachment
        };
      } catch (error) {
        logger.ipc.error('Failed to save attachment', {
          sessionId,
          messageId,
          filename,
          error: error instanceof Error ? error.message : error
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save attachment'
        };
      }
    }
  );

  // Load attachment
  ipcMain.removeHandler('levante/attachments/load');
  ipcMain.handle(
    'levante/attachments/load',
    async (_, attachment: MessageAttachment) => {
      try {
        const loadedAttachment = await attachmentStorage.loadAttachment(attachment);

        return {
          success: true,
          data: loadedAttachment
        };
      } catch (error) {
        logger.ipc.error('Failed to load attachment', {
          path: attachment.path,
          error: error instanceof Error ? error.message : error
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load attachment'
        };
      }
    }
  );

  // Load multiple attachments
  ipcMain.removeHandler('levante/attachments/load-many');
  ipcMain.handle(
    'levante/attachments/load-many',
    async (_, attachments: MessageAttachment[]) => {
      try {
        const loadedAttachments = await attachmentStorage.loadAttachments(attachments);

        return {
          success: true,
          data: loadedAttachments
        };
      } catch (error) {
        logger.ipc.error('Failed to load attachments', {
          count: attachments.length,
          error: error instanceof Error ? error.message : error
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load attachments'
        };
      }
    }
  );

  // Delete session attachments
  ipcMain.removeHandler('levante/attachments/delete-session');
  ipcMain.handle('levante/attachments/delete-session', async (_, sessionId: string) => {
    try {
      await attachmentStorage.deleteSessionAttachments(sessionId);

      return {
        success: true
      };
    } catch (error) {
      logger.ipc.error('Failed to delete session attachments', {
        sessionId,
        error: error instanceof Error ? error.message : error
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete session attachments'
      };
    }
  });

  // Delete message attachments
  ipcMain.removeHandler('levante/attachments/delete-message');
  ipcMain.handle(
    'levante/attachments/delete-message',
    async (_, sessionId: string, messageId: string) => {
      try {
        await attachmentStorage.deleteMessageAttachments(sessionId, messageId);

        return {
          success: true
        };
      } catch (error) {
        logger.ipc.error('Failed to delete message attachments', {
          sessionId,
          messageId,
          error: error instanceof Error ? error.message : error
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete message attachments'
        };
      }
    }
  );

  // Get storage stats
  ipcMain.removeHandler('levante/attachments/stats');
  ipcMain.handle('levante/attachments/stats', async () => {
    try {
      const stats = await attachmentStorage.getStorageStats();

      return {
        success: true,
        data: stats
      };
    } catch (error) {
      logger.ipc.error('Failed to get storage stats', {
        error: error instanceof Error ? error.message : error
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get storage stats'
      };
    }
  });

  // Get base path for attachments
  ipcMain.removeHandler('levante/attachments/base-path');
  ipcMain.handle('levante/attachments/base-path', () => {
    return {
      success: true,
      data: attachmentStorage.getBasePath()
    };
  });

  logger.ipc.info('Attachment IPC handlers registered');
}
