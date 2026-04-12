import { useEffect } from 'react';
import { useTodoStore } from '../stores/todoStore';

export function useTodoSync(sessionId: string | null) {
  const fetchTodos = useTodoStore((s) => s.fetchTodos);
  const setCurrentSession = useTodoStore((s) => s.setCurrentSession);
  const reset = useTodoStore((s) => s.reset);

  useEffect(() => {
    if (!sessionId) {
      reset();
      return;
    }

    setCurrentSession(sessionId);
    void fetchTodos(sessionId);

    const unsubscribe = window.levante.todos.onUpdated((data) => {
      if (data.sessionId === sessionId) {
        void fetchTodos(sessionId);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [sessionId, fetchTodos, setCurrentSession, reset]);
}
