import { ipcMain } from 'electron';
import { getLogger } from '../services/logging';
import { skillsService } from '../services/skillsService';
import type { SkillDescriptor } from '../../types/skills';

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

export function setupSkillsHandlers(): void {
  ipcMain.removeHandler('levante/skills:getCatalog');
  ipcMain.handle('levante/skills:getCatalog', async () => {
    try {
      const data = await skillsService.getCatalog();
      return ok(data);
    } catch (error) {
      logger.ipc.error('Failed to fetch skills catalog', {
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(error);
    }
  });

  ipcMain.removeHandler('levante/skills:getCategories');
  ipcMain.handle('levante/skills:getCategories', async () => {
    try {
      const data = await skillsService.getCategories();
      return ok(data);
    } catch (error) {
      logger.ipc.error('Failed to fetch skills categories', {
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(error);
    }
  });

  ipcMain.removeHandler('levante/skills:install');
  ipcMain.handle('levante/skills:install', async (_, skill: SkillDescriptor) => {
    try {
      const installed = await skillsService.installSkill(skill);
      return ok(installed);
    } catch (error) {
      logger.ipc.error('Failed to install skill', {
        skillId: skill?.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(error);
    }
  });

  ipcMain.removeHandler('levante/skills:uninstall');
  ipcMain.handle('levante/skills:uninstall', async (_, skillId: string) => {
    try {
      await skillsService.uninstallSkill(skillId);
      return ok(true);
    } catch (error) {
      logger.ipc.error('Failed to uninstall skill', {
        skillId,
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(error);
    }
  });

  ipcMain.removeHandler('levante/skills:listInstalled');
  ipcMain.handle('levante/skills:listInstalled', async () => {
    try {
      const data = await skillsService.listInstalledSkills();
      return ok(data);
    } catch (error) {
      logger.ipc.error('Failed to list installed skills', {
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(error);
    }
  });

  ipcMain.removeHandler('levante/skills:isInstalled');
  ipcMain.handle('levante/skills:isInstalled', async (_, skillId: string) => {
    try {
      const data = await skillsService.isInstalled(skillId);
      return ok(data);
    } catch (error) {
      logger.ipc.error('Failed to check if skill is installed', {
        skillId,
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(error);
    }
  });

  logger.ipc.info('Skills IPC handlers registered');
}
