import { ipcMain } from 'electron';
import { analyticsService } from '../services/analytics';

export function registerAnalyticsHandlers() {
    ipcMain.handle('levante/analytics/track-conversation', async () => {
        await analyticsService.trackConversation();
        return { success: true };
    });

    ipcMain.handle('levante/analytics/track-mcp', async (_, name: string, status: 'active' | 'removed') => {
        await analyticsService.trackMCPUsage(name, status);
        return { success: true };
    });

    ipcMain.handle('levante/analytics/track-model-usage', async (_, modelId: string, provider: string) => {
        await analyticsService.trackModelUsage(modelId, provider);
        return { success: true };
    });

    ipcMain.handle('levante/analytics/track-user', async () => {
        await analyticsService.trackUser();
        return { success: true };
    });

    ipcMain.handle('levante/analytics/track-app-open', async (_, force: boolean = false) => {
        await analyticsService.trackAppOpen(force);
        return { success: true };
    });

    ipcMain.handle('levante/analytics/disable', async () => {
        await analyticsService.disableAnalytics();
        return { success: true };
    });

    ipcMain.handle('levante/analytics/enable', async () => {
        await analyticsService.enableAnalytics();
        return { success: true };
    });
}
