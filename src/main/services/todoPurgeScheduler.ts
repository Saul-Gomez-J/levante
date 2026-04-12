import { todoService } from './todoService';
import { notifyTodosUpdated } from './todoEvents';
import { getLogger } from './logging';

const logger = getLogger();
const PURGE_DELAY_MS = 2000;

class TodoPurgeScheduler {
  private timers = new Map<string, NodeJS.Timeout>();

  schedulePurge(todoId: string, sessionId: string, delayMs = PURGE_DELAY_MS): void {
    this.cancelPurge(todoId);

    const timer = setTimeout(async () => {
      this.timers.delete(todoId);
      try {
        const deleted = await todoService.purgeIfCompleted(todoId, sessionId);
        if (deleted) {
          notifyTodosUpdated(sessionId);
          logger.database.debug('Purged completed todo', { todoId, sessionId });
        }
      } catch (error) {
        logger.database.debug('Purge failed', {
          todoId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, delayMs);

    this.timers.set(todoId, timer);
  }

  cancelPurge(todoId: string): void {
    const existing = this.timers.get(todoId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(todoId);
    }
  }

  cancelAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

export const todoPurgeScheduler = new TodoPurgeScheduler();
