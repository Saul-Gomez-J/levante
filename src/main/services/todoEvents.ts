let notifyImpl: ((sessionId: string) => void) | null = null;

export function setTodoNotifier(fn: (sessionId: string) => void) {
  notifyImpl = fn;
}

export function notifyTodosUpdated(sessionId: string) {
  notifyImpl?.(sessionId);
}
