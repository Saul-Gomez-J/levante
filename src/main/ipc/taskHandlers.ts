/**
 * Task Handlers
 *
 * IPC handlers for background task management.
 */

import { ipcMain } from 'electron';
import { getLogger } from '../services/logging';
import { taskManager, TaskStatus, GetOutputOptions, WaitTaskOptions } from '../services/tasks';

const logger = getLogger();

function ok<T>(data: T) {
  return { success: true as const, data };
}

function fail(error: unknown) {
  return {
    success: false as const,
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Setup all task-related IPC handlers
 */
export function setupTaskHandlers(): void {
  // List tasks
  ipcMain.removeHandler('levante/tasks:list');
  ipcMain.handle('levante/tasks:list', async (_, filter?: { status?: TaskStatus }) => {
    try {
      const tasks = taskManager.list(filter);
      return ok(taskManager.toDTOList(tasks));
    } catch (error) {
      logger.ipc.error('Failed to list background tasks', { error: String(error) });
      return fail(error);
    }
  });

  // Get single task
  ipcMain.removeHandler('levante/tasks:get');
  ipcMain.handle('levante/tasks:get', async (_, taskId: string) => {
    try {
      if (!taskId || typeof taskId !== 'string') {
        return fail('Invalid taskId');
      }

      const info = taskManager.getStatus(taskId);
      if (!info) {
        return ok(null);
      }

      return ok(taskManager.toDTO(info));
    } catch (error) {
      logger.ipc.error('Failed to get background task', { error: String(error), taskId });
      return fail(error);
    }
  });

  // Get task output
  ipcMain.removeHandler('levante/tasks:getOutput');
  ipcMain.handle(
    'levante/tasks:getOutput',
    async (_, taskId: string, options?: GetOutputOptions) => {
      try {
        if (!taskId || typeof taskId !== 'string') {
          return fail('Invalid taskId');
        }

        // Validate tail option
        if (options?.tail !== undefined && (typeof options.tail !== 'number' || options.tail <= 0)) {
          return fail('tail must be a positive number');
        }

        const output = taskManager.getOutput(taskId, options);
        if (output === null) {
          return fail(`Task not found: ${taskId}`);
        }

        return ok(output);
      } catch (error) {
        logger.ipc.error('Failed to get task output', { error: String(error), taskId });
        return fail(error);
      }
    }
  );

  // Wait for task
  ipcMain.removeHandler('levante/tasks:wait');
  ipcMain.handle(
    'levante/tasks:wait',
    async (_, taskId: string, options?: WaitTaskOptions) => {
      try {
        if (!taskId || typeof taskId !== 'string') {
          return fail('Invalid taskId');
        }

        // Validate timeout option
        const timeoutMs = options?.timeoutMs ?? 30000;
        if (typeof timeoutMs !== 'number' || timeoutMs <= 0) {
          return fail('timeoutMs must be a positive number');
        }

        const info = await taskManager.wait(taskId, timeoutMs);
        return ok(taskManager.toDTO(info));
      } catch (error) {
        logger.ipc.error('Failed to wait for task', { error: String(error), taskId });
        return fail(error);
      }
    }
  );

  // Kill task
  ipcMain.removeHandler('levante/tasks:kill');
  ipcMain.handle('levante/tasks:kill', async (_, taskId: string) => {
    try {
      if (!taskId || typeof taskId !== 'string') {
        return fail('Invalid taskId');
      }

      const result = taskManager.kill(taskId);
      return ok(result);
    } catch (error) {
      logger.ipc.error('Failed to kill task', { error: String(error), taskId });
      return fail(error);
    }
  });

  // Get statistics
  ipcMain.removeHandler('levante/tasks:stats');
  ipcMain.handle('levante/tasks:stats', async () => {
    try {
      const stats = taskManager.getStatistics();
      return ok(stats);
    } catch (error) {
      logger.ipc.error('Failed to get task stats', { error: String(error) });
      return fail(error);
    }
  });

  // Cleanup old tasks
  ipcMain.removeHandler('levante/tasks:cleanup');
  ipcMain.handle('levante/tasks:cleanup', async (_, maxAgeMs?: number) => {
    try {
      // Validate maxAgeMs
      if (maxAgeMs !== undefined && (typeof maxAgeMs !== 'number' || maxAgeMs <= 0)) {
        return fail('maxAgeMs must be a positive number');
      }

      const count = taskManager.cleanup(maxAgeMs);
      return ok(count);
    } catch (error) {
      logger.ipc.error('Failed to cleanup tasks', { error: String(error) });
      return fail(error);
    }
  });

  logger.ipc.info('Task handlers registered');
}
