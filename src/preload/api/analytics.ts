import { ipcRenderer } from 'electron';

export const analyticsApi = {
    trackConversation: () => ipcRenderer.invoke('levante/analytics/track-conversation'),
    trackMCP: (name: string, status: 'active' | 'removed') =>
        ipcRenderer.invoke('levante/analytics/track-mcp', name, status),
    trackProvider: (name: string, count: number) =>
        ipcRenderer.invoke('levante/analytics/track-provider', name, count),
    trackUser: () => ipcRenderer.invoke('levante/analytics/track-user'),
    disableAnalytics: () => ipcRenderer.invoke('levante/analytics/disable'),
};
