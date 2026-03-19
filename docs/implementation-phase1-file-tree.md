# Runbook Cerrado de Implementación - Fase 1 File Tree (Sidebar Izquierdo)

## 0) Regla de ejecución (obligatoria)
Este documento es una especificación cerrada. La IA implementadora debe:
- Implementar exactamente los archivos y cambios listados aquí.
- No inferir features fuera de este documento.
- No omitir líneas de código incluidas en este documento.

## 1) Objetivo funcional de Fase 1
Implementar un explorador de archivos en el sidebar izquierdo (tab `Files`) cuando Cowork mode está activo y hay CWD configurado.

Entregable de Fase 1:
- Sidebar con tabs `Chats` y `Files`.
- `Files` renderiza árbol de archivos del CWD.
- Click en archivo abre archivo en editor externo del sistema (`openExternal(file://...)`).
- Backend/IPC/preload para lectura de filesystem en modo read-only.

No entra en esta fase:
- Tabs de archivos en panel derecho.
- `sidePanelStore`.
- Watchers `watch/unwatch`.
- Preview markdown/código en panel derecho.

## 2) Lista exacta de archivos

### 2.1 Crear (10)
1. `src/main/services/filesystem/fileSystemService.ts`
2. `src/main/services/filesystem/index.ts`
3. `src/main/ipc/fileSystemHandlers.ts`
4. `src/preload/api/filesystem.ts`
5. `src/renderer/stores/fileBrowserStore.ts`
6. `src/renderer/components/chat/ChatListContent.tsx`
7. `src/renderer/components/sidebar/SidebarSections.tsx`
8. `src/renderer/components/file-browser/FileBrowserContent.tsx`
9. `src/renderer/components/file-browser/FileTreeNode.tsx`
10. `src/renderer/components/file-browser/index.ts`

### 2.2 Modificar (7)
1. `src/preload/preload.ts`
2. `src/main/lifecycle/initialization.ts`
3. `src/renderer/components/chat/ChatList.tsx`
4. `src/renderer/pages/ChatPage.tsx`
5. `src/renderer/App.tsx`
6. `src/renderer/locales/en/chat.json`
7. `src/renderer/locales/es/chat.json`

### 2.3 No modificar en Fase 1
- `src/renderer/components/chat/WebPreviewPanel.tsx`
- `src/renderer/stores/webPreviewStore.ts`

## 3) Preparación de carpetas
Ejecutar:

```bash
mkdir -p src/main/services/filesystem
mkdir -p src/renderer/components/file-browser
mkdir -p src/renderer/components/sidebar
```

## 4) Archivos nuevos - contenido completo

### 4.1 `src/main/services/filesystem/fileSystemService.ts`
```ts
/**
 * FileSystemService
 *
 * Read-only filesystem access for sidebar file tree.
 * Security: all paths are validated against working directory using realpath + relative.
 */

import fs from 'node:fs/promises';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { getLogger } from '../logging';

const logger = getLogger();

export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  extension: string;
  modifiedAt: number;
  isHidden: boolean;
}

export interface FileContent {
  path: string;
  content: string;
  encoding: string;
  size: number;
  language: string;
  isBinary: boolean;
  isTruncated: boolean;
}

export interface ReadDirOptions {
  showHidden?: boolean;
  sortBy?: 'name' | 'type' | 'modified';
}

export interface ReadFileOptions {
  maxSize?: number;
  encoding?: BufferEncoding;
}

const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp',
  'mp3', 'mp4', 'wav', 'avi', 'mov',
  'zip', 'tar', 'gz', 'rar', '7z',
  'exe', 'dll', 'so', 'dylib',
  'woff', 'woff2', 'ttf', 'eot',
  'sqlite', 'db',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
]);

const IGNORED_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', 'out',
  '.next', '.nuxt', '__pycache__', '.venv', 'venv',
  'env', '.tox', 'coverage', '.cache', '.turbo',
]);

const IGNORED_FILES = new Set([
  '.DS_Store', 'Thumbs.db', 'desktop.ini',
]);

const LANGUAGE_MAP: Record<string, string> = {
  // JavaScript/TypeScript
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  mjs: 'javascript',
  cjs: 'javascript',

  // Python
  py: 'python',
  pyw: 'python',
  pyi: 'python',

  // Web
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',

  // Data
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',

  // Markdown
  md: 'markdown',
  mdx: 'markdown',

  // Shell/config
  env: 'shell',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',

  // Other
  sql: 'sql',
  graphql: 'graphql',
  rs: 'rust',
  go: 'go',
  java: 'java',
  swift: 'swift',
  kt: 'kotlin',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  dockerfile: 'dockerfile',
};

class FileSystemService {
  private workingDirectory: string | null = null;

  setWorkingDirectory(dir: string): void {
    const resolved = path.resolve(dir);

    if (!existsSync(resolved)) {
      throw new Error('Working directory does not exist');
    }

    const real = realpathSync(resolved);
    const stats = statSync(real);

    if (!stats.isDirectory()) {
      throw new Error('Working directory must be a directory');
    }

    this.workingDirectory = real;
    logger.core.info('FileSystemService: working directory set', { dir: real });
  }

  getWorkingDirectory(): string | null {
    return this.workingDirectory;
  }

  async readDirectory(dirPath: string, options?: ReadDirOptions): Promise<DirectoryEntry[]> {
    const resolvedPath = this.validatePath(dirPath);
    const showHidden = options?.showHidden ?? false;
    const sortBy = options?.sortBy ?? 'type';

    const dirents = await fs.readdir(resolvedPath, { withFileTypes: true });
    const entries: DirectoryEntry[] = [];

    for (const dirent of dirents) {
      const isHidden = dirent.name.startsWith('.');
      if (isHidden && !showHidden) continue;

      const fullPath = path.join(resolvedPath, dirent.name);

      let stats: Awaited<ReturnType<typeof fs.lstat>>;
      try {
        stats = await fs.lstat(fullPath);
      } catch {
        continue;
      }

      const type: DirectoryEntry['type'] = stats.isSymbolicLink()
        ? 'symlink'
        : dirent.isDirectory()
          ? 'directory'
          : 'file';

      if (type === 'directory' && IGNORED_DIRECTORIES.has(dirent.name)) continue;
      if (type === 'file' && IGNORED_FILES.has(dirent.name)) continue;

      const extension = type === 'directory' ? '' : path.extname(dirent.name).slice(1).toLowerCase();

      entries.push({
        name: dirent.name,
        path: fullPath,
        type,
        size: stats.size,
        extension,
        modifiedAt: stats.mtimeMs,
        isHidden,
      });
    }

    entries.sort((a, b) => {
      if (sortBy === 'type') {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      }

      if (sortBy === 'modified') {
        return b.modifiedAt - a.modifiedAt;
      }

      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return entries;
  }

  async readFile(filePath: string, options?: ReadFileOptions): Promise<FileContent> {
    const resolvedPath = this.validatePath(filePath);
    const maxSize = options?.maxSize ?? MAX_FILE_SIZE;
    const encoding = options?.encoding ?? 'utf-8';

    const extension = path.extname(resolvedPath).slice(1).toLowerCase();
    const basename = path.basename(resolvedPath).toLowerCase();
    const isBinary = this.isBinaryFile(extension, basename);

    const stats = await fs.stat(resolvedPath);

    if (isBinary) {
      return {
        path: resolvedPath,
        content: '',
        encoding,
        size: stats.size,
        language: this.detectLanguage(extension, basename),
        isBinary: true,
        isTruncated: false,
      };
    }

    const isTruncated = stats.size > maxSize;
    let content: string;

    if (isTruncated) {
      const fileHandle = await fs.open(resolvedPath, 'r');
      try {
        const buffer = Buffer.alloc(maxSize);
        const { bytesRead } = await fileHandle.read(buffer, 0, maxSize, 0);
        content = buffer.subarray(0, bytesRead).toString(encoding);
      } finally {
        await fileHandle.close();
      }
    } else {
      content = await fs.readFile(resolvedPath, { encoding });
    }

    return {
      path: resolvedPath,
      content,
      encoding,
      size: stats.size,
      language: this.detectLanguage(extension, basename),
      isBinary: false,
      isTruncated,
    };
  }

  private validatePath(requestedPath: string): string {
    if (!this.workingDirectory) {
      throw new Error('No working directory configured');
    }

    const candidate = realpathSync(path.resolve(requestedPath));
    const relative = path.relative(this.workingDirectory, candidate);

    const isInside =
      relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));

    if (!isInside) {
      throw new Error('Access denied: path outside working directory');
    }

    return candidate;
  }

  private detectLanguage(extension: string, basename: string): string {
    if (basename === 'dockerfile') return 'dockerfile';
    if (basename === '.gitignore' || basename === '.env' || basename.startsWith('.env.')) return 'shell';

    return LANGUAGE_MAP[extension] ?? 'plaintext';
  }

  private isBinaryFile(extension: string, basename: string): boolean {
    if (basename === 'dockerfile' || basename === '.gitignore' || basename.startsWith('.env')) {
      return false;
    }

    return BINARY_EXTENSIONS.has(extension);
  }
}

export const fileSystemService = new FileSystemService();
```

### 4.2 `src/main/services/filesystem/index.ts`
```ts
export { fileSystemService } from './fileSystemService';
export type {
  DirectoryEntry,
  FileContent,
  ReadDirOptions,
  ReadFileOptions,
} from './fileSystemService';
```

### 4.3 `src/main/ipc/fileSystemHandlers.ts`
```ts
/**
 * FileSystem IPC Handlers
 *
 * Exposes read-only filesystem operations to renderer.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { getLogger } from '../services/logging';
import { fileSystemService } from '../services/filesystem';
import type { ReadDirOptions, ReadFileOptions } from '../services/filesystem';

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

const CHANNELS = {
  SET_WORKING_DIR: 'levante/fs:setWorkingDir',
  GET_WORKING_DIR: 'levante/fs:getWorkingDir',
  READ_DIR: 'levante/fs:readDir',
  READ_FILE: 'levante/fs:readFile',
} as const;

export function setupFileSystemHandlers(_getMainWindow: () => BrowserWindow | null): void {
  for (const channel of Object.values(CHANNELS)) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(CHANNELS.SET_WORKING_DIR, async (_, args: { path: string }) => {
    try {
      fileSystemService.setWorkingDirectory(args.path);
      return ok(undefined);
    } catch (error) {
      logger.ipc.error('fs:setWorkingDir failed', {
        path: args.path,
        error: error instanceof Error ? error.message : error,
      });
      return fail(error);
    }
  });

  ipcMain.handle(CHANNELS.GET_WORKING_DIR, async () => {
    try {
      return ok(fileSystemService.getWorkingDirectory());
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(
    CHANNELS.READ_DIR,
    async (_, args: { path: string; options?: ReadDirOptions }) => {
      try {
        const entries = await fileSystemService.readDirectory(args.path, args.options);
        return ok(entries);
      } catch (error) {
        logger.ipc.error('fs:readDir failed', {
          path: args.path,
          error: error instanceof Error ? error.message : error,
        });
        return fail(error);
      }
    }
  );

  ipcMain.handle(
    CHANNELS.READ_FILE,
    async (_, args: { path: string; options?: ReadFileOptions }) => {
      try {
        const content = await fileSystemService.readFile(args.path, args.options);
        return ok(content);
      } catch (error) {
        logger.ipc.error('fs:readFile failed', {
          path: args.path,
          error: error instanceof Error ? error.message : error,
        });
        return fail(error);
      }
    }
  );

  logger.ipc.info('FileSystem handlers registered successfully');
}
```

### 4.4 `src/preload/api/filesystem.ts`
```ts
import { ipcRenderer } from 'electron';

export const filesystemApi = {
  setWorkingDir: (path: string) =>
    ipcRenderer.invoke('levante/fs:setWorkingDir', { path }),

  getWorkingDir: () =>
    ipcRenderer.invoke('levante/fs:getWorkingDir'),

  readDir: (
    path: string,
    options?: { showHidden?: boolean; sortBy?: 'name' | 'type' | 'modified' }
  ) => ipcRenderer.invoke('levante/fs:readDir', { path, options }),

  readFile: (
    path: string,
    options?: { maxSize?: number; encoding?: string }
  ) => ipcRenderer.invoke('levante/fs:readFile', { path, options }),
};
```

### 4.5 `src/renderer/stores/fileBrowserStore.ts`
```ts
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
        set((state) => {
          const nextEntries = new Map(state.entries);
          nextEntries.set(dirPath, result.data);
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
```

### 4.6 `src/renderer/components/chat/ChatListContent.tsx`
```tsx
/**
 * ChatListContent
 *
 * Scrollable content extracted from ChatList.
 * Contains Projects + Conversations sections only.
 */

import { useState, useEffect, useRef } from 'react';
import { Trash2, MoreVertical, Pencil, FolderOpen, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { ChatSession, Project } from '../../../types/database';

export interface ChatListContentProps {
  sessions: ChatSession[];
  currentSessionId?: string;
  onSessionSelect: (sessionId: string) => void;
  onDeleteChat: (sessionId: string) => void;
  onRenameChat: (sessionId: string, newTitle: string) => void;
  loading?: boolean;
  searchQuery: string;
  projects?: Project[];
  selectedProjectId?: string;
  onProjectSelect?: (project: Project) => void;
  onCreateProject?: () => void;
  onEditProject?: (project: Project) => void;
  onDeleteProject?: (projectId: string, projectName: string, sessionCount: number) => void;
}

export function ChatListContent({
  sessions,
  currentSessionId,
  onSessionSelect,
  onDeleteChat,
  onRenameChat,
  loading = false,
  searchQuery,
  projects = [],
  selectedProjectId,
  onProjectSelect,
  onCreateProject,
  onEditProject,
  onDeleteProject,
}: ChatListContentProps) {
  const { t } = useTranslation('chat');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const looseSessions = sessions.filter((s) => !s.project_id);

  const filteredLooseSessions = !searchQuery.trim()
    ? looseSessions
    : looseSessions.filter(
        (s) =>
          s.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.model.toLowerCase().includes(searchQuery.toLowerCase())
      );

  const groupedSessions = filteredLooseSessions.reduce((groups, session) => {
    const date = new Date(session.created_at);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let key: string;
    if (date.toDateString() === today.toDateString()) {
      key = 'today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      key = 'yesterday';
    } else if (date.getTime() > today.getTime() - 7 * 24 * 60 * 60 * 1000) {
      key = 'this_week';
    } else if (date.getTime() > today.getTime() - 30 * 24 * 60 * 60 * 1000) {
      key = 'this_month';
    } else {
      key = 'older';
    }

    if (!groups[key]) groups[key] = [];
    groups[key].push(session);
    return groups;
  }, {} as Record<string, ChatSession[]>);

  const sortedGroupKeys = Object.keys(groupedSessions).sort((a, b) => {
    const order = ['today', 'yesterday', 'this_week', 'this_month', 'older'];
    return order.indexOf(a) - order.indexOf(b);
  });

  const handleRenameStart = (session: ChatSession) => {
    setEditingSessionId(session.id);
    setEditingTitle(session.title || '');
  };

  const handleRenameSave = (sessionId: string) => {
    const trimmedTitle = editingTitle.trim();
    if (trimmedTitle && trimmedTitle.length > 0 && trimmedTitle.length <= 50) {
      onRenameChat(sessionId, trimmedTitle);
    }
    setEditingSessionId(null);
    setEditingTitle('');
  };

  const handleRenameCancel = () => {
    setEditingSessionId(null);
    setEditingTitle('');
  };

  useEffect(() => {
    if (editingSessionId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingSessionId]);

  const renderSession = (session: ChatSession) => (
    <div
      key={session.id}
      className={cn(
        'group mx-2 mb-1 rounded-lg cursor-pointer transition-colors',
        'hover:bg-accent/50',
        currentSessionId === session.id && 'bg-accent'
      )}
      onClick={() => editingSessionId !== session.id && onSessionSelect(session.id)}
    >
      <div className="flex items-center gap-2 p-1">
        <div className="flex-1 min-w-0">
          {editingSessionId === session.id ? (
            <Input
              ref={inputRef}
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleRenameSave(session.id);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  handleRenameCancel();
                }
              }}
              onBlur={() => handleRenameSave(session.id)}
              onClick={(e) => e.stopPropagation()}
              className="h-7 text-sm"
              maxLength={50}
            />
          ) : (
            <div className="text-sm font-medium truncate">{session.title || 'Untitled Chat'}</div>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                handleRenameStart(session);
              }}
            >
              <Pencil size={14} className="mr-2" />
              {t('chat_list.rename_chat')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onDeleteChat(session.id)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 size={14} className="mr-2" />
              {t('chat_list.delete_chat')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        {t('chat_list.loading')}
      </div>
    );
  }

  return (
    <>
      <div className="mt-2 pb-2 border-b">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {t('chat_list.projects_section')}
          </span>
          {onCreateProject && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
              onClick={onCreateProject}
              title={t('chat_list.new_project')}
            >
              <Plus size={14} />
            </Button>
          )}
        </div>

        {projects.map((project) => (
          <div
            key={project.id}
            className={cn(
              'group flex items-center gap-2 px-2 py-1.5 rounded-lg mx-2 mb-0.5 cursor-pointer',
              'hover:bg-accent/30 transition-colors',
              selectedProjectId === project.id && 'bg-accent/50'
            )}
            onClick={() => onProjectSelect?.(project)}
          >
            <FolderOpen size={14} className="shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium truncate flex-1">{project.name}</span>

            {(onEditProject || onDeleteProject) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100 transition-opacity h-5 w-5 p-0 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical size={12} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onEditProject && (
                    <DropdownMenuItem onSelect={() => onEditProject(project)}>
                      <Pencil size={14} className="mr-2" />
                      {t('chat_list.edit_project')}
                    </DropdownMenuItem>
                  )}
                  {onDeleteProject && (
                    <DropdownMenuItem
                      onSelect={() =>
                        onDeleteProject(
                          project.id,
                          project.name,
                          sessions.filter((s) => s.project_id === project.id).length
                        )
                      }
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 size={14} className="mr-2" />
                      {t('chat_list.delete_project')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}

        {projects.length === 0 && onCreateProject && (
          <button
            className="w-full text-xs text-muted-foreground hover:text-foreground px-4 py-2 text-left"
            onClick={onCreateProject}
          >
            + {t('chat_list.new_project')}
          </button>
        )}
      </div>

      <div className="pt-2">
        <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {t('chat_list.conversations_section')}
        </div>

        {filteredLooseSessions.length > 0 ? (
          <div>
            {sortedGroupKeys.map((groupKey) => (
              <div key={groupKey}>
                <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {t(`chat_list.groups.${groupKey}`)}
                </div>
                {groupedSessions[groupKey]
                  .sort((a, b) => b.updated_at - a.updated_at)
                  .map((session) => renderSession(session))}
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 text-center text-muted-foreground">
            {searchQuery ? t('chat_list.no_results') : t('chat_list.no_chats')}
          </div>
        )}
      </div>
    </>
  );
}
```

### 4.7 `src/renderer/components/sidebar/SidebarSections.tsx`
```tsx
/**
 * SidebarSections
 *
 * Header + search + tabs (Chats/Files) + content switching.
 */

import { useState, useEffect } from 'react';
import { Search, Plus, MessageSquare, FolderTree } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { ChatListContent, type ChatListContentProps } from '@/components/chat/ChatListContent';
import { FileBrowserContent } from '@/components/file-browser';

type SidebarSection = 'chats' | 'files';

export interface SidebarSectionsProps {
  chatListProps: Omit<ChatListContentProps, 'searchQuery'>;
  onNewChat: () => void;
  loading?: boolean;
  coworkModeEnabled: boolean;
  effectiveCwd: string | null;
}

export function SidebarSections({
  chatListProps,
  onNewChat,
  loading,
  coworkModeEnabled,
  effectiveCwd,
}: SidebarSectionsProps) {
  const { t } = useTranslation('chat');
  const [activeSection, setActiveSection] = useState<SidebarSection>('chats');
  const [searchQuery, setSearchQuery] = useState('');

  const showFilesTab = coworkModeEnabled && Boolean(effectiveCwd);

  useEffect(() => {
    if (!showFilesTab && activeSection === 'files') {
      setActiveSection('chats');
    }
  }, [showFilesTab, activeSection]);

  useEffect(() => {
    setSearchQuery('');
  }, [activeSection]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <Button
          onClick={onNewChat}
          className="w-full mb-3 justify-start gap-2"
          disabled={loading}
        >
          <Plus size={16} />
          {t('chat_list.new_chat')}
        </Button>

        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground"
            size={16}
          />
          <Input
            placeholder={
              activeSection === 'chats'
                ? t('chat_list.search_placeholder')
                : t('chat_list.file_browser.search_files_placeholder')
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {showFilesTab && (
        <div className="flex border-b shrink-0">
          <button
            onClick={() => setActiveSection('chats')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors',
              activeSection === 'chats'
                ? 'text-foreground border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <MessageSquare size={13} />
            {t('chat_list.file_browser.tab_chats')}
          </button>

          <button
            onClick={() => setActiveSection('files')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors',
              activeSection === 'files'
                ? 'text-foreground border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <FolderTree size={13} />
            {t('chat_list.file_browser.tab_files')}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0">
        {activeSection === 'chats' || !showFilesTab ? (
          <ChatListContent {...chatListProps} searchQuery={searchQuery} />
        ) : (
          <FileBrowserContent searchQuery={searchQuery} cwd={effectiveCwd!} />
        )}
      </div>
    </div>
  );
}
```

### 4.8 `src/renderer/components/file-browser/FileTreeNode.tsx`
```tsx
import {
  ChevronRight,
  Folder,
  File,
  FileText,
  FileCode,
  FileJson,
  FileType,
  Image,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DirectoryEntry } from '@/stores/fileBrowserStore';

interface FileTreeNodeProps {
  entry: DirectoryEntry;
  depth: number;
  isExpanded: boolean;
  isLoading: boolean;
  onClick: (entry: DirectoryEntry) => void;
}

function getFileIcon(entry: DirectoryEntry) {
  if (entry.type === 'directory') {
    return <Folder className="h-3.5 w-3.5 shrink-0 text-blue-400" />;
  }

  const ext = entry.extension.toLowerCase();

  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
    return <FileCode className="h-3.5 w-3.5 shrink-0 text-yellow-500" />;
  }

  if (['py', 'rb', 'go', 'rs', 'java', 'swift', 'kt', 'php', 'c', 'cpp', 'h'].includes(ext)) {
    return <FileCode className="h-3.5 w-3.5 shrink-0 text-green-500" />;
  }

  if (['json', 'yaml', 'yml', 'toml', 'xml'].includes(ext)) {
    return <FileJson className="h-3.5 w-3.5 shrink-0 text-amber-500" />;
  }

  if (['md', 'mdx'].includes(ext)) {
    return <FileText className="h-3.5 w-3.5 shrink-0 text-blue-300" />;
  }

  if (['html', 'css', 'scss', 'less'].includes(ext)) {
    return <FileCode className="h-3.5 w-3.5 shrink-0 text-orange-400" />;
  }

  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) {
    return <Image className="h-3.5 w-3.5 shrink-0 text-purple-400" />;
  }

  if (['env', 'gitignore', 'dockerignore', 'editorconfig'].includes(ext) || entry.name.startsWith('.')) {
    return <FileType className="h-3.5 w-3.5 shrink-0 text-gray-400" />;
  }

  return <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

export function FileTreeNode({ entry, depth, isExpanded, isLoading, onClick }: FileTreeNodeProps) {
  return (
    <button
      className={cn(
        'flex items-center gap-1 py-[3px] px-2 w-full text-left',
        'cursor-pointer hover:bg-accent/50 rounded-sm text-sm transition-colors'
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={() => onClick(entry)}
      title={entry.name}
    >
      {entry.type === 'directory' ? (
        isLoading ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <ChevronRight
            className={cn(
              'h-3 w-3 shrink-0 transition-transform text-muted-foreground',
              isExpanded && 'rotate-90'
            )}
          />
        )
      ) : (
        <span className="w-3 shrink-0" />
      )}

      {getFileIcon(entry)}
      <span className="truncate text-[13px]">{entry.name}</span>
    </button>
  );
}
```

### 4.9 `src/renderer/components/file-browser/FileBrowserContent.tsx`
```tsx
import { useEffect, useMemo } from 'react';
import { RefreshCw, Eye, EyeOff, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFileBrowserStore, type DirectoryEntry } from '@/stores/fileBrowserStore';
import { FileTreeNode } from './FileTreeNode';
import { useTranslation } from 'react-i18next';

interface FileBrowserContentProps {
  searchQuery: string;
  cwd: string;
}

function isEntryVisible(
  entry: DirectoryEntry,
  normalizedQuery: string,
  allEntries: Map<string, DirectoryEntry[]>
): boolean {
  if (!normalizedQuery) return true;

  if (entry.name.toLowerCase().includes(normalizedQuery)) {
    return true;
  }

  if (entry.type !== 'directory') {
    return false;
  }

  const children = allEntries.get(entry.path) ?? [];
  return children.some((child) => isEntryVisible(child, normalizedQuery, allEntries));
}

function getBasename(p: string): string {
  const normalized = p.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? p;
}

function FileTree({
  entries,
  allEntries,
  expandedDirs,
  depth,
  isLoadingDir,
  onItemClick,
  filterQuery,
}: {
  entries: DirectoryEntry[];
  allEntries: Map<string, DirectoryEntry[]>;
  expandedDirs: Set<string>;
  depth: number;
  isLoadingDir: string | null;
  onItemClick: (entry: DirectoryEntry) => void;
  filterQuery: string;
}) {
  const normalizedQuery = filterQuery.trim().toLowerCase();

  const visibleEntries = useMemo(() => {
    return entries.filter((entry) => isEntryVisible(entry, normalizedQuery, allEntries));
  }, [entries, normalizedQuery, allEntries]);

  if (visibleEntries.length === 0) {
    return null;
  }

  return (
    <div>
      {visibleEntries.map((entry) => {
        const forceExpandedBySearch = normalizedQuery.length > 0;
        const isExpanded = expandedDirs.has(entry.path) || forceExpandedBySearch;

        return (
          <div key={entry.path}>
            <FileTreeNode
              entry={entry}
              depth={depth}
              isExpanded={isExpanded}
              isLoading={isLoadingDir === entry.path}
              onClick={onItemClick}
            />

            {entry.type === 'directory' && isExpanded && (
              <FileTree
                entries={allEntries.get(entry.path) ?? []}
                allEntries={allEntries}
                expandedDirs={expandedDirs}
                depth={depth + 1}
                isLoadingDir={isLoadingDir}
                onItemClick={onItemClick}
                filterQuery={filterQuery}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function FileBrowserContent({ searchQuery, cwd }: FileBrowserContentProps) {
  const { t } = useTranslation('chat');
  const {
    entries,
    expandedDirs,
    isLoadingDir,
    showHiddenFiles,
    error,
    initialize,
    toggleDirectory,
    refreshDirectory,
    setShowHidden,
  } = useFileBrowserStore();

  useEffect(() => {
    void initialize(cwd);
  }, [cwd, initialize]);

  const handleItemClick = (entry: DirectoryEntry) => {
    if (entry.type === 'directory') {
      toggleDirectory(entry.path);
      return;
    }

    void window.levante.openExternal(`file://${entry.path}`);
  };

  const rootBasename = getBasename(cwd);
  const rootEntries = entries.get(cwd) ?? [];

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground border-b">
        <div className="flex items-center gap-1.5 truncate">
          <FolderOpen size={12} className="shrink-0" />
          <span className="truncate font-mono">/{rootBasename}</span>
        </div>

        <div className="flex gap-0.5 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={() => setShowHidden(!showHiddenFiles)}
            title={
              showHiddenFiles
                ? t('chat_list.file_browser.hide_hidden')
                : t('chat_list.file_browser.show_hidden')
            }
          >
            {showHiddenFiles ? <EyeOff size={12} /> : <Eye size={12} />}
          </Button>

          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={() => refreshDirectory(cwd)}
            title={t('chat_list.file_browser.refresh')}
          >
            <RefreshCw size={12} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-destructive">
          {t('chat_list.file_browser.read_dir_error')}: {error}
        </div>
      )}

      {rootEntries.length === 0 && !isLoadingDir ? (
        <div className="px-3 py-4 text-xs text-muted-foreground text-center">
          {t('chat_list.file_browser.empty_directory')}
        </div>
      ) : (
        <div className="py-1">
          <FileTree
            entries={rootEntries}
            allEntries={entries}
            expandedDirs={expandedDirs}
            depth={0}
            isLoadingDir={isLoadingDir}
            onItemClick={handleItemClick}
            filterQuery={searchQuery}
          />
        </div>
      )}
    </div>
  );
}
```

### 4.10 `src/renderer/components/file-browser/index.ts`
```ts
export { FileBrowserContent } from './FileBrowserContent';
export { FileTreeNode } from './FileTreeNode';
```

## 5) Archivos modificados - parches exactos

### 5.1 `src/preload/preload.ts`

Aplicar estos cambios exactos.

#### 5.1.1 Import nuevo API
Añadir esta línea junto al resto de imports de APIs:

```ts
import { filesystemApi } from "./api/filesystem";
```

#### 5.1.2 Extender interfaz `LevanteAPI`
Dentro de `export interface LevanteAPI { ... }`, agregar este bloque completo (por ejemplo después de `anthropicOAuth`):

```ts
  // Filesystem API (File Browser - Fase 1)
  fs: {
    setWorkingDir: (path: string) => Promise<{ success: boolean; error?: string }>;
    getWorkingDir: () => Promise<{ success: boolean; data?: string | null; error?: string }>;
    readDir: (
      path: string,
      options?: { showHidden?: boolean; sortBy?: 'name' | 'type' | 'modified' }
    ) => Promise<{
      success: boolean;
      data?: Array<{
        name: string;
        path: string;
        type: 'file' | 'directory' | 'symlink';
        size: number;
        extension: string;
        modifiedAt: number;
        isHidden: boolean;
      }>;
      error?: string;
    }>;
    readFile: (
      path: string,
      options?: { maxSize?: number; encoding?: string }
    ) => Promise<{
      success: boolean;
      data?: {
        path: string;
        content: string;
        encoding: string;
        size: number;
        language: string;
        isBinary: boolean;
        isTruncated: boolean;
      };
      error?: string;
    }>;
  };
```

#### 5.1.3 Registrar API en objeto `api`
Dentro de `const api: LevanteAPI = { ... }`, agregar:

```ts
  // Filesystem API
  fs: filesystemApi,
```


### 5.2 `src/main/lifecycle/initialization.ts`

#### 5.2.1 Import
Agregar import:

```ts
import { setupFileSystemHandlers } from "../ipc/fileSystemHandlers";
```

#### 5.2.2 Registro
Dentro de `registerIPCHandlers(...)`, agregar llamada:

```ts
  setupFileSystemHandlers(getMainWindow);
```

Colocarla junto al resto de setup de IPC handlers.


### 5.3 `src/renderer/components/chat/ChatList.tsx`

Reemplazar el archivo completo por este contenido:

```tsx
import { useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { ChatListContent } from './ChatListContent';
import { ChatSession, Project } from '../../../types/database';

interface ChatListProps {
  sessions: ChatSession[];
  currentSessionId?: string;
  onSessionSelect: (sessionId: string) => void;
  onNewChat: () => void;
  onDeleteChat: (sessionId: string) => void;
  onRenameChat: (sessionId: string, newTitle: string) => void;
  loading?: boolean;
  projects?: Project[];
  selectedProjectId?: string;
  onProjectSelect?: (project: Project) => void;
  onCreateProject?: () => void;
  onEditProject?: (project: Project) => void;
  onDeleteProject?: (projectId: string, projectName: string, sessionCount: number) => void;
}

export function ChatList({
  sessions,
  currentSessionId,
  onSessionSelect,
  onNewChat,
  onDeleteChat,
  onRenameChat,
  loading = false,
  projects = [],
  selectedProjectId,
  onProjectSelect,
  onCreateProject,
  onEditProject,
  onDeleteProject,
}: ChatListProps) {
  const { t } = useTranslation('chat');
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <Button
          onClick={onNewChat}
          className="w-full mb-3 justify-start gap-2"
          disabled={loading}
        >
          <Plus size={16} />
          {t('chat_list.new_chat')}
        </Button>

        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground"
            size={16}
          />
          <Input
            placeholder={t('chat_list.search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <ChatListContent
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSessionSelect={onSessionSelect}
          onDeleteChat={onDeleteChat}
          onRenameChat={onRenameChat}
          loading={loading}
          searchQuery={searchQuery}
          projects={projects}
          selectedProjectId={selectedProjectId}
          onProjectSelect={onProjectSelect}
          onCreateProject={onCreateProject}
          onEditProject={onEditProject}
          onDeleteProject={onDeleteProject}
        />
      </div>
    </div>
  );
}
```


### 5.4 `src/renderer/pages/ChatPage.tsx`

#### 5.4.1 Importaciones
En la sección de imports, aplicar:
- Eliminar:
```ts
import { ChatList } from '@/components/chat/ChatList';
```
- Agregar:
```ts
import { SidebarSections } from '@/components/sidebar/SidebarSections';
```

#### 5.4.2 Reemplazar `getSidebarContent`
Reemplazar el bloque completo de `ChatPageWithProvider.getSidebarContent = (...) => { ... }` por este:

```tsx
// Static method to get sidebar content for chat page
ChatPageWithProvider.getSidebarContent = (
  sessions: any[],
  currentSessionId: string | undefined,
  onSessionSelect: (sessionId: string) => void,
  onNewChat: () => void,
  onDeleteChat: (sessionId: string) => void,
  onRenameChat: (sessionId: string, newTitle: string) => void,
  loading: boolean = false,
  projects?: any[],
  selectedProjectId?: string,
  onProjectSelect?: (project: any) => void,
  onCreateProject?: () => void,
  onEditProject?: (project: any) => void,
  onDeleteProject?: (projectId: string, projectName: string, sessionCount: number) => void,
  coworkModeEnabled: boolean = false,
  effectiveCwd: string | null = null,
) => {
  return (
    <SidebarSections
      onNewChat={onNewChat}
      loading={loading}
      coworkModeEnabled={coworkModeEnabled}
      effectiveCwd={effectiveCwd}
      chatListProps={{
        sessions,
        currentSessionId,
        onSessionSelect,
        onDeleteChat,
        onRenameChat,
        loading,
        projects,
        selectedProjectId,
        onProjectSelect,
        onCreateProject,
        onEditProject,
        onDeleteProject,
      }}
    />
  );
};
```


### 5.5 `src/renderer/App.tsx`

Aplicar estos cambios exactos.

#### 5.5.1 Import
Agregar import:

```ts
import { usePreference } from '@/hooks/usePreferences'
```

#### 5.5.2 Estado de cowork para sidebar
Agregar en el componente `App` junto al resto de hooks/state:

```ts
  const [coworkMode] = usePreference('coworkMode')
  const [coworkModeCwd] = usePreference('coworkModeCwd')
```

#### 5.5.3 CWD efectivo para sidebar
Agregar antes de `getSidebarContent`:

```ts
  const effectiveSidebarCwd = selectedProject?.cwd ?? coworkModeCwd ?? null
```

#### 5.5.4 Pasar props a `ChatPage.getSidebarContent(...)`
En la llamada dentro de `getSidebarContent`, agregar al final:

```ts
        Boolean(coworkMode),
        effectiveSidebarCwd,
```

Quedando el bloque `getSidebarContent` equivalente a:

```ts
  const getSidebarContent = () => {
    if (typeof ChatPage.getSidebarContent === 'function') {
      return ChatPage.getSidebarContent(
        sessions,
        currentSession?.id,
        handleLoadSession,
        handleNewChat,
        deleteSession,
        updateSessionTitle,
        false,
        projects,
        selectedProject?.id,
        handleProjectSelect,
        () => { setEditingProject(undefined); setProjectModalOpen(true); },
        (project: Project) => { setEditingProject(project); setProjectModalOpen(true); },
        (projectId: string, projectName: string, sessionCount: number) => {
          setDeleteConfirmProject({ id: projectId, name: projectName, count: sessionCount });
        },
        Boolean(coworkMode),
        effectiveSidebarCwd,
      );
    }
    return null;
  }
```

Nota de alcance de Fase 1:
- El `effectiveSidebarCwd` de sidebar usa `project CWD > global coworkModeCwd`.
- El override de CWD por sesión dentro de `ChatPage` no se sincroniza al sidebar en esta fase.


### 5.6 `src/renderer/locales/en/chat.json`
Agregar este bloque dentro de `chat_list`:

```json
"file_browser": {
  "tab_chats": "Chats",
  "tab_files": "Files",
  "search_files_placeholder": "Filter files...",
  "show_hidden": "Show hidden files",
  "hide_hidden": "Hide hidden files",
  "refresh": "Refresh",
  "empty_directory": "Empty directory",
  "read_dir_error": "Failed to read directory"
}
```


### 5.7 `src/renderer/locales/es/chat.json`
Agregar este bloque dentro de `chat_list`:

```json
"file_browser": {
  "tab_chats": "Chats",
  "tab_files": "Archivos",
  "search_files_placeholder": "Filtrar archivos...",
  "show_hidden": "Mostrar archivos ocultos",
  "hide_hidden": "Ocultar archivos ocultos",
  "refresh": "Actualizar",
  "empty_directory": "Directorio vacío",
  "read_dir_error": "No se pudo leer el directorio"
}
```

## 6) Requisitos de seguridad (obligatorios)
1. No usar `startsWith` para validar root.
2. Validar con:
- `realpathSync(path.resolve(requestedPath))`
- `path.relative(workingDirectory, candidate)`
- rechazar si empieza por `..` o es absoluto.
3. `setWorkingDir` debe aceptar solo directorios existentes.
4. Todo es read-only.

## 7) Checklist de implementación
1. Crear carpetas.
2. Crear 10 archivos nuevos con el contenido exacto de sección 4.
3. Aplicar 7 modificaciones exactas de sección 5.
4. Verificar compilación TypeScript.
5. Verificar funcionamiento manual (sección 8).

## 8) Verificación manual obligatoria
1. Con Cowork desactivado: no aparece tab `Files`.
2. Con Cowork activo + CWD válido: aparece tab `Files`.
3. Abrir tab `Files`: se muestra root del CWD.
4. Expandir/cerrar directorios.
5. Toggle de hidden files.
6. Refresh del árbol.
7. Click archivo abre editor externo.
8. Desactivar Cowork mientras `Files` está activa: vuelve a `Chats`.
9. Intento de leer ruta fuera del CWD vía IPC: error controlado `Access denied...`.

## 9) Criterios de aceptación (Definition of Done)
- Todos los cambios de este runbook están aplicados.
- No hay código de watchers (`watch/unwatch`) en Fase 1.
- No hay cambios en `WebPreviewPanel.tsx`, `webPreviewStore.ts`.
- Sidebar de chats no tiene regresiones funcionales.
- Seguridad de paths implementada exactamente como se define en este documento.
