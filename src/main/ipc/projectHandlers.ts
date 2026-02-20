import { ipcMain } from 'electron';
import { projectService } from '../services/projectService';
import { CreateProjectInput, UpdateProjectInput } from '../../types/database';
import { getLogger } from '../services/logging';

const logger = getLogger();

export function setupProjectHandlers(): void {
  ipcMain.removeHandler('levante/projects/create');
  ipcMain.handle('levante/projects/create', async (_, input: CreateProjectInput) => {
    return await projectService.createProject(input);
  });

  ipcMain.removeHandler('levante/projects/get');
  ipcMain.handle('levante/projects/get', async (_, id: string) => {
    return await projectService.getProject(id);
  });

  ipcMain.removeHandler('levante/projects/list');
  ipcMain.handle('levante/projects/list', async () => {
    return await projectService.listProjects();
  });

  ipcMain.removeHandler('levante/projects/update');
  ipcMain.handle('levante/projects/update', async (_, input: UpdateProjectInput) => {
    return await projectService.updateProject(input);
  });

  ipcMain.removeHandler('levante/projects/delete');
  ipcMain.handle('levante/projects/delete', async (_, id: string) => {
    return await projectService.deleteProject(id);
  });

  ipcMain.removeHandler('levante/projects/sessions');
  ipcMain.handle('levante/projects/sessions', async (_, projectId: string) => {
    return await projectService.getProjectSessions(projectId);
  });

  logger.ipc.info('Project IPC handlers registered');
}
