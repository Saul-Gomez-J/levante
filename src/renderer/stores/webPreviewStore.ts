/**
 * Web Preview Store
 *
 * Manages the state of the web preview side panel.
 * Tracks detected server ports from background tasks.
 */

import { create } from 'zustand';

export interface DetectedServer {
  taskId: string;
  port: number;
  url: string;        // http://localhost:{port}
  command: string;
  description?: string;
  detectedAt: number; // timestamp
  isAlive: boolean;   // true mientras la task sigue running
}

interface WebPreviewState {
  // Lista de servidores detectados (puede haber varios)
  servers: DetectedServer[];

  // Estado del panel
  isPanelOpen: boolean;
  activeTaskId: string | null;  // taskId del servidor actualmente visible

  // Toast de notificación
  pendingToast: DetectedServer | null;

  // Acciones
  addServer: (server: DetectedServer) => void;
  markServerDead: (taskId: string) => void;
  removeServer: (taskId: string) => void;
  openPanel: (taskId?: string) => void;
  closePanel: () => void;
  setActiveServer: (taskId: string) => void;
  clearToast: () => void;
}

export const useWebPreviewStore = create<WebPreviewState>((set, get) => ({
  servers: [],
  isPanelOpen: false,
  activeTaskId: null,
  pendingToast: null,

  addServer: (server) => {
    set((state) => {
      // No duplicar si ya existe este taskId
      const exists = state.servers.some((s) => s.taskId === server.taskId);
      if (exists) return state;

      const newServers = [...state.servers, server];

      // Si el panel está cerrado, mostrar toast
      return {
        servers: newServers,
        pendingToast: state.isPanelOpen ? null : server,
        // Si no hay servidor activo, activar este
        activeTaskId: state.activeTaskId ?? server.taskId,
      };
    });
  },

  markServerDead: (taskId) => {
    set((state) => ({
      servers: state.servers.map((s) =>
        s.taskId === taskId ? { ...s, isAlive: false } : s
      ),
    }));
  },

  removeServer: (taskId) => {
    set((state) => {
      const newServers = state.servers.filter((s) => s.taskId !== taskId);
      const newActiveTaskId =
        state.activeTaskId === taskId
          ? (newServers.find((s) => s.isAlive)?.taskId ?? newServers[0]?.taskId ?? null)
          : state.activeTaskId;
      return {
        servers: newServers,
        activeTaskId: newActiveTaskId,
        isPanelOpen: newServers.length === 0 ? false : state.isPanelOpen,
      };
    });
  },

  openPanel: (taskId) => {
    set((state) => ({
      isPanelOpen: true,
      activeTaskId: taskId ?? state.activeTaskId ?? state.servers[0]?.taskId ?? null,
      pendingToast: null,
    }));
  },

  closePanel: () => {
    set({ isPanelOpen: false });
  },

  setActiveServer: (taskId) => {
    set({ activeTaskId: taskId });
  },

  clearToast: () => {
    set({ pendingToast: null });
  },
}));
