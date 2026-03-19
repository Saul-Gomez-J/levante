import { ipcMain } from 'electron';
import { getLogger } from '../services/logging';
import { compactionService, type CompactInput } from '../services/compactionService';

const logger = getLogger();

export function setupCompactionHandlers(): void {
  ipcMain.removeHandler('levante/compaction/compact');
  ipcMain.handle('levante/compaction/compact', async (_, input: CompactInput) => {
    return await compactionService.compact(input);
  });

  logger.ipc.info('Compaction IPC handlers registered');
}
