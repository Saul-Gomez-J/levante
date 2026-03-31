import { ipcRenderer } from 'electron';

export const analyticsApi = {
    trackConversation: () => ipcRenderer.invoke('levante/analytics/track-conversation'),
    trackMCP: (name: string, status: 'active' | 'removed') =>
        ipcRenderer.invoke('levante/analytics/track-mcp', name, status),
    trackModelUsage: (modelId: string, provider: string) =>
        ipcRenderer.invoke('levante/analytics/track-model-usage', modelId, provider),
    trackUser: () => ipcRenderer.invoke('levante/analytics/track-user'),
    trackAppOpen: (force?: boolean) => ipcRenderer.invoke('levante/analytics/track-app-open', force),
    disableAnalytics: () => ipcRenderer.invoke('levante/analytics/disable'),
    enableAnalytics: () => ipcRenderer.invoke('levante/analytics/enable'),
};
