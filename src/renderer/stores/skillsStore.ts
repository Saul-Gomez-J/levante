import { create } from 'zustand';
import type {
  SkillDescriptor,
  SkillCategory,
  InstalledSkill,
  SkillScope,
  InstallSkillOptions,
  UninstallSkillOptions,
  ListInstalledSkillsOptions,
} from '../../types/skills';

function buildScopedKey(scope: SkillScope, skillId: string, projectId?: string): string {
  return `${scope}:${scope === 'project' ? projectId ?? 'unknown' : 'global'}:${skillId}`;
}

interface SkillsStore {
  catalog: SkillDescriptor[];
  categories: SkillCategory[];
  installedSkills: InstalledSkill[];
  installedScopedKeys: Set<string>;
  isLoadingCatalog: boolean;
  isLoadingInstalled: boolean;
  error: string | null;

  loadCatalog: () => Promise<void>;
  loadCategories: () => Promise<void>;
  loadInstalled: (options?: ListInstalledSkillsOptions) => Promise<void>;
  loadInstalledForChat: (projectId?: string | null) => Promise<void>;
  installSkill: (skill: SkillDescriptor, options?: InstallSkillOptions) => Promise<void>;
  uninstallSkill: (skillId: string, options: UninstallSkillOptions) => Promise<void>;
  installFromZip: (zipPath: string, options?: InstallSkillOptions) => Promise<InstalledSkill>;
  installFromZipBuffer: (buffer: ArrayBuffer, fileName: string, options?: InstallSkillOptions) => Promise<InstalledSkill>;
  selectZipFile: () => Promise<string | null>;
  toggleUserInvocable: (skill: InstalledSkill, enabled: boolean) => Promise<void>;

  // Legacy compatibility: checks if installed globally
  isInstalled: (skillId: string) => boolean;

  // New scope-aware selectors
  getInstalledBySkillId: (skillId: string) => InstalledSkill[];
  isInstalledAnywhere: (skillId: string) => boolean;
  isInstalledInScope: (skillId: string, scope: SkillScope, projectId?: string) => boolean;

  clearError: () => void;
}

export const useSkillsStore = create<SkillsStore>((set, get) => ({
  catalog: [],
  categories: [],
  installedSkills: [],
  installedScopedKeys: new Set(),
  isLoadingCatalog: false,
  isLoadingInstalled: false,
  error: null,

  clearError: () => set({ error: null }),

  loadCatalog: async () => {
    set({ isLoadingCatalog: true, error: null });

    try {
      const result = await window.levante.skills.getCatalog();
      if (!result.success) {
        throw new Error(result.error);
      }

      set({
        catalog: result.data.skills,
        isLoadingCatalog: false,
      });
    } catch (error) {
      set({
        isLoadingCatalog: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  loadCategories: async () => {
    try {
      const result = await window.levante.skills.getCategories();
      if (!result.success) {
        throw new Error(result.error);
      }

      set({ categories: result.data.categories });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  loadInstalled: async (options?: ListInstalledSkillsOptions) => {
    set({ isLoadingInstalled: true, error: null });

    try {
      const result = await window.levante.skills.listInstalled(options);
      if (!result.success) {
        throw new Error(result.error);
      }

      const installed = result.data;
      set({
        installedSkills: installed,
        installedScopedKeys: new Set(installed.map((item) => item.scopedKey)),
        isLoadingInstalled: false,
      });
    } catch (error) {
      set({
        isLoadingInstalled: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  loadInstalledForChat: async (projectId?: string | null) => {
    if (projectId) {
      await get().loadInstalled({ mode: 'project-merged', projectId });
      return;
    }
    await get().loadInstalled({ mode: 'global' });
  },

  installFromZip: async (zipPath: string, options?: InstallSkillOptions) => {
    const result = await window.levante.skills.installFromZip(zipPath, options);
    if (!result.success) {
      throw new Error(result.error);
    }

    const installed = result.data;

    set((state) => {
      const already = state.installedSkills.some((s) => s.scopedKey === installed.scopedKey);
      const nextList = already
        ? state.installedSkills.map((s) => (s.scopedKey === installed.scopedKey ? installed : s))
        : [...state.installedSkills, installed];

      return {
        installedSkills: nextList,
        installedScopedKeys: new Set(nextList.map((s) => s.scopedKey)),
      };
    });

    return installed;
  },

  installFromZipBuffer: async (buffer: ArrayBuffer, fileName: string, options?: InstallSkillOptions) => {
    const result = await window.levante.skills.installFromZipBuffer(buffer, fileName, options);
    if (!result.success) {
      throw new Error(result.error);
    }

    const installed = result.data;

    set((state) => {
      const already = state.installedSkills.some((s) => s.scopedKey === installed.scopedKey);
      const nextList = already
        ? state.installedSkills.map((s) => (s.scopedKey === installed.scopedKey ? installed : s))
        : [...state.installedSkills, installed];

      return {
        installedSkills: nextList,
        installedScopedKeys: new Set(nextList.map((s) => s.scopedKey)),
      };
    });

    return installed;
  },

  selectZipFile: async () => {
    const result = await window.levante.skills.selectZipFile();
    if (!result.success) {
      throw new Error(result.error);
    }

    return result.data;
  },

  toggleUserInvocable: async (skill: InstalledSkill, enabled: boolean) => {
    const previous = get().installedSkills.find((s) => s.scopedKey === skill.scopedKey);
    if (!previous) return;

    // Optimistic update
    set((state) => ({
      installedSkills: state.installedSkills.map((s) =>
        s.scopedKey === skill.scopedKey ? { ...s, userInvocable: enabled } : s
      ),
    }));

    try {
      const result = await window.levante.skills.setUserInvocable(skill.id, enabled, {
        scope: skill.scope,
        projectId: skill.projectId,
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      const updated = result.data;
      set((state) => ({
        installedSkills: state.installedSkills.map((s) =>
          s.scopedKey === skill.scopedKey ? updated : s
        ),
      }));
    } catch (error) {
      // Rollback
      set((state) => ({
        installedSkills: state.installedSkills.map((s) =>
          s.scopedKey === skill.scopedKey ? previous : s
        ),
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },

  installSkill: async (skill: SkillDescriptor, options?: InstallSkillOptions) => {
    // Descargar el bundle completo (incluye todos los archivos compañeros)
    const bundleResult = await window.levante.skills.getBundle(skill.id);
    if (!bundleResult.success) {
      throw new Error(bundleResult.error);
    }

    const result = await window.levante.skills.install(bundleResult.data, options);
    if (!result.success) {
      throw new Error(result.error);
    }

    const installed = result.data;

    set((state) => {
      // Upsert por scopedKey (no por id)
      const already = state.installedSkills.some((s) => s.scopedKey === installed.scopedKey);
      const nextList = already
        ? state.installedSkills.map((s) => (s.scopedKey === installed.scopedKey ? installed : s))
        : [...state.installedSkills, installed];

      return {
        installedSkills: nextList,
        installedScopedKeys: new Set(nextList.map((s) => s.scopedKey)),
      };
    });
  },

  uninstallSkill: async (skillId: string, options: UninstallSkillOptions) => {
    const result = await window.levante.skills.uninstall(skillId, options);
    if (!result.success) {
      throw new Error(result.error);
    }

    const targetKey = buildScopedKey(options.scope, skillId, options.projectId);

    set((state) => {
      const nextList = state.installedSkills.filter((s) => s.scopedKey !== targetKey);
      return {
        installedSkills: nextList,
        installedScopedKeys: new Set(nextList.map((s) => s.scopedKey)),
      };
    });
  },

  // Legacy: check global installation only (for backwards compatibility)
  isInstalled: (skillId: string) => {
    const globalKey = buildScopedKey('global', skillId);
    return get().installedScopedKeys.has(globalKey);
  },

  getInstalledBySkillId: (skillId: string) => {
    return get().installedSkills.filter((s) => s.id === skillId);
  },

  isInstalledAnywhere: (skillId: string) => {
    return get().installedSkills.some((s) => s.id === skillId);
  },

  isInstalledInScope: (skillId: string, scope: SkillScope, projectId?: string) => {
    const key = buildScopedKey(scope, skillId, projectId);
    return get().installedScopedKeys.has(key);
  },
}));
