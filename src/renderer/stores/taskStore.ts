/**
 * Task store for Background Tasks dropdown.
 *
 * IMPORTANT: tasks API returns IPCResult<T> envelopes.
 */

import { create } from 'zustand';

export type TaskStatus = 'running' | 'completed' | 'failed' | 'killed';

export interface TaskInfoDTO {
  id: string;
  command: string;
  description?: string;
  status: TaskStatus;
  pid: number | null;
  cwd: string;
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  timedOut: boolean;
  interrupted: boolean;
}

export interface TaskStatsDTO {
  total: number;
  running: number;
  completed: number;
  failed: number;
  killed: number;
}

type IPCResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

function unwrapResult<T>(result: IPCResult<T>, fallbackMessage: string): T {
  if (!result.success) {
    throw new Error(result.error || fallbackMessage);
  }

  if (result.data === undefined) {
    throw new Error(result.error || fallbackMessage);
  }

  return result.data;
}

interface TaskStoreState {
  tasks: TaskInfoDTO[];
  stats: TaskStatsDTO;
  selectedTaskId: string | null;
  selectedTaskOutput: string | null;
  loading: boolean;
  error: string | null;

  fetchTasks: () => Promise<void>;
  fetchStats: () => Promise<void>;
  killTask: (taskId: string) => Promise<boolean>;
  loadOutput: (taskId: string, tail?: number) => Promise<void>;
  cleanup: (maxAgeMs?: number) => Promise<number>;
  selectTask: (taskId: string | null) => void;
  clearError: () => void;
}

export const useTaskStore = create<TaskStoreState>((set, get) => ({
  tasks: [],
  stats: {
    total: 0,
    running: 0,
    completed: 0,
    failed: 0,
    killed: 0,
  },
  selectedTaskId: null,
  selectedTaskOutput: null,
  loading: false,
  error: null,

  fetchTasks: async () => {
    set({ loading: true, error: null });

    try {
      const [tasksResult, statsResult] = await Promise.all([
        window.levante.tasks.list(),
        window.levante.tasks.stats(),
      ]);

      const tasks = unwrapResult<TaskInfoDTO[]>(
        tasksResult,
        'Failed to fetch background tasks'
      );

      const stats = unwrapResult<TaskStatsDTO>(
        statsResult,
        'Failed to fetch background tasks stats'
      );

      const selectedTaskId = get().selectedTaskId;
      const selectedStillExists =
        selectedTaskId === null || tasks.some((task) => task.id === selectedTaskId);

      set({
        tasks,
        stats,
        loading: false,
        ...(selectedStillExists
          ? {}
          : { selectedTaskId: null, selectedTaskOutput: null }),
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch tasks',
      });
    }
  },

  fetchStats: async () => {
    try {
      const statsResult = await window.levante.tasks.stats();
      const stats = unwrapResult<TaskStatsDTO>(
        statsResult,
        'Failed to fetch background tasks stats'
      );

      set({ stats });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch tasks stats',
      });
    }
  },

  killTask: async (taskId: string) => {
    try {
      const killResult = await window.levante.tasks.kill(taskId);
      const killed = unwrapResult<boolean>(killResult, 'Failed to kill task');

      if (!killed) {
        set({ error: `Task could not be killed: ${taskId}` });
        return false;
      }

      await get().fetchTasks();

      if (get().selectedTaskId === taskId) {
        await get().loadOutput(taskId, 100);
      }

      return true;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to kill task',
      });
      return false;
    }
  },

  loadOutput: async (taskId: string, tail?: number) => {
    try {
      const outputResult = await window.levante.tasks.getOutput(taskId, {
        ...(tail !== undefined ? { tail } : {}),
      });

      const output = unwrapResult<string>(
        outputResult,
        'Failed to load task output'
      );

      set({
        selectedTaskId: taskId,
        selectedTaskOutput: output,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load task output',
      });
    }
  },

  cleanup: async (maxAgeMs?: number) => {
    try {
      const cleanupResult = await window.levante.tasks.cleanup(maxAgeMs);
      const removedCount = unwrapResult<number>(
        cleanupResult,
        'Failed to cleanup tasks'
      );

      await get().fetchTasks();
      return removedCount;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to cleanup tasks',
      });
      return 0;
    }
  },

  selectTask: (taskId: string | null) => {
    set({
      selectedTaskId: taskId,
      selectedTaskOutput: taskId === null ? null : get().selectedTaskOutput,
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));
