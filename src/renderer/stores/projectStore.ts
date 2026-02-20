import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Project, CreateProjectInput, UpdateProjectInput } from '../../types/database';

interface ProjectStore {
  projects: Project[];
  loading: boolean;
  error: string | null;

  loadProjects: () => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<Project | null>;
  updateProject: (input: UpdateProjectInput) => Promise<boolean>;
  deleteProject: (id: string) => Promise<boolean>;
}

export const useProjectStore = create<ProjectStore>()(
  devtools(
    (set) => ({
      projects: [],
      loading: false,
      error: null,

      loadProjects: async () => {
        set({ loading: true, error: null });
        const result = await window.levante.projects.list();
        if (result.success && result.data) {
          set({ projects: result.data, loading: false });
        } else {
          set({ error: result.error || 'Failed to load projects', loading: false });
        }
      },

      createProject: async (input) => {
        const result = await window.levante.projects.create(input);
        if (result.success && result.data) {
          set((state) => ({ projects: [result.data!, ...state.projects] }));
          return result.data;
        }
        return null;
      },

      updateProject: async (input) => {
        const result = await window.levante.projects.update(input);
        if (result.success && result.data) {
          set((state) => ({
            projects: state.projects.map((p) => (p.id === input.id ? result.data! : p)),
          }));
          return true;
        }
        return false;
      },

      deleteProject: async (id) => {
        const result = await window.levante.projects.delete(id);
        if (result.success) {
          set((state) => ({ projects: state.projects.filter((p) => p.id !== id) }));
          return true;
        }
        return false;
      },
    }),
    { name: 'project-store' }
  )
);
