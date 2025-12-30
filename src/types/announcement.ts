/**
 * Announcement types for Levante
 * Used for displaying announcements and privacy notices from the API
 */

/**
 * Category of announcements
 * Priority order: announcement > app > privacy
 */
export type AnnouncementCategory = 'announcement' | 'app' | 'privacy';

/**
 * Per-category tracking of last seen announcement IDs
 */
export type LastSeenAnnouncements = Partial<Record<AnnouncementCategory, string>>;

export interface Announcement {
  /**
   * Unique identifier for the announcement
   */
  id: string;

  /**
   * Title to display as heading
   */
  title: string;

  /**
   * Full text content (HTML format - sanitized before rendering)
   */
  full_text: string;

  /**
   * Category of the announcement
   * - 'announcement': General announcements
   * - 'privacy': Privacy-related notices (shown when user hasn't consented)
   */
  category: AnnouncementCategory;

  /**
   * Timestamp when the announcement was created
   */
  created_at: string;
}

/**
 * API response structure from services.levanteapp.com
 * Returns an array of announcements (one per category)
 */
export interface AnnouncementApiResponse {
  announcements: Announcement[];
  total: number;
}

/**
 * Internal response for IPC (single announcement after priority selection)
 */
export interface AnnouncementResponse {
  announcement?: Announcement;
}
