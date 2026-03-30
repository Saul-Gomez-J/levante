/**
 * FileSystem IPC Handlers
 *
 * Exposes read-only filesystem operations to renderer.
 * Includes file watching with push notifications.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { getLogger } from '../services/logging';
import { fileSystemService } from '../services/filesystem';
import type { ReadDirOptions, ReadFileOptions } from '../services/filesystem';

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

const CHANNELS = {
  SET_WORKING_DIR: 'levante/fs:setWorkingDir',
  GET_WORKING_DIR: 'levante/fs:getWorkingDir',
  READ_DIR: 'levante/fs:readDir',
  READ_FILE: 'levante/fs:readFile',
  SEARCH_FILES: 'levante/fs:searchFiles',
  START_WATCHING: 'levante/fs:startWatching',
  STOP_WATCHING: 'levante/fs:stopWatching',
  FILES_CHANGED: 'levante/fs:filesChanged',
} as const;

export function setupFileSystemHandlers(getMainWindow: () => BrowserWindow | null): void {
  for (const channel of Object.values(CHANNELS)) {
    if (channel !== CHANNELS.FILES_CHANGED) {
      ipcMain.removeHandler(channel);
    }
  }

  ipcMain.handle(CHANNELS.SET_WORKING_DIR, async (_, args: { path: string }) => {
    try {
      fileSystemService.setWorkingDirectory(args.path);
      return ok(undefined);
    } catch (error) {
      logger.ipc.error('fs:setWorkingDir failed', {
        path: args.path,
        error: error instanceof Error ? error.message : error,
      });
      return fail(error);
    }
  });

  ipcMain.handle(CHANNELS.GET_WORKING_DIR, async () => {
    try {
      return ok(fileSystemService.getWorkingDirectory());
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(
    CHANNELS.READ_DIR,
    async (_, args: { path: string; options?: ReadDirOptions }) => {
      try {
        const entries = await fileSystemService.readDirectory(args.path, args.options);
        return ok(entries);
      } catch (error) {
        logger.ipc.error('fs:readDir failed', {
          path: args.path,
          error: error instanceof Error ? error.message : error,
        });
        return fail(error);
      }
    }
  );

  ipcMain.handle(
    CHANNELS.READ_FILE,
    async (_, args: { path: string; options?: ReadFileOptions }) => {
      try {
        const content = await fileSystemService.readFile(args.path, args.options);
        return ok(content);
      } catch (error) {
        logger.ipc.error('fs:readFile failed', {
          path: args.path,
          error: error instanceof Error ? error.message : error,
        });
        return fail(error);
      }
    }
  );

  ipcMain.handle(
    CHANNELS.SEARCH_FILES,
    async (_, args: { query: string; maxResults?: number; maxDepth?: number }) => {
      try {
        const data = await fileSystemService.searchFiles(args.query, {
          maxResults: args.maxResults,
          maxDepth: args.maxDepth,
        });
        return ok(data);
      } catch (error) {
        logger.ipc.error('fs:searchFiles failed', {
          query: args.query,
          error: error instanceof Error ? error.message : error,
        });
        return fail(error);
      }
    }
  );

  ipcMain.handle(CHANNELS.START_WATCHING, async () => {
    try {
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        return fail(new Error('Main window not available'));
      }

      await fileSystemService.startWatching((changes) => {
        const win = getMainWindow();
        const rootPath = fileSystemService.getWorkingDirectory();

        if (!win || win.isDestroyed() || !rootPath || changes.length === 0) {
          return;
        }

        win.webContents.send(CHANNELS.FILES_CHANGED, {
          rootPath,
          changes,
        });
      });

      return ok(undefined);
    } catch (error) {
      logger.ipc.error('fs:startWatching failed', {
        error: error instanceof Error ? error.message : error,
      });
      return fail(error);
    }
  });

  ipcMain.handle(CHANNELS.STOP_WATCHING, async () => {
    try {
      await fileSystemService.stopWatching();
      return ok(undefined);
    } catch (error) {
      logger.ipc.error('fs:stopWatching failed', {
        error: error instanceof Error ? error.message : error,
      });
      return fail(error);
    }
  });

  logger.ipc.info('FileSystem handlers registered successfully');
}

export async function cleanupFileSystemHandlers(): Promise<void> {
  await fileSystemService.dispose();
  logger.ipc.info('FileSystem handlers cleaned up');
}
