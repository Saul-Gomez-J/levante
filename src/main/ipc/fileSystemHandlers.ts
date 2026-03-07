/**
 * FileSystem IPC Handlers
 *
 * Exposes read-only filesystem operations to renderer.
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
} as const;

export function setupFileSystemHandlers(_getMainWindow: () => BrowserWindow | null): void {
  for (const channel of Object.values(CHANNELS)) {
    ipcMain.removeHandler(channel);
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

  logger.ipc.info('FileSystem handlers registered successfully');
}
