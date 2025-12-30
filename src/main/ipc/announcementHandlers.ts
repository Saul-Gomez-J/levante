/**
 * Announcement IPC Handlers Module
 *
 * Handles announcement-related IPC communication:
 * - Check for new announcements
 * - Mark announcements as seen
 * - Enable privacy consent via announcement
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { getLogger } from '../services/logging';
import { announcementService } from '../services/announcementService';
import type { Announcement, AnnouncementCategory } from '../../types/announcement';

const logger = getLogger();

/**
 * Register all announcement IPC handlers
 */
export function setupAnnouncementHandlers(): void {
  // Check for new announcements
  ipcMain.handle('levante/announcements/check', handleCheckAnnouncements);

  // Mark announcement as seen
  ipcMain.handle('levante/announcements/mark-seen', handleMarkSeen);

  // Enable privacy consent and mark as seen
  ipcMain.handle('levante/announcements/enable-privacy', handleEnablePrivacy);

  logger.core.info('Announcement handlers registered successfully');
}

/**
 * Check for new announcements
 */
async function handleCheckAnnouncements(): Promise<{
  success: boolean;
  data?: Announcement;
  error?: string;
}> {
  try {
    const announcement = await announcementService.checkForAnnouncements();
    return {
      success: true,
      data: announcement ?? undefined
    };
  } catch (error) {
    logger.core.error('Error checking for announcements', {
      error: error instanceof Error ? error.message : error
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Mark an announcement as seen (per-category tracking)
 */
async function handleMarkSeen(
  _event: IpcMainInvokeEvent,
  announcementId: string,
  category: AnnouncementCategory
): Promise<{ success: boolean; error?: string }> {
  try {
    await announcementService.markAsSeen(announcementId, category);
    return { success: true };
  } catch (error) {
    logger.core.error('Error marking announcement as seen', {
      announcementId,
      category,
      error: error instanceof Error ? error.message : error
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Enable privacy consent and mark announcement as seen
 */
async function handleEnablePrivacy(
  _event: IpcMainInvokeEvent,
  announcementId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await announcementService.enablePrivacyConsent(announcementId);
    return { success: true };
  } catch (error) {
    logger.core.error('Error enabling privacy consent', {
      announcementId,
      error: error instanceof Error ? error.message : error
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
