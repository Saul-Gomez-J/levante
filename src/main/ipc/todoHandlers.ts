import { ipcMain, BrowserWindow } from 'electron';
import { todoService } from '../services/todoService';
import { setTodoNotifier } from '../services/todoEvents';
import { getLogger } from '../services/logging';

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

export function setupTodoHandlers(getMainWindow: () => BrowserWindow | null): void {
  setTodoNotifier((sessionId: string) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return;
    }
    win.webContents.send('levante/todos:updated', { sessionId });
  });

  ipcMain.removeHandler('levante/todos:list');
  ipcMain.handle('levante/todos:list', async (_, sessionId: string) => {
    try {
      if (!sessionId || typeof sessionId !== 'string') {
        return fail('Invalid sessionId');
      }
      return ok(await todoService.list(sessionId));
    } catch (error) {
      logger.ipc.error('Failed to list todos', { error: String(error), sessionId });
      return fail(error);
    }
  });

  logger.ipc.info('Todo handlers registered');
}
