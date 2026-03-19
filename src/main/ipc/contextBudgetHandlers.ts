import { ipcMain } from 'electron';
import { getLogger } from '../services/logging';
import {
  contextBudgetService,
  type ContextBudgetEstimateInput,
} from '../services/contextBudgetService';

const logger = getLogger();

export function setupContextBudgetHandlers(): void {
  ipcMain.removeHandler('levante/context-budget/estimate');
  ipcMain.handle(
    'levante/context-budget/estimate',
    async (_, input: ContextBudgetEstimateInput) => {
      try {
        const estimate = await contextBudgetService.estimate(input);
        return { success: true, data: estimate };
      } catch (error) {
        logger.ipc.error('context-budget/estimate failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  logger.ipc.info('Context budget IPC handlers registered');
}
