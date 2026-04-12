import { create } from 'zustand';
import type { TodoListResult } from '../../types/todos';

type IPCResult<T> = { success: boolean; data?: T; error?: string };

const initialCounts = { pending: 0, inProgress: 0, completed: 0, total: 0 };

function unwrapResult<T>(result: IPCResult<T>, fallback: string): T {
  if (!result.success || result.data === undefined) {
    throw new Error(result.error || fallback);
  }
  return result.data;
}

interface TodoStoreState {
  todos: TodoListResult['todos'];
  counts: TodoListResult['counts'];
  loading: boolean;
  error: string | null;
  expanded: boolean;
  currentSessionId: string | null;
  fetchTodos: (sessionId: string) => Promise<void>;
  setExpanded: (expanded: boolean) => void;
  setCurrentSession: (sessionId: string | null) => void;
  reset: () => void;
}

export const useTodoStore = create<TodoStoreState>((set) => ({
  todos: [],
  counts: initialCounts,
  loading: false,
  error: null,
  expanded: false,
  currentSessionId: null,

  fetchTodos: async (sessionId: string) => {
    set({ loading: true, error: null });
    try {
      const result = await window.levante.todos.list(sessionId);
      const data = unwrapResult<TodoListResult>(result, 'Failed to fetch todos');
      set({
        todos: data.todos,
        counts: data.counts,
        loading: false,
        expanded: data.counts.total > 0 ? true : false,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch todos',
      });
    }
  },

  setExpanded: (expanded) => set({ expanded }),
  setCurrentSession: (currentSessionId) => set({ currentSessionId }),
  reset: () =>
    set({
      todos: [],
      counts: initialCounts,
      loading: false,
      error: null,
      expanded: false,
      currentSessionId: null,
    }),
}));
