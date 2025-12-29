import { ipcRenderer } from 'electron';
import type { AnnouncementCategory } from '../../types/announcement';

export const announcementsApi = {
  /**
   * Check for new announcements
   */
  check: () => ipcRenderer.invoke('levante/announcements/check'),

  /**
   * Mark an announcement as seen (per-category tracking)
   */
  markSeen: (id: string, category: AnnouncementCategory) =>
    ipcRenderer.invoke('levante/announcements/mark-seen', id, category),

  /**
   * Enable privacy consent and mark announcement as seen
   */
  enablePrivacy: (id: string) => ipcRenderer.invoke('levante/announcements/enable-privacy', id),
};
