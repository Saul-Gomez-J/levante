import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { getLogger } from './logging';
import type { MessageAttachment } from '../../types/database';

const logger = getLogger();

/**
 * AttachmentStorage Service
 *
 * Manages file storage for chat message attachments (images, audio).
 * Files are stored in: ~/levante/attachments/{session_id}/{message_id}/{filename}
 *
 * Features:
 * - Save files from Buffer with metadata
 * - Load files and convert to dataURL
 * - Delete attachments for a session
 * - Automatic directory creation
 */
export class AttachmentStorage {
  private baseDir: string;

  constructor() {
    // Store attachments in user data directory: ~/levante/attachments/
    const userData = app.getPath('userData');
    this.baseDir = path.join(userData, 'attachments');
    this.ensureBaseDirExists();
  }

  /**
   * Ensure base attachments directory exists
   */
  private async ensureBaseDirExists(): Promise<void> {
    try {
      if (!existsSync(this.baseDir)) {
        await fs.mkdir(this.baseDir, { recursive: true });
        logger.core.info('Attachments directory created', { path: this.baseDir });
      }
    } catch (error) {
      logger.core.error('Failed to create attachments directory', {
        path: this.baseDir,
        error: error instanceof Error ? error.message : error
      });
    }
  }

  /**
   * Save an attachment file
   *
   * @param sessionId - Chat session ID
   * @param messageId - Message ID
   * @param buffer - File buffer
   * @param filename - Original filename
   * @param mimeType - MIME type of the file
   * @returns MessageAttachment metadata
   */
  async saveAttachment(
    sessionId: string,
    messageId: string,
    buffer: Buffer,
    filename: string,
    mimeType: string
  ): Promise<MessageAttachment> {
    try {
      // Create session/message directory
      const messageDir = path.join(this.baseDir, sessionId, messageId);
      await fs.mkdir(messageDir, { recursive: true });

      // Generate safe filename
      const safeFilename = this.sanitizeFilename(filename);
      const filePath = path.join(messageDir, safeFilename);

      // Write file
      await fs.writeFile(filePath, buffer);

      // Determine attachment type from MIME
      const type = mimeType.startsWith('image/') ? 'image' : 'audio';

      // Create attachment metadata
      const attachment: MessageAttachment = {
        id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        type,
        filename: safeFilename,
        mimeType,
        size: buffer.length,
        path: path.join(sessionId, messageId, safeFilename),
      };

      logger.core.info('Attachment saved', {
        sessionId,
        messageId,
        filename: safeFilename,
        size: buffer.length,
        type
      });

      return attachment;
    } catch (error) {
      logger.core.error('Failed to save attachment', {
        sessionId,
        messageId,
        filename,
        error: error instanceof Error ? error.message : error
      });
      throw new Error(`Failed to save attachment: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Load an attachment and convert to data URL
   *
   * @param attachment - Attachment metadata
   * @returns Attachment with dataUrl populated
   */
  async loadAttachment(attachment: MessageAttachment): Promise<MessageAttachment> {
    try {
      const fullPath = path.join(this.baseDir, attachment.path);

      // Check if file exists
      if (!existsSync(fullPath)) {
        logger.core.warn('Attachment file not found', {
          path: attachment.path,
          fullPath
        });
        throw new Error('Attachment file not found');
      }

      // Read file
      const buffer = await fs.readFile(fullPath);

      // Convert to data URL
      const base64 = buffer.toString('base64');
      const dataUrl = `data:${attachment.mimeType};base64,${base64}`;

      return {
        ...attachment,
        dataUrl
      };
    } catch (error) {
      logger.core.error('Failed to load attachment', {
        path: attachment.path,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  }

  /**
   * Load all attachments for a message
   *
   * @param attachments - Array of attachment metadata
   * @returns Array of attachments with dataUrls
   */
  async loadAttachments(attachments: MessageAttachment[]): Promise<MessageAttachment[]> {
    const results = await Promise.allSettled(
      attachments.map(att => this.loadAttachment(att))
    );

    return results
      .filter((result): result is PromiseFulfilledResult<MessageAttachment> => result.status === 'fulfilled')
      .map(result => result.value);
  }

  /**
   * Delete all attachments for a session
   *
   * @param sessionId - Chat session ID
   */
  async deleteSessionAttachments(sessionId: string): Promise<void> {
    try {
      const sessionDir = path.join(this.baseDir, sessionId);

      if (existsSync(sessionDir)) {
        await fs.rm(sessionDir, { recursive: true, force: true });
        logger.core.info('Session attachments deleted', { sessionId });
      }
    } catch (error) {
      logger.core.error('Failed to delete session attachments', {
        sessionId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  }

  /**
   * Delete attachments for a specific message
   *
   * @param sessionId - Chat session ID
   * @param messageId - Message ID
   */
  async deleteMessageAttachments(sessionId: string, messageId: string): Promise<void> {
    try {
      const messageDir = path.join(this.baseDir, sessionId, messageId);

      if (existsSync(messageDir)) {
        await fs.rm(messageDir, { recursive: true, force: true });
        logger.core.info('Message attachments deleted', { sessionId, messageId });
      }
    } catch (error) {
      logger.core.error('Failed to delete message attachments', {
        sessionId,
        messageId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  }

  /**
   * Get storage stats
   *
   * @returns Object with storage information
   */
  async getStorageStats(): Promise<{ totalSize: number; fileCount: number }> {
    try {
      let totalSize = 0;
      let fileCount = 0;

      const countFiles = async (dir: string): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            await countFiles(fullPath);
          } else if (entry.isFile()) {
            const stats = await fs.stat(fullPath);
            totalSize += stats.size;
            fileCount++;
          }
        }
      };

      if (existsSync(this.baseDir)) {
        await countFiles(this.baseDir);
      }

      return { totalSize, fileCount };
    } catch (error) {
      logger.core.error('Failed to get storage stats', {
        error: error instanceof Error ? error.message : error
      });
      return { totalSize: 0, fileCount: 0 };
    }
  }

  /**
   * Sanitize filename for safe storage
   *
   * @param filename - Original filename
   * @returns Sanitized filename
   */
  private sanitizeFilename(filename: string): string {
    // Remove potentially dangerous characters
    return filename
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.{2,}/g, '_') // Prevent directory traversal
      .slice(0, 255); // Limit length
  }

  /**
   * Get base directory path
   */
  getBasePath(): string {
    return this.baseDir;
  }
}

// Singleton instance
export const attachmentStorage = new AttachmentStorage();
