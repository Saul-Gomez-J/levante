import { useEffect } from 'react';
import { useMCPStore } from '@/stores/mcpStore';

/**
 * Hook to listen for MCP events from the main process.
 * Currently handles:
 * - tools/list_changed: When a server's tools list changes
 */
export function useMCPEvents() {
  const { loadToolsCache } = useMCPStore();

  useEffect(() => {
    // Listen for tools updated event
    const cleanup = window.levante.mcp.onToolsUpdated((data) => {
      console.log('MCP tools updated for server:', data.serverId);

      // Reload the tools cache to get the updated tools
      loadToolsCache();
    });

    return () => {
      cleanup();
    };
  }, [loadToolsCache]);
}
