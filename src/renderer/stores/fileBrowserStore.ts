/**
 * File Browser Store
 *
 * Holds sidebar file tree state for Fase 1.
 */

import { create } from 'zustand';

export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  extension: string;
  modifiedAt: number;
  isHidden: boolean;
}

interface FileBrowserState {
  workingDirectory: string | null;
  entries: Map<string, DirectoryEntry[]>;
  expandedDirs: Set<string>;

  isLoadingDir: string | null;
  error: string | null;
  showHiddenFiles: boolean;

  initialize: (cwd: string) => Promise<void>;
  loadDirectory: (dirPath: string) => Promise<void>;
  toggleDirectory: (dirPath: string) => void;
  refreshDirectory: (dirPath: string) => void;
  setShowHidden: (show: boolean) => void;
  clearError: () => void;
  reset: () => void;
}

export const useFileBrowserStore = create<FileBrowserState>((set, get) => ({
  workingDirectory: null,
  entries: new Map(),
  expandedDirs: new Set(),

  isLoadingDir: null,
  error: null,
  showHiddenFiles: false,

  initialize: async (cwd: string) => {
    if (!cwd?.trim()) {
      set({ error: 'Missing working directory' });
      return;
    }

    const state = get();
    if (state.workingDirectory === cwd && state.entries.has(cwd)) {
      return;
    }

    set({
      workingDirectory: cwd,
      entries: new Map(),
      expandedDirs: new Set(),
      error: null,
      isLoadingDir: null,
    });

    const setDirResult = await window.levante.fs.setWorkingDir(cwd);
    if (!setDirResult.success) {
      set({
        error: setDirResult.error ?? 'Failed to set working directory',
        isLoadingDir: null,
      });
      return;
    }

    await get().loadDirectory(cwd);
  },

  loadDirectory: async (dirPath: string) => {
    set({ isLoadingDir: dirPath, error: null });

    try {
      const result = await window.levante.fs.readDir(dirPath, {
        showHidden: get().showHiddenFiles,
        sortBy: 'type',
      });

      if (result.success && result.data) {
        const data = result.data;
        set((state) => {
          const nextEntries = new Map(state.entries);
          nextEntries.set(dirPath, data);
          return {
            entries: nextEntries,
            isLoadingDir: null,
          };
        });
      } else {
        set({
          error: result.error ?? 'Failed to read directory',
          isLoadingDir: null,
        });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoadingDir: null,
      });
    }
  },

  toggleDirectory: (dirPath: string) => {
    set((state) => {
      const nextExpanded = new Set(state.expandedDirs);

      if (nextExpanded.has(dirPath)) {
        nextExpanded.delete(dirPath);
      } else {
        nextExpanded.add(dirPath);
        if (!state.entries.has(dirPath)) {
          void get().loadDirectory(dirPath);
        }
      }

      return { expandedDirs: nextExpanded };
    });
  },

  refreshDirectory: (dirPath: string) => {
    set((state) => {
      const nextEntries = new Map(state.entries);
      nextEntries.delete(dirPath);
      return { entries: nextEntries };
    });

    void get().loadDirectory(dirPath);
  },

  setShowHidden: (show: boolean) => {
    set({ showHiddenFiles: show });

    const dirs = Array.from(get().entries.keys());
    set({ entries: new Map() });

    for (const dir of dirs) {
      void get().loadDirectory(dir);
    }
  },

  clearError: () => {
    set({ error: null });
  },

  reset: () => {
    set({
      workingDirectory: null,
      entries: new Map(),
      expandedDirs: new Set(),
      isLoadingDir: null,
      error: null,
      showHiddenFiles: false,
    });
  },
}));
