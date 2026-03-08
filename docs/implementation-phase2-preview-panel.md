# Runbook Cerrado de Implementación - Fase 2 Panel Unificado de Preview (Panel Derecho)

## 0) Regla de ejecución (obligatoria)
Este documento es una especificación cerrada. La IA implementadora debe:
- Implementar exactamente los archivos y cambios listados aquí.
- No inferir features fuera de este documento.
- No omitir líneas de código incluidas en este documento.
- No modificar archivos que no estén en la lista.

## 1) Objetivo funcional de Fase 2
Migrar `WebPreviewPanel` a un panel derecho unificado con tabs mixtas:
- Tabs de servidor (preview web en iframe, comportamiento existente).
- Tabs de archivo (código/markdown) abiertas desde el file tree (Fase 1).

Entregable de Fase 2:
- Store unificado `sidePanelStore` con compatibilidad hacia atrás para web preview.
- `SidePanel` reemplaza `WebPreviewPanel`.
- Click en archivo del file tree abre tab en panel derecho.
- Markdown renderizado + código con syntax highlighting.
- Límite de 10 tabs de archivo con LRU real.

No entra en esta fase:
- Visualizador de PDF real.
- Visualizador de DOCX real.
- Abrir archivos locales con `file://` (bloqueado por política de seguridad actual).

## 2) Correcciones críticas ya incorporadas en este runbook
1. No se usa `window.levante.openExternal('file://...')` para archivos.
2. No se depende de `prose` (no requiere `@tailwindcss/typography`).
3. LRU real implementado (`lastOpenedAt`).
4. Paths cross-platform (`/` y `\\`) normalizados en renderer.
5. Criterios de verificación alineados al comportamiento real (tabs de servidor se eliminan al terminar task).
6. `WebPreviewButton` visible cuando hay cualquier tab (server o file), no solo servers.

## 3) Lista exacta de archivos

### 3.1 Crear (12)
1. `src/renderer/stores/sidePanelStore.ts`
2. `src/renderer/components/chat/SidePanel.tsx`
3. `src/renderer/components/chat/panel/PanelTabBar.tsx`
4. `src/renderer/components/chat/panel/TabChip.tsx`
5. `src/renderer/components/chat/panel/PanelContextBar.tsx`
6. `src/renderer/components/chat/panel/PanelContent.tsx`
7. `src/renderer/components/chat/panel/PanelControls.tsx`
8. `src/renderer/components/chat/panel/index.ts`
9. `src/renderer/components/file-browser/CodeViewer.tsx`
10. `src/renderer/components/file-browser/MarkdownRenderer.tsx`
11. `src/renderer/components/file-browser/FileContentRenderer.tsx`
12. `src/renderer/components/file-browser/BinaryFileState.tsx`

### 3.2 Modificar (6)
1. `src/renderer/hooks/useWebPreview.ts`
2. `src/renderer/components/chat/WebPreviewButton.tsx`
3. `src/renderer/components/chat/WebPreviewToast.tsx`
4. `src/renderer/pages/ChatPage.tsx`
5. `src/renderer/components/file-browser/FileBrowserContent.tsx`
6. `src/renderer/components/file-browser/index.ts`

### 3.3 Deprecar (2)
1. `src/renderer/stores/webPreviewStore.ts`
2. `src/renderer/components/chat/WebPreviewPanel.tsx`

## 4) Dependencias
No instalar nada en esta fase.
`react-markdown` y `remark-gfm` ya existen en `package.json`.

## 5) Preparación de carpetas
Ejecutar:

```bash
mkdir -p src/renderer/components/chat/panel
mkdir -p src/renderer/components/file-browser
```

## 6) Archivos nuevos - contenido completo

### 6.1 `src/renderer/stores/sidePanelStore.ts`
```ts
/**
 * Side Panel Store
 *
 * Unified store for right panel tabs:
 * - Server tabs (legacy web preview)
 * - File tabs (file browser)
 * - Future: PDF/Doc tabs
 */

import { create } from 'zustand';

export interface ServerTab {
  type: 'server';
  id: string; // taskId
  port: number;
  url: string;
  command: string;
  description?: string;
  isAlive: boolean;
  detectedAt: number;
}

export interface FileTab {
  type: 'file';
  id: string; // normalized absolute path
  filePath: string;
  fileName: string;
  language: string;
  content: string | null;
  isLoading: boolean;
  isBinary: boolean;
  isTruncated: boolean;
  lastOpenedAt: number; // LRU
}

export interface PdfTab {
  type: 'pdf';
  id: string;
  filePath: string;
  fileName: string;
  currentPage: number;
  totalPages: number;
}

export interface DocTab {
  type: 'doc';
  id: string;
  filePath: string;
  fileName: string;
  htmlContent: string | null;
  isLoading: boolean;
}

export type PanelTab = ServerTab | FileTab | PdfTab | DocTab;

const MAX_FILE_TABS = 10;

interface SidePanelState {
  tabs: PanelTab[];
  activeTabId: string | null;
  isPanelOpen: boolean;

  pendingToast: ServerTab | null;

  setActiveTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  openPanel: (tabId?: string) => void;
  closePanel: () => void;
  clearToast: () => void;

  addServerTab: (server: Omit<ServerTab, 'type'>) => void;
  markServerDead: (taskId: string) => void;
  removeServerTab: (taskId: string) => void;

  openFileTab: (filePath: string) => Promise<void>;
  updateFileContent: (filePath: string, content: string) => void;

  // Backwards compatibility aliases
  addServer: (server: Omit<ServerTab, 'type'>) => void;
  removeServer: (taskId: string) => void;
  setActiveServer: (taskId: string) => void;

  getServerTabs: () => ServerTab[];
  getFileTabs: () => FileTab[];
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function getFileName(filePath: string): string {
  const normalized = normalizePath(filePath);
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? filePath;
}

function getFileExtension(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  if (!fileName.includes('.')) return '';
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

function detectLanguage(extension: string): string {
  const map: Record<string, string> = {
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    pyw: 'python',
    pyi: 'python',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    md: 'markdown',
    mdx: 'markdown',
    env: 'shell',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
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
  return map[extension] ?? 'plaintext';
}

export const useSidePanelStore = create<SidePanelState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  isPanelOpen: false,
  pendingToast: null,

  setActiveTab: (tabId) => {
    set((state) => ({
      activeTabId: tabId,
      tabs: state.tabs.map((tab) => {
        if (tab.type === 'file' && tab.id === tabId) {
          return { ...tab, lastOpenedAt: Date.now() };
        }
        return tab;
      }),
    }));
  },

  closeTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.type === 'server') return;

    set((state) => {
      const nextTabs = state.tabs.filter((t) => t.id !== tabId);
      const shouldChangeActive = state.activeTabId === tabId;

      return {
        tabs: nextTabs,
        activeTabId: shouldChangeActive ? (nextTabs[nextTabs.length - 1]?.id ?? null) : state.activeTabId,
        isPanelOpen: nextTabs.length === 0 ? false : state.isPanelOpen,
      };
    });
  },

  openPanel: (tabId) => {
    set((state) => ({
      isPanelOpen: true,
      activeTabId: tabId ?? state.activeTabId ?? state.tabs[0]?.id ?? null,
      pendingToast: null,
    }));
  },

  closePanel: () => {
    set({ isPanelOpen: false });
  },

  clearToast: () => {
    set({ pendingToast: null });
  },

  addServerTab: (server) => {
    set((state) => {
      const exists = state.tabs.some((t) => t.type === 'server' && t.id === server.id);
      if (exists) return state;

      const newTab: ServerTab = { ...server, type: 'server' };
      const nextTabs = [...state.tabs, newTab];

      return {
        tabs: nextTabs,
        pendingToast: state.isPanelOpen ? null : newTab,
        activeTabId: state.activeTabId ?? newTab.id,
      };
    });
  },

  markServerDead: (taskId) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.type === 'server' && tab.id === taskId
          ? { ...tab, isAlive: false }
          : tab
      ),
    }));
  },

  removeServerTab: (taskId) => {
    set((state) => {
      const nextTabs = state.tabs.filter((tab) => !(tab.type === 'server' && tab.id === taskId));
      const nextActive =
        state.activeTabId === taskId
          ? (nextTabs[0]?.id ?? null)
          : state.activeTabId;

      return {
        tabs: nextTabs,
        activeTabId: nextActive,
        isPanelOpen: nextTabs.length === 0 ? false : state.isPanelOpen,
      };
    });
  },

  openFileTab: async (filePath) => {
    const tabId = normalizePath(filePath);

    const existing = get().tabs.find((tab) => tab.type === 'file' && tab.id === tabId);
    if (existing && existing.type === 'file') {
      set((state) => ({
        isPanelOpen: true,
        activeTabId: tabId,
        tabs: state.tabs.map((tab) =>
          tab.type === 'file' && tab.id === tabId
            ? { ...tab, lastOpenedAt: Date.now() }
            : tab
        ),
      }));
      return;
    }

    const fileTabs = get().tabs.filter((tab): tab is FileTab => tab.type === 'file');
    if (fileTabs.length >= MAX_FILE_TABS) {
      const oldest = [...fileTabs].sort((a, b) => a.lastOpenedAt - b.lastOpenedAt)[0];
      set((state) => ({
        tabs: state.tabs.filter((tab) => tab.id !== oldest.id),
      }));
    }

    const fileName = getFileName(filePath);
    const extension = getFileExtension(fileName);
    const now = Date.now();

    const newTab: FileTab = {
      type: 'file',
      id: tabId,
      filePath,
      fileName,
      language: detectLanguage(extension),
      content: null,
      isLoading: true,
      isBinary: false,
      isTruncated: false,
      lastOpenedAt: now,
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: tabId,
      isPanelOpen: true,
    }));

    try {
      const result = await window.levante.fs.readFile(filePath);

      if (result.success && result.data) {
        set((state) => ({
          tabs: state.tabs.map((tab) => {
            if (tab.type === 'file' && tab.id === tabId) {
              return {
                ...tab,
                content: result.data.content,
                language: result.data.language,
                isLoading: false,
                isBinary: result.data.isBinary,
                isTruncated: result.data.isTruncated,
              };
            }
            return tab;
          }),
        }));
      } else {
        set((state) => ({
          tabs: state.tabs.map((tab) => {
            if (tab.type === 'file' && tab.id === tabId) {
              return {
                ...tab,
                isLoading: false,
                content: `Error: ${result.error ?? 'Failed to read file'}`,
              };
            }
            return tab;
          }),
        }));
      }
    } catch (error) {
      set((state) => ({
        tabs: state.tabs.map((tab) => {
          if (tab.type === 'file' && tab.id === tabId) {
            return {
              ...tab,
              isLoading: false,
              content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            };
          }
          return tab;
        }),
      }));
    }
  },

  updateFileContent: (filePath, content) => {
    const tabId = normalizePath(filePath);
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.type === 'file' && tab.id === tabId
          ? { ...tab, content, isLoading: false }
          : tab
      ),
    }));
  },

  addServer: (server) => get().addServerTab(server),
  removeServer: (taskId) => get().removeServerTab(taskId),
  setActiveServer: (taskId) => get().setActiveTab(taskId),

  getServerTabs: () => get().tabs.filter((tab): tab is ServerTab => tab.type === 'server'),
  getFileTabs: () => get().tabs.filter((tab): tab is FileTab => tab.type === 'file'),
}));

// Backwards compatibility for existing imports/types
export type DetectedServer = ServerTab;
```

### 6.2 `src/renderer/components/chat/panel/TabChip.tsx`
```ts
/**
 * TabChip
 *
 * Individual tab button for unified panel tab bar.
 */

import { X, FileCode, FileText, File } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { PanelTab } from '@/stores/sidePanelStore';

interface TabChipProps {
  tab: PanelTab;
  isActive: boolean;
  onSelect: () => void;
  onClose?: () => void;
}

function TabIcon({ tab }: { tab: PanelTab }) {
  switch (tab.type) {
    case 'server':
      return (
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full shrink-0',
            tab.isAlive ? 'bg-green-400' : 'bg-red-400'
          )}
        />
      );

    case 'file':
      if (['javascript', 'jsx', 'typescript', 'tsx', 'python', 'go', 'rust', 'java', 'ruby', 'php', 'c', 'cpp'].includes(tab.language)) {
        return <FileCode className="h-3 w-3 shrink-0" />;
      }
      if (tab.language === 'markdown') {
        return <FileText className="h-3 w-3 shrink-0" />;
      }
      return <File className="h-3 w-3 shrink-0" />;

    case 'pdf':
      return <FileText className="h-3 w-3 shrink-0 text-red-400" />;

    case 'doc':
      return <FileText className="h-3 w-3 shrink-0 text-blue-400" />;

    default:
      return <File className="h-3 w-3 shrink-0" />;
  }
}

function TabLabel({ tab }: { tab: PanelTab }) {
  switch (tab.type) {
    case 'server':
      return (
        <>
          <span>:{tab.port}</span>
          {!tab.isAlive && (
            <Badge variant="outline" className="text-[9px] py-0 px-1 h-3.5">
              stopped
            </Badge>
          )}
        </>
      );

    case 'file':
    case 'pdf':
    case 'doc':
      return <span className="max-w-[120px] truncate">{tab.fileName}</span>;

    default:
      return null;
  }
}

export function TabChip({ tab, isActive, onSelect, onClose }: TabChipProps) {
  const title = tab.type === 'server' ? tab.command : tab.filePath;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors shrink-0 group',
        isActive
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
      title={title}
    >
      <TabIcon tab={tab} />
      <TabLabel tab={tab} />

      {onClose && (
        <span
          role="button"
          aria-label="Close tab"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-1 opacity-0 group-hover:opacity-100 hover:bg-primary-foreground/20 rounded-sm p-0.5 cursor-pointer"
        >
          <X size={10} />
        </span>
      )}
    </button>
  );
}
```

### 6.3 `src/renderer/components/chat/panel/PanelControls.tsx`
```ts
/**
 * PanelControls
 *
 * Contextual actions for active tab.
 */

import { RefreshCw, ExternalLink, X, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PanelTab } from '@/stores/sidePanelStore';

interface PanelControlsProps {
  tab: PanelTab | undefined;
  onReload?: () => void;
  onOpenExternal?: () => void;
  onClose: () => void;
}

export function PanelControls({ tab, onReload, onOpenExternal, onClose }: PanelControlsProps) {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {tab?.type === 'server' && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onReload}
            title="Reload preview"
            disabled={!tab.isAlive}
          >
            <RefreshCw size={12} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onOpenExternal}
            title="Open in browser"
            disabled={!tab.isAlive}
          >
            <ExternalLink size={12} />
          </Button>
        </>
      )}

      {tab?.type === 'file' && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => {
            void navigator.clipboard.writeText(tab.filePath);
          }}
          title="Copy file path"
        >
          <Copy size={12} />
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onClose}
        title="Close panel"
      >
        <X size={12} />
      </Button>
    </div>
  );
}
```

### 6.4 `src/renderer/components/chat/panel/PanelTabBar.tsx`
```ts
/**
 * PanelTabBar
 *
 * Unified tab bar for server/file tabs.
 */

import { Monitor } from 'lucide-react';
import { TabChip } from './TabChip';
import { PanelControls } from './PanelControls';
import type { PanelTab } from '@/stores/sidePanelStore';

interface PanelTabBarProps {
  tabs: PanelTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onClosePanel: () => void;
  activeTab: PanelTab | undefined;
  onReload?: () => void;
  onOpenExternal?: () => void;
}

export function PanelTabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onClosePanel,
  activeTab,
  onReload,
  onOpenExternal,
}: PanelTabBarProps) {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b shrink-0 bg-muted/30">
      <Monitor size={13} className="text-muted-foreground shrink-0" />

      <div className="flex-1 flex items-center gap-1 overflow-x-auto min-w-0 scrollbar-none">
        {tabs.map((tab) => (
          <TabChip
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onSelect={() => onSelectTab(tab.id)}
            onClose={tab.type !== 'server' ? () => onCloseTab(tab.id) : undefined}
          />
        ))}
      </div>

      <PanelControls
        tab={activeTab}
        onReload={onReload}
        onOpenExternal={onOpenExternal}
        onClose={onClosePanel}
      />
    </div>
  );
}
```

### 6.5 `src/renderer/components/chat/panel/PanelContextBar.tsx`
```ts
/**
 * PanelContextBar
 *
 * Secondary context line under tabs:
 * - Server: URL + status
 * - File: relative path + copy button
 */

import { Server, FileCode, FileText, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { PanelTab } from '@/stores/sidePanelStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';

interface PanelContextBarProps {
  tab: PanelTab | undefined;
}

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/');
}

function toRelativePath(filePath: string, workingDirectory: string | null): string {
  if (!workingDirectory) return filePath;

  const normalizedFile = normalizePath(filePath);
  const normalizedRoot = normalizePath(workingDirectory).replace(/\/+$/, '');

  if (normalizedFile === normalizedRoot) return '';
  if (normalizedFile.startsWith(`${normalizedRoot}/`)) {
    return normalizedFile.slice(normalizedRoot.length + 1);
  }

  return filePath;
}

export function PanelContextBar({ tab }: PanelContextBarProps) {
  const workingDirectory = useFileBrowserStore((state) => state.workingDirectory);

  if (!tab) return null;

  switch (tab.type) {
    case 'server':
      return (
        <div className="flex items-center gap-2 px-2 py-1 border-b bg-muted/20 shrink-0">
          <Server size={11} className="text-muted-foreground shrink-0" />
          <span className="text-xs font-mono text-muted-foreground truncate">{tab.url}</span>
          {!tab.isAlive && (
            <Badge variant="destructive" className="text-[10px] py-0 px-1.5 h-4 shrink-0">
              offline
            </Badge>
          )}
        </div>
      );

    case 'file': {
      const relativePath = toRelativePath(tab.filePath, workingDirectory);

      return (
        <div className="flex items-center gap-2 px-2 py-1 border-b bg-muted/20 shrink-0">
          <FileCode size={11} className="text-muted-foreground shrink-0" />
          <span className="text-xs font-mono text-muted-foreground truncate flex-1">{relativePath}</span>

          {tab.isTruncated && (
            <Badge variant="outline" className="text-[9px] py-0 px-1 h-3.5 shrink-0">
              truncated
            </Badge>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
            onClick={() => {
              void navigator.clipboard.writeText(tab.filePath);
            }}
            title="Copy path"
          >
            <Copy size={10} />
          </Button>
        </div>
      );
    }

    case 'pdf':
      return (
        <div className="flex items-center gap-2 px-2 py-1 border-b bg-muted/20 shrink-0">
          <FileText size={11} className="text-muted-foreground shrink-0" />
          <span className="text-xs font-mono text-muted-foreground truncate flex-1">{tab.fileName}</span>
          <span className="text-xs text-muted-foreground">Page {tab.currentPage} / {tab.totalPages}</span>
        </div>
      );

    case 'doc':
      return (
        <div className="flex items-center gap-2 px-2 py-1 border-b bg-muted/20 shrink-0">
          <FileText size={11} className="text-muted-foreground shrink-0" />
          <span className="text-xs font-mono text-muted-foreground truncate flex-1">{tab.fileName}</span>
        </div>
      );

    default:
      return null;
  }
}
```

### 6.6 `src/renderer/components/file-browser/BinaryFileState.tsx`
```ts
/**
 * BinaryFileState
 *
 * Placeholder for binary files.
 */

import { FileX } from 'lucide-react';

interface BinaryFileStateProps {
  fileName: string;
}

export function BinaryFileState({ fileName }: BinaryFileStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
      <FileX size={32} className="opacity-30" />
      <div className="text-center">
        <p className="text-sm font-medium">Binary file</p>
        <p className="text-xs mt-1 opacity-70">{fileName} cannot be previewed</p>
      </div>
    </div>
  );
}
```

### 6.7 `src/renderer/components/file-browser/MarkdownRenderer.tsx`
```ts
/**
 * MarkdownRenderer
 *
 * Markdown preview with GFM support.
 * Uses explicit element styles (no `prose` dependency).
 */

import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block';

interface MarkdownRendererProps {
  content: string;
}

const components: Components = {
  h1: ({ children }) => <h1 className="text-2xl font-semibold mt-2 mb-3">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-semibold mt-5 mb-2">{children}</h2>,
  h3: ({ children }) => <h3 className="text-lg font-semibold mt-4 mb-2">{children}</h3>,
  p: ({ children }) => <p className="leading-7 mb-3">{children}</p>,
  ul: ({ children }) => <ul className="list-disc list-outside ml-5 mb-3">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-outside ml-5 mb-3">{children}</ol>,
  li: ({ children }) => <li className="py-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-muted-foreground italic my-3">
      {children}
    </blockquote>
  ),
  code: ({ className, children, ...props }) => {
    const match = className?.match(/language-(\w+)/);
    const language = match ? match[1] : '';
    const codeString = String(children).replace(/\n$/, '');

    if (!match) {
      return (
        <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
          {children}
        </code>
      );
    }

    return (
      <CodeBlock code={codeString} language={language} showLineNumbers>
        <CodeBlockCopyButton />
      </CodeBlock>
    );
  },
  table: ({ children }) => (
    <div className="overflow-x-auto my-4">
      <table className="w-full border-collapse border border-border">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border px-3 py-2 bg-muted text-left text-sm font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-3 py-2 text-sm">{children}</td>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-primary hover:underline"
      onClick={(e) => {
        e.preventDefault();
        if (href) {
          void window.levante.openExternal(href);
        }
      }}
    >
      {children}
    </a>
  ),
};

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ScrollArea className="h-full">
      <div className="p-4 text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {content}
        </ReactMarkdown>
      </div>
    </ScrollArea>
  );
}
```

### 6.8 `src/renderer/components/file-browser/CodeViewer.tsx`
```ts
/**
 * CodeViewer
 *
 * Source code viewer with syntax highlighting and line numbers.
 */

import { ScrollArea } from '@/components/ui/scroll-area';
import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block';

interface CodeViewerProps {
  content: string;
  language: string;
}

export function CodeViewer({ content, language }: CodeViewerProps) {
  const lineCount = content.split('\n').length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b text-xs text-muted-foreground shrink-0">
        <span className="font-mono">{language}</span>
        <span>{lineCount} lines</span>
      </div>

      <ScrollArea className="flex-1">
        <CodeBlock code={content} language={language} showLineNumbers className="border-0 rounded-none">
          <CodeBlockCopyButton />
        </CodeBlock>
      </ScrollArea>
    </div>
  );
}
```

### 6.9 `src/renderer/components/file-browser/FileContentRenderer.tsx`
```ts
/**
 * FileContentRenderer
 *
 * Chooses the right renderer for file tabs.
 */

import { Loader2 } from 'lucide-react';
import type { FileTab } from '@/stores/sidePanelStore';
import { MarkdownRenderer } from './MarkdownRenderer';
import { CodeViewer } from './CodeViewer';
import { BinaryFileState } from './BinaryFileState';

interface FileContentRendererProps {
  tab: FileTab;
}

export function FileContentRenderer({ tab }: FileContentRendererProps) {
  if (tab.isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tab.isBinary) {
    return <BinaryFileState fileName={tab.fileName} />;
  }

  if (!tab.content) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No content
      </div>
    );
  }

  if (tab.language === 'markdown') {
    return <MarkdownRenderer content={tab.content} />;
  }

  return <CodeViewer content={tab.content} language={tab.language} />;
}
```

### 6.10 `src/renderer/components/chat/panel/PanelContent.tsx`
```ts
/**
 * PanelContent
 *
 * Content router by active tab type.
 */

import { Server } from 'lucide-react';
import type { PanelTab, ServerTab } from '@/stores/sidePanelStore';
import { FileContentRenderer } from '@/components/file-browser/FileContentRenderer';

interface PanelContentProps {
  tab: PanelTab | undefined;
  isDragging: boolean;
  iframeKey?: number;
}

function ServerContent({ server, iframeKey }: { server: ServerTab; iframeKey: number }) {
  if (!server.isAlive) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <Server size={32} className="opacity-30" />
        <div className="text-center">
          <p className="text-sm font-medium">Server stopped</p>
          <p className="text-xs mt-1 opacity-70">The process running on :{server.port} has ended</p>
        </div>
      </div>
    );
  }

  return (
    <iframe
      key={iframeKey}
      src={server.url}
      title={`Preview :${server.port}`}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-top-navigation-by-user-activation"
      allow="fullscreen; clipboard-read; clipboard-write"
      className="absolute inset-0 w-full h-full border-0"
    />
  );
}

export function PanelContent({ tab, isDragging, iframeKey = 0 }: PanelContentProps) {
  return (
    <div className="flex-1 relative overflow-hidden">
      {isDragging && <div className="absolute inset-0 z-50 cursor-col-resize" />}

      {!tab ? (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          No tab selected
        </div>
      ) : tab.type === 'server' ? (
        <ServerContent server={tab} iframeKey={iframeKey} />
      ) : tab.type === 'file' ? (
        <FileContentRenderer tab={tab} />
      ) : (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          Preview not available for this file type
        </div>
      )}
    </div>
  );
}
```

### 6.11 `src/renderer/components/chat/panel/index.ts`
```ts
export { PanelTabBar } from './PanelTabBar';
export { PanelContextBar } from './PanelContextBar';
export { PanelContent } from './PanelContent';
export { PanelControls } from './PanelControls';
export { TabChip } from './TabChip';
```

### 6.12 `src/renderer/components/chat/SidePanel.tsx`
```ts
/**
 * SidePanel
 *
 * Unified right panel that replaces WebPreviewPanel.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { useSidePanelStore } from '@/stores/sidePanelStore';
import { PanelTabBar, PanelContextBar, PanelContent } from './panel';
import { useSidebar } from '@/components/ui/sidebar';

const MIN_PANEL_WIDTH = 320;
const MIN_CHAT_WIDTH = 300;
const DEFAULT_PANEL_WIDTH = 960;

export function SidePanel() {
  const tabs = useSidePanelStore((state) => state.tabs);
  const activeTabId = useSidePanelStore((state) => state.activeTabId);
  const isPanelOpen = useSidePanelStore((state) => state.isPanelOpen);
  const closeTab = useSidePanelStore((state) => state.closeTab);
  const setActiveTab = useSidePanelStore((state) => state.setActiveTab);
  const closePanel = useSidePanelStore((state) => state.closePanel);

  const { setOpen: setSidebarOpen } = useSidebar();

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  // Keep legacy behavior for server preview: hide left sidebar while server tab is active.
  useEffect(() => {
    if (isPanelOpen && activeTab?.type === 'server') {
      setSidebarOpen(false);
    }
  }, [isPanelOpen, activeTab, setSidebarOpen]);

  const [width, setWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [iframeKey, setIframeKey] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const maxWidthRef = useRef(DEFAULT_PANEL_WIDTH * 2);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      setIsDragging(true);
      startX.current = e.clientX;
      startWidth.current = width;

      maxWidthRef.current = containerRef.current?.parentElement
        ? containerRef.current.parentElement.clientWidth - MIN_CHAT_WIDTH
        : DEFAULT_PANEL_WIDTH * 2;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isResizing.current) return;

        const delta = startX.current - ev.clientX;
        const nextWidth = Math.min(
          maxWidthRef.current,
          Math.max(MIN_PANEL_WIDTH, startWidth.current + delta)
        );

        setWidth(nextWidth);
      };

      const handleMouseUp = () => {
        isResizing.current = false;
        setIsDragging(false);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [width]
  );

  const handleReload = () => {
    setIframeKey((value) => value + 1);
  };

  const handleOpenExternal = () => {
    if (activeTab?.type === 'server') {
      void window.levante.openExternal(activeTab.url);
    }
  };

  if (!isPanelOpen || tabs.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef} className="flex shrink-0 h-full" style={{ width }}>
      <div
        className="w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors shrink-0 h-full"
        onMouseDown={handleMouseDown}
      />

      <div className="flex-1 flex flex-col border-l bg-background overflow-hidden">
        <PanelTabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={setActiveTab}
          onCloseTab={closeTab}
          onClosePanel={closePanel}
          activeTab={activeTab}
          onReload={handleReload}
          onOpenExternal={handleOpenExternal}
        />

        <PanelContextBar tab={activeTab} />

        <PanelContent tab={activeTab} isDragging={isDragging} iframeKey={iframeKey} />
      </div>
    </div>
  );
}
```

## 7) Archivos modificados

### 7.1 Reemplazar completo `src/renderer/hooks/useWebPreview.ts`
```ts
/**
 * useWebPreview hook
 *
 * Subscribes to port detection events and task status changes
 * to keep the side panel store in sync.
 */

import { useEffect } from 'react';
import { useSidePanelStore } from '@/stores/sidePanelStore';

export function useWebPreview() {
  const addServerTab = useSidePanelStore((state) => state.addServerTab);
  const removeServerTab = useSidePanelStore((state) => state.removeServerTab);

  useEffect(() => {
    const unsubscribe = window.levante.tasks.onPortDetected((data) => {
      addServerTab({
        id: data.taskId,
        port: data.port,
        url: `http://localhost:${data.port}`,
        command: data.command,
        description: data.description,
        detectedAt: Date.now(),
        isAlive: true,
      });
    });

    return unsubscribe;
  }, [addServerTab]);

  // Reconcile with running tasks and remove finished server tabs.
  useEffect(() => {
    let mounted = true;

    const reconcileServers = async () => {
      try {
        const result = await window.levante.tasks.list({ status: 'running' });
        if (!mounted || !result.success) return;

        const runningTaskIds = new Set(
          Array.isArray(result.data)
            ? result.data.map((task: { id: string }) => task.id)
            : []
        );

        const serverTabs = useSidePanelStore.getState().getServerTabs();
        for (const server of serverTabs) {
          if (!runningTaskIds.has(server.id)) {
            removeServerTab(server.id);
          }
        }
      } catch {
        // Ignore transient IPC errors; next interval retries.
      }
    };

    void reconcileServers();
    const intervalId = window.setInterval(() => {
      void reconcileServers();
    }, 3000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [removeServerTab]);
}
```

### 7.2 Reemplazar completo `src/renderer/components/chat/WebPreviewButton.tsx`
```ts
/**
 * WebPreviewButton
 *
 * Toolbar button for toggling the unified side panel.
 */

import { Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useSidePanelStore } from '@/stores/sidePanelStore';

interface WebPreviewButtonProps {
  className?: string;
}

export function WebPreviewButton({ className }: WebPreviewButtonProps) {
  const tabs = useSidePanelStore((state) => state.tabs);
  const isPanelOpen = useSidePanelStore((state) => state.isPanelOpen);
  const openPanel = useSidePanelStore((state) => state.openPanel);
  const closePanel = useSidePanelStore((state) => state.closePanel);

  const serverTabs = tabs.filter((tab) => tab.type === 'server');
  const fileTabs = tabs.filter((tab) => tab.type === 'file');
  const aliveServers = serverTabs.filter((tab) => tab.isAlive);

  // Hide only when there are no tabs at all
  if (tabs.length === 0) {
    return null;
  }

  const title = isPanelOpen
    ? 'Close side panel'
    : serverTabs.length > 0
      ? `Web preview (${aliveServers.length} server${aliveServers.length !== 1 ? 's' : ''})`
      : `Open side panel (${fileTabs.length} file tab${fileTabs.length !== 1 ? 's' : ''})`;

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        'relative rounded-lg h-8 w-8',
        isPanelOpen ? 'text-primary bg-primary/10' : 'text-muted-foreground',
        className
      )}
      onClick={() => (isPanelOpen ? closePanel() : openPanel())}
      title={title}
      type="button"
    >
      <Monitor size={16} />

      {aliveServers.length > 0 && !isPanelOpen && (
        <>
          <Badge
            variant="default"
            className="absolute -top-1 -right-1 h-4 min-w-4 px-1 flex items-center justify-center text-[10px] bg-green-500 border-0"
          >
            {aliveServers.length}
          </Badge>

          <span className="absolute -top-0.5 -right-0.5 w-2 h-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          </span>
        </>
      )}
    </Button>
  );
}
```

### 7.3 Reemplazar completo `src/renderer/components/chat/WebPreviewToast.tsx`
```ts
/**
 * WebPreviewToast
 *
 * Non-blocking notification when a new server is detected.
 */

import { useEffect } from 'react';
import { Monitor, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSidePanelStore } from '@/stores/sidePanelStore';

export function WebPreviewToast() {
  const pendingToast = useSidePanelStore((state) => state.pendingToast);
  const clearToast = useSidePanelStore((state) => state.clearToast);
  const openPanel = useSidePanelStore((state) => state.openPanel);

  useEffect(() => {
    if (!pendingToast) return;

    const timer = setTimeout(() => {
      clearToast();
    }, 6000);

    return () => clearTimeout(timer);
  }, [pendingToast, clearToast]);

  if (!pendingToast) return null;

  return (
    <div
      className={cn(
        'fixed bottom-24 right-4 z-50',
        'flex items-center gap-3 px-4 py-3',
        'bg-background border rounded-xl shadow-lg',
        'animate-in slide-in-from-bottom-4 fade-in duration-300'
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
        <Monitor size={14} className="text-muted-foreground shrink-0" />
        <span>
          Servidor detectado en{' '}
          <code className="font-mono text-primary">:{pendingToast.port}</code>
        </span>
      </div>

      <Button
        size="sm"
        className="h-7 text-xs"
        onClick={() => {
          clearToast();
          openPanel(pendingToast.id);
        }}
      >
        Ver preview
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={clearToast}
      >
        <X size={12} />
      </Button>
    </div>
  );
}
```

### 7.4 Modificar `src/renderer/pages/ChatPage.tsx`
Aplicar este patch literal:

```diff
@@
-import { WebPreviewPanel } from '@/components/chat/WebPreviewPanel';
+import { SidePanel } from '@/components/chat/SidePanel';
@@
-        <WebPreviewPanel />
+        <SidePanel />
```

### 7.5 Modificar `src/renderer/components/file-browser/FileBrowserContent.tsx`
Aplicar este patch literal:

```diff
@@
 import { Button } from '@/components/ui/button';
 import { useFileBrowserStore, type DirectoryEntry } from '@/stores/fileBrowserStore';
+import { useSidePanelStore } from '@/stores/sidePanelStore';
 import { FileTreeNode } from './FileTreeNode';
 import { useTranslation } from 'react-i18next';
@@
 export function FileBrowserContent({ searchQuery, cwd }: FileBrowserContentProps) {
   const { t } = useTranslation('chat');
+  const openFileTab = useSidePanelStore((state) => state.openFileTab);
   const {
     entries,
@@
   const handleItemClick = (entry: DirectoryEntry) => {
     if (entry.type === 'directory') {
       toggleDirectory(entry.path);
       return;
     }
 
-    void window.levante.openExternal(`file://${entry.path}`);
+    void openFileTab(entry.path);
   };
```

### 7.6 Reemplazar completo `src/renderer/components/file-browser/index.ts`
```ts
export { FileBrowserContent } from './FileBrowserContent';
export { FileTreeNode } from './FileTreeNode';
export { CodeViewer } from './CodeViewer';
export { MarkdownRenderer } from './MarkdownRenderer';
export { FileContentRenderer } from './FileContentRenderer';
export { BinaryFileState } from './BinaryFileState';
```

## 8) Eliminación de archivos deprecados
Ejecutar solo después de verificar que compila y funciona:

```bash
rm src/renderer/stores/webPreviewStore.ts
rm src/renderer/components/chat/WebPreviewPanel.tsx
```

Verificar que no quedan referencias:

```bash
rg -n "webPreviewStore|WebPreviewPanel" src/
```

Resultado esperado: sin coincidencias.

## 9) Verificación funcional obligatoria
1. **Server preview**: al detectar puerto en task, aparece toast y abre panel con iframe.
2. **Tabs de servidor**: se ven en barra unificada y el botón de toolbar mantiene badge para servidores vivos.
3. **Tabs de archivo**: click en archivo del file tree abre tab con contenido.
4. **Convivencia**: server tabs y file tabs coexisten en la misma barra.
5. **Markdown**: `.md` renderiza headers, listas, tablas y bloques de código.
6. **Código**: syntax highlighting y line numbers.
7. **Binarios**: placeholder `Binary file`.
8. **Cerrar tabs**: tabs de archivo se cierran con `X`; tabs de servidor no.
9. **LRU real**: al abrir >10 archivos, se cierra el menos recientemente usado.
10. **Sidebar behavior**: con tab activa de tipo server, sidebar izquierdo se cierra; con file no.
11. **Resize**: drag handle sigue funcionando.
12. **Toggle panel**: `WebPreviewButton` permite reabrir panel cuando solo hay file tabs.
13. **Seguridad**: no hay uso de `openExternal('file://...')` en el panel/file-browser.

## 10) Verificación técnica obligatoria
Ejecutar:

```bash
pnpm typecheck
pnpm lint
```

## 11) Orden de implementación recomendado
1. Crear carpetas (`mkdir -p ...`).
2. Crear 12 archivos nuevos con contenido completo (sección 6).
3. Aplicar 6 modificaciones de la sección 7.
4. Ejecutar `pnpm typecheck` y `pnpm lint`.
5. Ejecutar checklist funcional (sección 9).
6. Eliminar archivos deprecados (sección 8).
7. Verificar con `rg` que no queden imports viejos.

## 12) Extensiones futuras (fuera de este runbook)
- PDF real (`react-pdf`) con nuevo `PdfViewer`.
- DOCX real (`mammoth + dompurify`) con `DocViewer`.
- Acción segura “Abrir archivo en editor externo” vía IPC dedicada (no `file://`).
