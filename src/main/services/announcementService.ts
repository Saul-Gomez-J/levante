import { getLogger } from './logging';
import { userProfileService } from './userProfileService';
import { preferencesService } from './preferencesService';
import type {
  Announcement,
  AnnouncementApiResponse,
  AnnouncementCategory,
  LastSeenAnnouncements
} from '../../types/announcement';

const logger = getLogger();

/**
 * Announcement service for Levante
 *
 * Fetches announcements from services.levanteapp.com and handles
 * displaying new announcements to users. Privacy announcements
 * are shown when user hasn't consented to analytics.
 */
class AnnouncementService {
  private readonly API_BASE = 'https://services.levanteapp.com/api/announcements';
  private checkInProgress = false;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private lastCheckedAnnouncement: Announcement | null = null;

  /**
   * Initialize announcement service with periodic checks
   */
  initialize(): void {
    logger.core.info('Initializing announcement service');

    // Check every hour (like update checks)
    const intervalMs = 60 * 60 * 1000; // 1 hour
    this.checkInterval = setInterval(() => {
      this.checkForAnnouncements().catch(error => {
        logger.core.error('Periodic announcement check failed', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, intervalMs);

    logger.core.info('Announcement service initialized', {
      checkInterval: '1 hour'
    });
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check for new announcements
   * Returns a single highest-priority unseen announcement
   */
  async checkForAnnouncements(): Promise<Announcement | null> {
    if (this.checkInProgress) {
      logger.core.debug('Announcement check already in progress');
      return this.lastCheckedAnnouncement;
    }

    this.checkInProgress = true;

    try {
      // Build categories based on user consent
      const categories = await this.buildCategories();

      logger.core.debug('Checking for announcements', { categories });

      // Fetch from API (returns array of announcements)
      const response = await this.fetchAnnouncements(categories);

      if (!response.announcements || response.announcements.length === 0) {
        logger.core.debug('No announcements available');
        this.lastCheckedAnnouncement = null;
        return null;
      }

      // Get per-category last seen IDs
      const lastSeen = await this.getLastSeenAnnouncements();

      // Filter to only unseen announcements
      const unseenByCategory = this.filterUnseenAnnouncements(
        response.announcements,
        lastSeen
      );

      // Select highest priority unseen announcement
      const announcement = this.selectPriorityAnnouncement(unseenByCategory);

      if (!announcement) {
        logger.core.debug('All announcements already seen');
        this.lastCheckedAnnouncement = null;
        return null;
      }

      logger.core.info('New announcement found', {
        id: announcement.id,
        category: announcement.category,
        title: announcement.title
      });

      this.lastCheckedAnnouncement = announcement;
      return announcement;

    } catch (error) {
      logger.core.error('Failed to check for announcements', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    } finally {
      this.checkInProgress = false;
    }
  }

  /**
   * Mark an announcement as seen (per-category tracking)
   */
  async markAsSeen(announcementId: string, category: AnnouncementCategory): Promise<void> {
    try {
      const profile = await userProfileService.getProfile();
      const currentLastSeen = profile.analytics?.lastSeenAnnouncements ?? {};

      await userProfileService.updateProfile({
        analytics: {
          ...profile.analytics,
          hasConsented: profile.analytics?.hasConsented ?? false,
          lastSeenAnnouncements: {
            ...currentLastSeen,
            [category]: announcementId
          }
        }
      });

      logger.core.info('Announcement marked as seen', {
        id: announcementId,
        category
      });
      this.lastCheckedAnnouncement = null;

    } catch (error) {
      logger.core.error('Failed to mark announcement as seen', {
        id: announcementId,
        category,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Enable privacy consent and clear privacy tracking
   * This ensures user sees new privacy announcements if consent is revoked later
   */
  async enablePrivacyConsent(announcementId: string): Promise<void> {
    try {
      const profile = await userProfileService.getProfile();
      const currentLastSeen = profile.analytics?.lastSeenAnnouncements ?? {};

      // Remove privacy tracking - user consented, no need to show privacy announcements
      // Keep announcement tracking intact
      const { privacy: _, ...remainingTracking } = currentLastSeen;

      await userProfileService.updateProfile({
        analytics: {
          ...profile.analytics,
          hasConsented: true,
          consentedAt: new Date().toISOString(),
          anonymousUserId: profile.analytics?.anonymousUserId || crypto.randomUUID(),
          lastSeenAnnouncements: remainingTracking
        }
      });

      logger.core.info('Privacy consent enabled via announcement', {
        id: announcementId,
        clearedPrivacyTracking: true
      });
      this.lastCheckedAnnouncement = null;

    } catch (error) {
      logger.core.error('Failed to enable privacy consent', {
        id: announcementId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Build categories array based on user consent status
   * Always includes 'announcement' and 'app', adds 'privacy' if user hasn't consented
   */
  private async buildCategories(): Promise<string[]> {
    const categories = ['announcement', 'app'];

    try {
      const profile = await userProfileService.getProfile();
      const hasConsented = profile.analytics?.hasConsented === true;

      if (!hasConsented) {
        categories.push('privacy');
      }

      return categories;
    } catch (error) {
      logger.core.error('Failed to get consent status, defaulting to announcement only', {
        error: error instanceof Error ? error.message : String(error)
      });
      return categories;
    }
  }

  /**
   * Get user's language preference for API requests
   * Returns 'en' or 'es' based on user configuration
   */
  private async getLanguagePreference(): Promise<string> {
    try {
      const language = await preferencesService.get('language');
      // Normalize to 'en' or 'es' (API only supports these)
      if (language === 'es') {
        return 'es';
      }
      return 'en'; // Default to English
    } catch (error) {
      logger.core.error('Failed to get language preference', {
        error: error instanceof Error ? error.message : String(error)
      });
      return 'en';
    }
  }

  /**
   * Fetch announcements from the API
   * Returns array of announcements (one per category)
   *
   * API returns different formats:
   * - Single category: { announcement: {...} }
   * - Multiple categories: { announcements: [...], total: N }
   */
  private async fetchAnnouncements(categories: string[]): Promise<AnnouncementApiResponse> {
    const categoryParam = categories.join(',');

    // Get user's language preference (defaults to 'en')
    const language = await this.getLanguagePreference();

    const url = `${this.API_BASE}?category=${encodeURIComponent(categoryParam)}&language=${language}`;

    logger.core.debug('Fetching announcements from API', { url, categories, language });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    logger.core.debug('API response received', {
      hasAnnouncement: !!data.announcement,
      hasAnnouncements: !!data.announcements,
      announcementsCount: data.announcements?.length ?? (data.announcement ? 1 : 0),
      total: data.total,
      rawKeys: Object.keys(data)
    });

    // Normalize response: API returns different formats
    // - Single category: { announcement: {...} }
    // - Multiple categories: { announcements: [...], total: N }
    if (data.announcement && !data.announcements) {
      // Single category response - convert to array format
      return {
        announcements: [data.announcement],
        total: 1
      };
    }

    return data as AnnouncementApiResponse;
  }

  /**
   * Get per-category last seen announcement IDs from user profile
   */
  private async getLastSeenAnnouncements(): Promise<LastSeenAnnouncements> {
    try {
      const profile = await userProfileService.getProfile();
      return profile.analytics?.lastSeenAnnouncements ?? {};
    } catch (error) {
      logger.core.error('Failed to get last seen announcements', {
        error: error instanceof Error ? error.message : String(error)
      });
      return {};
    }
  }

  /**
   * Filter announcements to only include unseen ones per category
   */
  private filterUnseenAnnouncements(
    announcements: Announcement[],
    lastSeen: LastSeenAnnouncements
  ): Map<AnnouncementCategory, Announcement[]> {
    const unseen = new Map<AnnouncementCategory, Announcement[]>();

    for (const announcement of announcements) {
      const category = announcement.category;
      const lastSeenId = lastSeen[category];

      // If no lastSeenId for this category, or ID differs, it's unseen
      if (!lastSeenId || announcement.id !== lastSeenId) {
        const categoryAnnouncements = unseen.get(category) ?? [];
        categoryAnnouncements.push(announcement);
        unseen.set(category, categoryAnnouncements);
      }
    }

    return unseen;
  }

  /**
   * Select single announcement based on priority
   * Priority: announcement > app > privacy
   * Within a category, select most recent (by created_at)
   */
  private selectPriorityAnnouncement(
    unseenByCategory: Map<AnnouncementCategory, Announcement[]>
  ): Announcement | null {
    const priorityOrder: AnnouncementCategory[] = ['announcement', 'app', 'privacy'];

    for (const category of priorityOrder) {
      const announcements = unseenByCategory.get(category);
      if (announcements && announcements.length > 0) {
        // Sort by created_at descending, return most recent
        const sorted = [...announcements].sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        return sorted[0];
      }
    }

    return null;
  }
}

export const announcementService = new AnnouncementService();
