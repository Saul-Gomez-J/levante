/**
 * useWebPreview hook
 *
 * Subscribes to port detection events and task status changes
 * to keep the side panel store in sync.
 */

import { useEffect } from 'react';
import { useSidePanelStore } from '@/stores/sidePanelStore';

export function useWebPreview() {
  const addServerTab = useSidePanelStore((state) => state.addServerTab);
  const removeServerTab = useSidePanelStore((state) => state.removeServerTab);

  useEffect(() => {
    const unsubscribe = window.levante.tasks.onPortDetected((data) => {
      addServerTab({
        id: data.taskId,
        port: data.port,
        url: `http://localhost:${data.port}`,
        command: data.command,
        description: data.description,
        detectedAt: Date.now(),
        isAlive: true,
      });
    });

    return unsubscribe;
  }, [addServerTab]);

  // Reconcile with running tasks and remove finished server tabs.
  useEffect(() => {
    let mounted = true;

    const reconcileServers = async () => {
      try {
        const result = await window.levante.tasks.list({ status: 'running' });
        if (!mounted || !result.success) return;

        const runningTaskIds = new Set(
          Array.isArray(result.data)
            ? result.data.map((task: { id: string }) => task.id)
            : []
        );

        const serverTabs = useSidePanelStore.getState().getServerTabs();
        for (const server of serverTabs) {
          if (!runningTaskIds.has(server.id)) {
            removeServerTab(server.id);
          }
        }
      } catch {
        // Ignore transient IPC errors; next interval retries.
      }
    };

    void reconcileServers();
    const intervalId = window.setInterval(() => {
      void reconcileServers();
    }, 3000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [removeServerTab]);
}
