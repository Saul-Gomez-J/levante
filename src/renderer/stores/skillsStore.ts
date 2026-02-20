import { create } from 'zustand';
import type {
  SkillDescriptor,
  SkillCategory,
  InstalledSkill,
} from '../../types/skills';

interface SkillsStore {
  catalog: SkillDescriptor[];
  categories: SkillCategory[];
  installedSkills: InstalledSkill[];
  installedIds: Set<string>;
  isLoadingCatalog: boolean;
  isLoadingInstalled: boolean;
  error: string | null;

  loadCatalog: () => Promise<void>;
  loadCategories: () => Promise<void>;
  loadInstalled: () => Promise<void>;
  installSkill: (skill: SkillDescriptor) => Promise<void>;
  uninstallSkill: (skillId: string) => Promise<void>;
  isInstalled: (skillId: string) => boolean;
  clearError: () => void;
}

export const useSkillsStore = create<SkillsStore>((set, get) => ({
  catalog: [],
  categories: [],
  installedSkills: [],
  installedIds: new Set(),
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

  loadInstalled: async () => {
    set({ isLoadingInstalled: true, error: null });

    try {
      const result = await window.levante.skills.listInstalled();
      if (!result.success) {
        throw new Error(result.error);
      }

      const installed = result.data;
      set({
        installedSkills: installed,
        installedIds: new Set(installed.map((item) => item.id)),
        isLoadingInstalled: false,
      });
    } catch (error) {
      set({
        isLoadingInstalled: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  installSkill: async (skill: SkillDescriptor) => {
    const result = await window.levante.skills.install(skill);
    if (!result.success) {
      throw new Error(result.error);
    }

    const installed = result.data;

    set((state) => {
      const already = state.installedSkills.some((s) => s.id === installed.id);
      const nextList = already
        ? state.installedSkills.map((s) => (s.id === installed.id ? installed : s))
        : [...state.installedSkills, installed];

      return {
        installedSkills: nextList,
        installedIds: new Set(nextList.map((s) => s.id)),
      };
    });
  },

  uninstallSkill: async (skillId: string) => {
    const result = await window.levante.skills.uninstall(skillId);
    if (!result.success) {
      throw new Error(result.error);
    }

    set((state) => {
      const nextList = state.installedSkills.filter((s) => s.id !== skillId);
      return {
        installedSkills: nextList,
        installedIds: new Set(nextList.map((s) => s.id)),
      };
    });
  },

  isInstalled: (skillId: string) => get().installedIds.has(skillId),
}));
