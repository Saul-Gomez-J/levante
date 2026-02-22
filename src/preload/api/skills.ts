import { ipcRenderer } from 'electron';
import type {
  SkillBundleResponse,
  SkillsCatalogResponse,
  SkillCategory,
  InstalledSkill,
  IPCResult,
  InstallSkillOptions,
  UninstallSkillOptions,
  ListInstalledSkillsOptions,
} from '../../types/skills';

export const skillsApi = {
  getCatalog: (): Promise<IPCResult<SkillsCatalogResponse>> =>
    ipcRenderer.invoke('levante/skills:getCatalog'),

  getCategories: (): Promise<IPCResult<{ categories: SkillCategory[] }>> =>
    ipcRenderer.invoke('levante/skills:getCategories'),

  getBundle: (skillId: string): Promise<IPCResult<SkillBundleResponse>> =>
    ipcRenderer.invoke('levante/skills:getBundle', skillId),

  install: (bundle: SkillBundleResponse, options?: InstallSkillOptions): Promise<IPCResult<InstalledSkill>> =>
    ipcRenderer.invoke('levante/skills:install', { bundle, options }),

  uninstall: (skillId: string, options: UninstallSkillOptions): Promise<IPCResult<boolean>> =>
    ipcRenderer.invoke('levante/skills:uninstall', { skillId, options }),

  listInstalled: (options?: ListInstalledSkillsOptions): Promise<IPCResult<InstalledSkill[]>> =>
    ipcRenderer.invoke('levante/skills:listInstalled', { options }),

  isInstalled: (skillId: string): Promise<IPCResult<boolean>> =>
    ipcRenderer.invoke('levante/skills:isInstalled', skillId),
};
