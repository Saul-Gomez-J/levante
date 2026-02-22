import { ipcMain } from 'electron';
import { getLogger } from '../services/logging';
import { skillsService } from '../services/skillsService';
import type {
  SkillBundleResponse,
  InstallSkillOptions,
  UninstallSkillOptions,
  ListInstalledSkillsOptions,
} from '../../types/skills';

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

  ipcMain.removeHandler('levante/skills:getBundle');
  ipcMain.handle('levante/skills:getBundle', async (_, skillId: string) => {
    try {
      const data = await skillsService.getBundle(skillId);
      return ok(data);
    } catch (error) {
      logger.ipc.error('Failed to fetch skill bundle', {
        skillId,
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(error);
    }
  });

  ipcMain.removeHandler('levante/skills:install');
  ipcMain.handle('levante/skills:install', async (_, payload: {
    bundle: SkillBundleResponse;
    options?: InstallSkillOptions;
  }) => {
    if (!payload?.bundle?.id) {
      return fail(new Error('Invalid install payload: bundle.id is required'));
    }
    try {
      const installed = await skillsService.installSkill(payload.bundle, payload.options);
      return ok(installed);
    } catch (error) {
      logger.ipc.error('Failed to install skill', {
        skillId: payload?.bundle?.id,
        scope: payload?.options?.scope,
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(error);
    }
  });

  ipcMain.removeHandler('levante/skills:uninstall');
  ipcMain.handle('levante/skills:uninstall', async (_, payload: {
    skillId: string;
    options: UninstallSkillOptions;
  }) => {
    if (!payload?.skillId) {
      return fail(new Error('Invalid uninstall payload: skillId is required'));
    }
    if (!payload?.options?.scope) {
      return fail(new Error('Invalid uninstall payload: options.scope is required'));
    }
    try {
      await skillsService.uninstallSkill(payload.skillId, payload.options);
      return ok(true);
    } catch (error) {
      logger.ipc.error('Failed to uninstall skill', {
        skillId: payload?.skillId,
        scope: payload?.options?.scope,
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(error);
    }
  });

  ipcMain.removeHandler('levante/skills:listInstalled');
  ipcMain.handle('levante/skills:listInstalled', async (_, payload?: {
    options?: ListInstalledSkillsOptions;
  }) => {
    const options = payload?.options ?? {};

    // Validate mode + projectId combination
    if (options.mode === 'project-merged' && !options.projectId) {
      return fail(new Error('projectId is required when mode is "project-merged"'));
    }

    try {
      const data = await skillsService.listInstalledSkills(options);
      return ok(data);
    } catch (error) {
      logger.ipc.error('Failed to list installed skills', {
        mode: options.mode,
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
