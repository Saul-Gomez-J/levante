import { app } from 'electron';
import { SupabaseClient } from './supabaseClient';
import { userProfileService } from '../userProfileService';
import { getLogger } from '../logging';

export class AnalyticsService {
    private supabaseClient: SupabaseClient;

    constructor() {
        this.supabaseClient = new SupabaseClient();
    }

    private async canTrack(): Promise<boolean> {
        try {
            const profile = await userProfileService.getProfile();
            return profile.analytics?.hasConsented === true;
        } catch (error) {
            getLogger().analytics?.info('Error checking consent', { error });
            return false;
        }
    }

    private async getUserId(): Promise<string | null> {
        try {
            const profile = await userProfileService.getProfile();
            return profile.analytics?.anonymousUserId || null;
        } catch (error) {
            getLogger().analytics?.info('Error getting user ID', { error });
            return null;
        }
    }

    async trackUser(): Promise<void> {
        try {
            if (!await this.canTrack()) return;
            const userId = await this.getUserId();
            if (!userId) return;

            const success = await this.supabaseClient.insertUser(userId, true);
            if (success) {
                getLogger().analytics?.info('User tracked successfully', { userId });
            } else {
                throw new Error('Failed to insert user record');
            }
        } catch (error) {
            getLogger().analytics?.error('Error tracking user', { error });
            throw error; // Re-throw so frontend sees it
        }
    }

    async trackAppOpen(): Promise<void> {
        try {
            if (!await this.canTrack()) return;
            const userId = await this.getUserId();
            if (!userId) return;

            const version = app.getVersion();
            let platform = process.platform as string;
            if (platform === 'darwin') platform = 'macOS';
            if (platform === 'win32') platform = 'Windows';
            if (platform === 'linux') platform = 'Linux';

            await this.supabaseClient.insertAppOpen(userId, version, platform);
        } catch (error) {
            getLogger().analytics?.info('Error tracking app open', { error });
        }
    }

    async trackConversation(): Promise<void> {
        try {
            if (!await this.canTrack()) return;
            const userId = await this.getUserId();
            if (!userId) return;

            await this.supabaseClient.insertConversation(userId);
        } catch (error) {
            getLogger().analytics?.info('Error tracking conversation', { error });
        }
    }

    async trackMCPUsage(name: string, status: 'active' | 'removed'): Promise<void> {
        try {
            if (!await this.canTrack()) return;
            const userId = await this.getUserId();
            if (!userId) return;

            await this.supabaseClient.insertMCPUsage(userId, name, status);
        } catch (error) {
            getLogger().analytics?.info('Error tracking MCP usage', { error });
        }
    }

    async trackProviderStats(name: string, count: number): Promise<void> {
        try {
            if (!await this.canTrack()) return;
            const userId = await this.getUserId();
            if (!userId) return;

            await this.supabaseClient.insertProviderStats(userId, name, count);
        } catch (error) {
            getLogger().analytics?.info('Error tracking provider stats', { error });
        }
    }

    async disableAnalytics(): Promise<void> {
        try {
            // We don't check canTrack here because we want to update the record to say sharing_data = false
            // even if the local state has already been updated to false
            const userId = await this.getUserId();
            if (!userId) return;

            await this.supabaseClient.updateUser(userId, { sharing_data: false });
        } catch (error) {
            getLogger().analytics?.info('Error disabling analytics', { error });
        }
    }
}

export const analyticsService = new AnalyticsService();
