import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface ToolApprovalStore {
  // Map: sessionId -> Set de serverIds aprobados
  sessionApprovals: Map<string, Set<string>>;

  // Acciones
  approveServerForSession: (sessionId: string, serverId: string) => void;
  isServerApprovedForSession: (sessionId: string, serverId: string) => boolean;
  clearSessionApprovals: (sessionId: string) => void;
  clearAllApprovals: () => void;
}

export const useToolApprovalStore = create<ToolApprovalStore>()(
  devtools(
    (set, get) => ({
      sessionApprovals: new Map(),

      approveServerForSession: (sessionId, serverId) => {
        set((state) => {
          const newMap = new Map(state.sessionApprovals);
          const serverSet = newMap.get(sessionId) || new Set();
          serverSet.add(serverId);
          newMap.set(sessionId, serverSet);
          return { sessionApprovals: newMap };
        });
      },

      isServerApprovedForSession: (sessionId, serverId) => {
        const serverSet = get().sessionApprovals.get(sessionId);
        return serverSet?.has(serverId) ?? false;
      },

      clearSessionApprovals: (sessionId) => {
        set((state) => {
          const newMap = new Map(state.sessionApprovals);
          newMap.delete(sessionId);
          return { sessionApprovals: newMap };
        });
      },

      clearAllApprovals: () => {
        set({ sessionApprovals: new Map() });
      },
    }),
    { name: 'tool-approval-store' }
  )
);
