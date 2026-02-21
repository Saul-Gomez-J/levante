/**
 * useWebPreview hook
 *
 * Subscribes to port detection events and task status changes
 * to keep the web preview store in sync.
 */

import { useEffect } from 'react';
import { useWebPreviewStore } from '@/stores/webPreviewStore';

export function useWebPreview() {
  const addServer = useWebPreviewStore((s) => s.addServer);
  const removeServer = useWebPreviewStore((s) => s.removeServer);

  // Suscribirse al evento de detección de puertos desde el main process
  useEffect(() => {
    const unsubscribe = window.levante.tasks.onPortDetected((data) => {
      addServer({
        taskId: data.taskId,
        port: data.port,
        url: `http://localhost:${data.port}`,
        command: data.command,
        description: data.description,
        detectedAt: Date.now(),
        isAlive: true,
      });
    });

    return unsubscribe;
  }, [addServer]);

  // Reconciliar contra tareas RUNNING y limpiar previews de tareas terminadas.
  // Si no hay tareas activas, se eliminan todos los servers del panel.
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

        const { servers } = useWebPreviewStore.getState();
        for (const server of servers) {
          if (!runningTaskIds.has(server.taskId)) {
            removeServer(server.taskId);
          }
        }
      } catch {
        // Ignore transient IPC errors; next interval will retry.
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
  }, [removeServer]);
}
