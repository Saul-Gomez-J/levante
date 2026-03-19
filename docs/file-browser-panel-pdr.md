# PDR: File Browser & Unified Preview Panel

## Product Design Review - Explorador de Archivos con Panel Unificado de Tabs

**Fecha**: 2026-03-06
**Estado**: Draft v2
**Autor**: Equipo Levante

---

## 1. Resumen Ejecutivo

Extender el panel lateral derecho existente (`WebPreviewPanel`) para convertirlo en un **panel unificado de tabs** donde conviven servidores web, archivos de código, markdown, y en el futuro PDFs y documentos.

- **Panel izquierdo (sidebar)**: Navegador de sistema de archivos tipo árbol (file tree)
- **Panel derecho (tabs unificadas)**: Las tabs de servidores (`:5173`, `:3000`) coexisten en la **misma barra** con tabs de archivos (`App.tsx`, `README.md`), y en el futuro con tabs de PDFs y Docs
- **Renderizado rico**: Markdown formateado, syntax highlighting para Python, JS, TS, JSX/TSX
- **Extensible**: Arquitectura de renderers pluggable para soportar nuevos tipos de contenido (PDF, DOCX, imágenes)

### Cambio clave respecto a v1 del PDR

En lugar de crear un sistema de tabs de nivel superior que separe "Web Preview" y "File Viewer" como dos modos, se **unifica todo en la misma barra de tabs** existente. Las tabs de servidores y archivos conviven lado a lado, igual que en un navegador con múltiples tipos de pestañas.

---

## 2. Motivación y Contexto

### Problema

Los usuarios de Levante no tienen forma visual de explorar el sistema de archivos del proyecto. La única interacción con archivos es indirecta, a través del AI agent. Los usuarios necesitan:

1. Ver la estructura de archivos del proyecto en el que trabajan
2. Seleccionar y visualizar contenido de archivos rápidamente
3. Ver Markdown renderizado y código con syntax highlighting
4. Navegar el proyecto sin salir de la aplicación

### Valor

- Mejora la experiencia al proporcionar contexto visual del proyecto
- Reduce cambios de contexto entre Levante y el explorador de archivos del SO
- Facilita la referencia de archivos durante conversaciones con el AI
- La arquitectura unificada permite agregar renderers para PDFs, Docs, imágenes sin cambios estructurales

---

## 3. Diseño de Tabs Unificadas

### 3.1 Estado Actual vs Propuesta

**Estado actual** — Solo tabs de servidores:
```
[ 🟢 :5173 ]  [ 🟢 :3000 ]                              🔄 🔗 ✕
──────────────────────────────────────────────────────────────────
  http://localhost:5173
──────────────────────────────────────────────────────────────────
  <iframe con preview del servidor>
```

**Propuesta** — Tabs unificadas (servidores + archivos):
```
[ 🟢 :5173 ]  [ 📄 App.tsx ✕ ]  [ 📝 README.md ✕ ]       🔄 🔗 ✕
──────────────────────────────────────────────────────────────────
  src/renderer/App.tsx                                    📋 ↗
──────────────────────────────────────────────────────────────────
  <contenido del archivo con syntax highlighting>
```

**Futuro** — Con PDFs y Docs:
```
[ 🟢 :5173 ]  [ 📄 App.tsx ✕ ]  [ 📕 manual.pdf ✕ ]  [ 📘 spec.docx ✕ ]
──────────────────────────────────────────────────────────────────────────
  docs/manual.pdf                                        🔍 📋 ↗
──────────────────────────────────────────────────────────────────────────
  <visor de PDF con paginación y zoom>
```

### 3.2 Modelo de Datos de Tab

```typescript
// Tipo unión que representa cualquier tab del panel
type PanelTab =
  | ServerTab
  | FileTab
  | PdfTab      // Futuro (Fase 5)
  | DocTab;     // Futuro (Fase 6)

interface ServerTab {
  type: 'server';
  id: string;           // taskId del background task
  port: number;
  url: string;
  command: string;
  description?: string;
  isAlive: boolean;
  detectedAt: number;
}

interface FileTab {
  type: 'file';
  id: string;           // path absoluto (único)
  filePath: string;
  fileName: string;     // basename para mostrar en tab
  language: string;     // lenguaje detectado por extensión
  content: string | null;      // contenido cargado (null = loading)
  isLoading: boolean;
  isBinary: boolean;
  isTruncated: boolean;
}

// --- FUTURO ---

interface PdfTab {
  type: 'pdf';
  id: string;
  filePath: string;
  fileName: string;
  currentPage: number;
  totalPages: number;
}

interface DocTab {
  type: 'doc';
  id: string;
  filePath: string;
  fileName: string;
  htmlContent: string | null;  // Convertido a HTML para renderizar
  isLoading: boolean;
}
```

### 3.3 Diferencias entre Tipos de Tab

| Aspecto | Server Tab | File Tab | PDF Tab (futuro) | Doc Tab (futuro) |
|---------|-----------|----------|-------------------|-------------------|
| **Se crea cuando** | Se detecta puerto en task | Usuario selecciona archivo en tree | Usuario abre .pdf | Usuario abre .docx/.doc |
| **Se cierra cuando** | Task termina (auto) | Usuario cierra tab (manual) | Usuario cierra tab | Usuario cierra tab |
| **Tiene botón ✕** | No (ciclo de vida automático) | Sí | Sí | Sí |
| **Contenido** | iframe → localhost:port | Markdown renderizado o código | Visor PDF (react-pdf) | HTML convertido (mammoth) |
| **Barra contextual** | URL bar + estado alive/dead | Path relativo del archivo | Path + página actual | Path del documento |
| **Controles** | Reload + Abrir en browser | Copiar path + Abrir en editor | Zoom + Paginación | Copiar path + Abrir externo |
| **Indicador visual** | Punto verde/rojo + `:puerto` | Icono de archivo + nombre | Icono PDF + nombre | Icono Doc + nombre |

### 3.4 Layout General

```
+----------------------------+----------------------------+---------------------------+
|                            |                            |                           |
|  SIDEBAR (left)            |      CHAT AREA             |    PANEL UNIFICADO        |
|                            |                            |                           |
| ┌────────────────────────┐ |                            | ┌───────────────────────┐ |
| │ + New Conversation     │ |                            | │ [🟢:5173] [📄App.tsx✕]│ |
| │ 🔍 Search...           │ |                            | │ [📝README.md✕]  🔄🔗✕│ |
| ├────────────────────────┤ |   Mensajes del chat        | ├───────────────────────┤ |
| │ [💬 Chats] [📁 Files]  │ |                            | │ src/renderer/App.tsx  │ |
| ├────────────────────────┤ |                            | ├───────────────────────┤ |
| │                        │ |                            | │                       │ |
| │  📁 src                │ |                            | │ import React from ... │ |
| │    📁 components       │ |                            | │ import { App } from . │ |
| │      📄 Button.tsx     │ |                            | │ ...                   │ |
| │      📄 Header.tsx     │ |                            | │                       │ |
| │    📄 App.tsx          │ |                            | │ (código con syntax    │ |
| │    📄 index.ts         │ |                            | │  highlighting y       │ |
| │  📁 public             │ |                            | │  números de línea)    │ |
| │  📄 package.json       │ |                            | │                       │ |
| │  📄 README.md          │ |                            | │                       │ |
| │                        │ |                            | └───────────────────────┘ |
| └────────────────────────┘ |  +--------------------+    |                           |
|                            |  | Input del chat     |    |                           |
+----------------------------+----------------------------+---------------------------+
```

**Sin Cowork mode** (tab bar oculta, sidebar funciona igual que ahora):

```
┌────────────────────────┐
│ + New Conversation     │
│ 🔍 Search...           │
├────────────────────────┤
│ PROJECTS               │  ← sin tab bar, directo al contenido
│ 📁 Mi proyecto         │
│────────────────────────│
│ CONVERSATIONS          │
│ Today                  │
│  💬 Chat sobre API     │
│  💬 Fix del bug        │
│ Yesterday              │
│  💬 Refactor auth      │
└────────────────────────┘
```

**Con Cowork mode activo** — tab "Chats" seleccionada:

```
┌────────────────────────┐
│ + New Conversation     │
│ 🔍 Search...           │
├────────────────────────┤
│ [💬 Chats] [📁 Files]  │  ← tab bar visible (solo con Cowork activo + CWD)
├────────────────────────┤
│ PROJECTS               │
│ 📁 Mi proyecto         │
│────────────────────────│
│ CONVERSATIONS          │
│ Today                  │
│  💬 Chat sobre API     │
│  💬 Fix del bug        │
│ Yesterday              │
│  💬 Refactor auth      │
└────────────────────────┘
```

**Con Cowork mode activo** — tab "Files" seleccionada:

```
┌────────────────────────┐
│ + New Conversation     │
│ 🔍 Search...           │
├────────────────────────┤
│ [💬 Chats] [📁 Files]  │
├────────────────────────┤
│ /my-project       🔄 👁│
│────────────────────────│
│ 📁 src                 │
│   📁 components        │
│     📄 Button.tsx      │
│     📄 Header.tsx      │
│   📄 App.tsx           │
│   📄 index.ts          │
│ 📁 public              │
│ 📄 package.json        │
│ 📄 README.md           │
└────────────────────────┘
```

---

## 4. Arquitectura por Capas

### 4.1 Diagrama de Arquitectura

```
+-------------------------------------------------------------------+
|                        MAIN PROCESS                                |
|                                                                    |
|  FileSystemService (NUEVO)                                         |
|  - readDirectory(path): DirectoryEntry[]                           |
|  - readFile(path): FileContent                                     |
|  - readBinaryFile(path): Buffer  (futuro: PDF/imágenes)            |
|  - watchDirectory(path): FSWatcher                                 |
|  - getWorkingDirectory(): string                                   |
|  - Validación de paths (seguridad)                                 |
|                                                                    |
|  BackgroundTaskManager (EXISTENTE, sin cambios)                    |
|  - Sigue emitiendo 'task:port-detected'                            |
|                                                                    |
|  fileSystemHandlers.ts (NUEVO)                                     |
|  - levante/fs:readDir                                              |
|  - levante/fs:readFile                                             |
|  - levante/fs:readBinary  (futuro)                                 |
|  - levante/fs:watch / levante/fs:unwatch                           |
|  - levante/fs:getWorkingDir                                        |
+----------------------------+--------------------------------------+
                             |
                             | IPC (levante/fs:* + levante/tasks:*)
                             |
+----------------------------+--------------------------------------+
|            PRELOAD BRIDGE (Context Bridge)                         |
|  preload/api/filesystem.ts (NUEVO)                                 |
|  - window.levante.fs.readDir(path)                                 |
|  - window.levante.fs.readFile(path)                                |
|  - window.levante.fs.watch(path, callback)                         |
|  - window.levante.fs.getWorkingDir()                               |
|                                                                    |
|  preload/api/tasks.ts (EXISTENTE, sin cambios)                     |
|  - window.levante.tasks.onPortDetected(callback)                   |
+----------------------------+--------------------------------------+
                             |
+----------------------------+--------------------------------------+
|               RENDERER PROCESS (UI)                                |
|                                                                    |
|  useSidePanelStore (NUEVO - reemplaza webPreviewStore)             |
|  +-- tabs: PanelTab[]           (servidores + archivos + futuro)   |
|  +-- activeTabId: string | null                                    |
|  +-- isPanelOpen: boolean                                          |
|  +-- pendingToast: ServerTab | null                                |
|  +-- Actions: addServerTab, addFileTab, closeTab, etc.             |
|                                                                    |
|  useFileBrowserStore (NUEVO)                                       |
|  +-- workingDirectory, entries, expandedDirs                       |
|  +-- Actions: loadDirectory, toggleDirectory, etc.                 |
|                                                                    |
|  Componentes:                                                      |
|  +-- SidePanel (REFACTORIZADO desde WebPreviewPanel)               |
|  |   +-- PanelTabBar (tabs unificadas: servers + files)            |
|  |   +-- PanelContextBar (URL bar o file path según tab activa)    |
|  |   +-- PanelContent (despacha al renderer correcto)              |
|  |       +-- ServerContent (iframe, existente)                     |
|  |       +-- FileContent (NUEVO)                                   |
|  |       |   +-- MarkdownRenderer                                  |
|  |       |   +-- CodeViewer                                        |
|  |       +-- PdfContent (FUTURO)                                   |
|  |       +-- DocContent (FUTURO)                                   |
|  +-- FileBrowserSidebar (NUEVO, en sidebar izquierdo)              |
|  +-- WebPreviewToast (EXISTENTE, sin cambios conceptuales)         |
+-------------------------------------------------------------------+
```

### 4.2 Main Process - FileSystemService

**Archivo**: `src/main/services/filesystem/fileSystemService.ts`

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import { FSWatcher, watch } from 'node:fs';

interface DirectoryEntry {
  name: string;           // Nombre del archivo/directorio
  path: string;           // Path absoluto
  type: 'file' | 'directory' | 'symlink';
  size: number;           // Tamaño en bytes (solo archivos)
  extension: string;      // Extensión sin punto
  modifiedAt: number;     // Timestamp última modificación
  isHidden: boolean;      // Empieza con punto
}

interface FileContent {
  path: string;
  content: string;        // Contenido como texto
  encoding: string;       // 'utf-8' por defecto
  size: number;           // Tamaño en bytes
  language: string;       // Lenguaje detectado por extensión
  isBinary: boolean;      // true si es archivo binario
  isTruncated: boolean;   // true si se truncó por tamaño
}

interface ReadDirOptions {
  showHidden?: boolean;   // Default: false
  sortBy?: 'name' | 'type' | 'modified'; // Default: 'type'
}

interface ReadFileOptions {
  maxSize?: number;       // Default: 1MB
  encoding?: BufferEncoding; // Default: 'utf-8'
}

class FileSystemService {
  private workingDirectory: string | null = null;
  private watchers: Map<string, FSWatcher> = new Map();

  private static MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB

  // Extensiones binarias (no se leen como texto)
  // Nota: PDF y DOCX son binarios pero se manejan con renderers específicos
  private static BINARY_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp',
    'mp3', 'mp4', 'wav', 'avi', 'mov',
    'zip', 'tar', 'gz', 'rar', '7z',
    'exe', 'dll', 'so', 'dylib',
    'woff', 'woff2', 'ttf', 'eot',
    'sqlite', 'db',
  ]);

  // Extensiones que requieren lectura binaria para renderers especiales
  private static SPECIAL_BINARY_EXTENSIONS = new Set([
    'pdf',                    // Futuro: react-pdf
    'doc', 'docx',           // Futuro: mammoth
    'xls', 'xlsx',           // Futuro: xlsx
    'svg',                   // Puede renderizarse como imagen
  ]);

  setWorkingDirectory(dir: string): void;
  getWorkingDirectory(): string | null;

  async readDirectory(dirPath: string, options?: ReadDirOptions): Promise<DirectoryEntry[]>;
  async readFile(filePath: string, options?: ReadFileOptions): Promise<FileContent>;

  // Futuro: lectura binaria para PDF/Docs
  async readBinaryFile(filePath: string, maxSize?: number): Promise<{
    path: string;
    buffer: Buffer;
    size: number;
    extension: string;
  }>;

  watchDirectory(dirPath: string, callback: (event: string, filename: string) => void): string;
  unwatchDirectory(watchId: string): void;

  // Seguridad
  private validatePath(requestedPath: string): string;
  private isPathAllowed(resolvedPath: string): boolean;
  private detectLanguage(extension: string): string;
  private getContentCategory(extension: string): 'text' | 'binary' | 'pdf' | 'document' | 'image';

  dispose(): void;
}
```

**Categorización de archivos por extensión** (clave para routing de renderers):

```typescript
function getContentCategory(extension: string): ContentCategory {
  // Texto renderizable (código, markdown, config)
  if (LANGUAGE_MAP[extension]) return 'text';

  // PDF — renderer específico (futuro)
  if (extension === 'pdf') return 'pdf';

  // Documentos Office — renderer específico (futuro)
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(extension)) return 'document';

  // Imágenes — renderizable como <img> (futuro)
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(extension)) return 'image';

  // Binario puro — no renderizable
  return 'binary';
}
```

**Mapeo de lenguajes**:

```typescript
const LANGUAGE_MAP: Record<string, string> = {
  // JavaScript/TypeScript
  'js': 'javascript', 'jsx': 'jsx', 'ts': 'typescript', 'tsx': 'tsx',
  'mjs': 'javascript', 'cjs': 'javascript',

  // Python
  'py': 'python', 'pyw': 'python', 'pyi': 'python',

  // Web
  'html': 'html', 'css': 'css', 'scss': 'scss', 'less': 'less',

  // Data
  'json': 'json', 'yaml': 'yaml', 'yml': 'yaml',
  'toml': 'toml', 'xml': 'xml',

  // Markdown
  'md': 'markdown', 'mdx': 'markdown',

  // Shell/Config
  'env': 'shell', 'sh': 'shell', 'bash': 'shell', 'zsh': 'shell',

  // Otros
  'sql': 'sql', 'graphql': 'graphql', 'dockerfile': 'dockerfile',
  'rs': 'rust', 'go': 'go', 'java': 'java', 'swift': 'swift',
  'kt': 'kotlin', 'rb': 'ruby', 'php': 'php',
  'c': 'c', 'cpp': 'cpp', 'h': 'c', 'hpp': 'cpp',
};
```

### 4.3 IPC Handlers

**Archivo**: `src/main/ipc/fileSystemHandlers.ts`

```typescript
const CHANNELS = {
  READ_DIR:        'levante/fs:readDir',
  READ_FILE:       'levante/fs:readFile',
  READ_BINARY:     'levante/fs:readBinary',     // Futuro
  GET_WORKING_DIR: 'levante/fs:getWorkingDir',
  WATCH:           'levante/fs:watch',
  UNWATCH:         'levante/fs:unwatch',
  // Push events (main → renderer)
  FS_CHANGED:      'levante/fs:changed',
} as const;

// Handler: levante/fs:readDir
// Input: { path: string, options?: ReadDirOptions }
// Output: { success: true, data: DirectoryEntry[] }

// Handler: levante/fs:readFile
// Input: { path: string, options?: ReadFileOptions }
// Output: { success: true, data: FileContent }

// Handler: levante/fs:readBinary (FUTURO)
// Input: { path: string, maxSize?: number }
// Output: { success: true, data: { base64: string, size: number, extension: string } }

// Handler: levante/fs:getWorkingDir
// Input: void
// Output: { success: true, data: string | null }

// Handler: levante/fs:watch
// Input: { path: string }
// Output: { success: true, data: { watchId: string } }
// Push: levante/fs:changed cuando detecta cambios (debounced 300ms)

// Handler: levante/fs:unwatch
// Input: { watchId: string }
// Output: { success: true }
```

### 4.4 Preload API

**Archivo**: `src/preload/api/filesystem.ts`

```typescript
export const filesystemApi = {
  readDir: (path: string, options?: ReadDirOptions) =>
    ipcRenderer.invoke('levante/fs:readDir', { path, options }),

  readFile: (path: string, options?: ReadFileOptions) =>
    ipcRenderer.invoke('levante/fs:readFile', { path, options }),

  // Futuro: lectura binaria para PDF/Docs
  readBinary: (path: string, maxSize?: number) =>
    ipcRenderer.invoke('levante/fs:readBinary', { path, maxSize }),

  getWorkingDir: () =>
    ipcRenderer.invoke('levante/fs:getWorkingDir'),

  watch: (path: string, callback: (event: string, filename: string) => void) => {
    const handler = (_: unknown, data: { path: string; event: string; filename: string }) => {
      if (data.path === path) callback(data.event, data.filename);
    };
    ipcRenderer.on('levante/fs:changed', handler);
    return () => ipcRenderer.removeListener('levante/fs:changed', handler);
  },
};
```

**Registro en `preload.ts`**:

```typescript
contextBridge.exposeInMainWorld('levante', {
  // ... APIs existentes (tasks, chat, preferences, etc.) ...
  fs: filesystemApi,  // NUEVO
});
```

### 4.5 Zustand Stores

#### 4.5.1 useSidePanelStore (reemplaza webPreviewStore)

**Archivo**: `src/renderer/stores/sidePanelStore.ts`

```typescript
import { create } from 'zustand';

interface SidePanelState {
  // Tabs unificadas
  tabs: PanelTab[];               // Todas las tabs (servers + files + futuro)
  activeTabId: string | null;     // Tab actualmente visible
  isPanelOpen: boolean;

  // Toast (heredado de webPreviewStore)
  pendingToast: ServerTab | null;

  // --- Acciones de tabs genéricas ---
  setActiveTab(tabId: string): void;
  closeTab(tabId: string): void;    // Cierra una tab (solo file/pdf/doc, no server)
  openPanel(tabId?: string): void;
  closePanel(): void;
  clearToast(): void;

  // --- Acciones específicas de Server Tabs ---
  addServerTab(server: Omit<ServerTab, 'type'>): void;   // Desde port detection
  markServerDead(taskId: string): void;
  removeServerTab(taskId: string): void;                  // Auto cuando task muere

  // --- Acciones específicas de File Tabs ---
  openFileTab(filePath: string): Promise<void>;  // Abre o focaliza tab existente
  updateFileContent(filePath: string, content: string): void;

  // --- Futuro ---
  // openPdfTab(filePath: string): Promise<void>;
  // openDocTab(filePath: string): Promise<void>;
}
```

**Comportamiento clave**:

```typescript
// openFileTab: abre archivo en nueva tab o focaliza si ya está abierto
openFileTab: async (filePath) => {
  const existing = get().tabs.find(t => t.type === 'file' && t.filePath === filePath);
  if (existing) {
    // Ya abierto → solo focalizar
    set({ activeTabId: existing.id, isPanelOpen: true });
    return;
  }

  // Crear tab con loading
  const fileName = path.basename(filePath);
  const extension = path.extname(filePath).slice(1);
  const newTab: FileTab = {
    type: 'file',
    id: filePath,
    filePath,
    fileName,
    language: detectLanguage(extension),
    content: null,
    isLoading: true,
    isBinary: false,
    isTruncated: false,
  };

  set(state => ({
    tabs: [...state.tabs, newTab],
    activeTabId: newTab.id,
    isPanelOpen: true,
  }));

  // Cargar contenido
  const result = await window.levante.fs.readFile(filePath);
  if (result.success) {
    set(state => ({
      tabs: state.tabs.map(t =>
        t.id === filePath
          ? { ...t, content: result.data.content, isLoading: false,
              isBinary: result.data.isBinary, isTruncated: result.data.isTruncated }
          : t
      ),
    }));
  }
},

// closeTab: solo tabs cerrables (file, pdf, doc), no servers
closeTab: (tabId) => {
  const tab = get().tabs.find(t => t.id === tabId);
  if (!tab || tab.type === 'server') return; // Servers no se cierran manualmente

  set(state => {
    const newTabs = state.tabs.filter(t => t.id !== tabId);
    const needNewActive = state.activeTabId === tabId;
    return {
      tabs: newTabs,
      activeTabId: needNewActive ? (newTabs[newTabs.length - 1]?.id ?? null) : state.activeTabId,
      isPanelOpen: newTabs.length > 0 ? state.isPanelOpen : false,
    };
  });
},
```

#### 4.5.2 useFileBrowserStore

**Archivo**: `src/renderer/stores/fileBrowserStore.ts`

```typescript
interface FileBrowserState {
  // Explorador
  workingDirectory: string | null;
  entries: Map<string, DirectoryEntry[]>;  // Cache por directorio
  expandedDirs: Set<string>;

  // UI
  isLoadingDir: boolean;
  error: string | null;
  showHiddenFiles: boolean;
  searchQuery: string;

  // Acciones
  initialize(): Promise<void>;
  loadDirectory(path: string): Promise<void>;
  toggleDirectory(path: string): void;
  refreshDirectory(path: string): void;
  setShowHidden(show: boolean): void;
  setSearchQuery(query: string): void;
  clearError(): void;
}
```

**Nota**: Este store solo maneja el file tree. Al seleccionar un archivo, llama a `useSidePanelStore.openFileTab(path)` para abrir la tab en el panel derecho. Separación de concerns clara.

---

## 5. Componentes de UI

### 5.1 SidePanel (refactorizado desde WebPreviewPanel)

**Archivo**: `src/renderer/components/chat/SidePanel.tsx`

Reemplaza `WebPreviewPanel.tsx`. Mantiene toda la lógica de resize y layout, pero con tabs unificadas.

```typescript
export function SidePanel() {
  const { tabs, activeTabId, isPanelOpen, closeTab, setActiveTab, closePanel } =
    useSidePanelStore();
  const { setOpen: setSidebarOpen } = useSidebar();

  // Solo cerrar sidebar si la tab activa es un server (comportamiento original)
  useEffect(() => {
    if (isPanelOpen) {
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (activeTab?.type === 'server') {
        setSidebarOpen(false);
      }
    }
  }, [isPanelOpen, activeTabId]);

  const [width, setWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  // ... misma lógica de resize que WebPreviewPanel actual ...

  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0];

  if (!isPanelOpen || tabs.length === 0) return null;

  return (
    <div ref={containerRef} className="flex shrink-0 h-full" style={{ width }}>
      {/* Handle de resize (igual que ahora) */}
      <div className="w-1 cursor-col-resize ..." onMouseDown={handleMouseDown} />

      <div className="flex-1 flex flex-col border-l bg-background overflow-hidden">
        {/* Header con tabs unificadas */}
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

        {/* Barra contextual (cambia según tipo de tab) */}
        <PanelContextBar tab={activeTab} />

        {/* Contenido (despacha al renderer correcto) */}
        <PanelContent tab={activeTab} isDragging={isDragging} />
      </div>
    </div>
  );
}
```

### 5.2 PanelTabBar

**Archivo**: `src/renderer/components/chat/panel/PanelTabBar.tsx`

```typescript
function PanelTabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onClosePanel, ... }) {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b shrink-0 bg-muted/30">
      {/* Icono del panel */}
      <Monitor size={13} className="text-muted-foreground shrink-0" />

      {/* Tabs unificadas con scroll horizontal */}
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

      {/* Controles (cambian según tab activa) */}
      <PanelControls tab={activeTab} onReload={onReload} onOpenExternal={onOpenExternal} onClose={onClosePanel} />
    </div>
  );
}
```

### 5.3 TabChip (reemplaza ServerTab)

```typescript
function TabChip({ tab, isActive, onSelect, onClose }: {
  tab: PanelTab;
  isActive: boolean;
  onSelect: () => void;
  onClose?: () => void;  // undefined para server tabs (no cerrables)
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors shrink-0 group',
        isActive
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
      title={tab.type === 'server' ? tab.command : tab.filePath}
    >
      <TabIcon tab={tab} />
      <TabLabel tab={tab} />

      {/* Botón cerrar (solo tabs cerrables) */}
      {onClose && (
        <span
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="ml-1 opacity-0 group-hover:opacity-100 hover:bg-primary-foreground/20 rounded-sm"
        >
          <X size={10} />
        </span>
      )}
    </button>
  );
}

function TabIcon({ tab }: { tab: PanelTab }) {
  switch (tab.type) {
    case 'server':
      return (
        <span className={cn(
          'w-1.5 h-1.5 rounded-full shrink-0',
          tab.isAlive ? 'bg-green-400' : 'bg-red-400'
        )} />
      );
    case 'file':
      return <FileIcon extension={tab.language} className="h-3 w-3 shrink-0" />;
    case 'pdf':   // Futuro
      return <FileText className="h-3 w-3 shrink-0 text-red-400" />;
    case 'doc':   // Futuro
      return <FileText className="h-3 w-3 shrink-0 text-blue-400" />;
  }
}

function TabLabel({ tab }: { tab: PanelTab }) {
  switch (tab.type) {
    case 'server':
      return (
        <>
          <span>:{tab.port}</span>
          {!tab.isAlive && (
            <Badge variant="outline" className="text-[9px] py-0 px-1 h-3.5">stopped</Badge>
          )}
        </>
      );
    case 'file':
    case 'pdf':
    case 'doc':
      return <span className="max-w-[120px] truncate">{tab.fileName}</span>;
  }
}
```

### 5.4 PanelContextBar

Barra debajo de las tabs que muestra información contextual según el tipo de tab.

```typescript
function PanelContextBar({ tab }: { tab: PanelTab | undefined }) {
  if (!tab) return null;

  switch (tab.type) {
    case 'server':
      return (
        <div className="flex items-center gap-2 px-2 py-1 border-b bg-muted/20 shrink-0">
          <Server size={11} className="text-muted-foreground shrink-0" />
          <span className="text-xs font-mono text-muted-foreground truncate">{tab.url}</span>
          {!tab.isAlive && (
            <Badge variant="destructive" className="text-[10px] py-0 px-1.5 h-4 shrink-0">offline</Badge>
          )}
        </div>
      );

    case 'file':
      const relativePath = tab.filePath.replace(workingDir + '/', '');
      return (
        <div className="flex items-center gap-2 px-2 py-1 border-b bg-muted/20 shrink-0">
          <FileCode size={11} className="text-muted-foreground shrink-0" />
          <span className="text-xs font-mono text-muted-foreground truncate flex-1">
            {relativePath}
          </span>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={copyPath}>
            <Copy size={10} />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={openExternal}>
            <ExternalLink size={10} />
          </Button>
        </div>
      );

    case 'pdf':  // Futuro
      return (
        <div className="flex items-center gap-2 px-2 py-1 border-b bg-muted/20 shrink-0">
          <FileText size={11} className="text-muted-foreground shrink-0" />
          <span className="text-xs font-mono text-muted-foreground truncate flex-1">
            {tab.fileName}
          </span>
          <span className="text-xs text-muted-foreground">
            Página {tab.currentPage} / {tab.totalPages}
          </span>
        </div>
      );
  }
}
```

### 5.5 PanelContent (Router de Renderers)

```typescript
function PanelContent({ tab, isDragging }: { tab: PanelTab | undefined; isDragging: boolean }) {
  return (
    <div className="flex-1 relative overflow-hidden">
      {isDragging && <div className="absolute inset-0 z-50 cursor-col-resize" />}

      {!tab ? (
        <EmptyState message="No tab selected" />
      ) : (
        <ContentRenderer tab={tab} />
      )}
    </div>
  );
}

function ContentRenderer({ tab }: { tab: PanelTab }) {
  switch (tab.type) {
    case 'server':
      return <ServerContent server={tab} />;

    case 'file':
      if (tab.isLoading) return <LoadingState />;
      if (tab.isBinary) return <BinaryFileState fileName={tab.fileName} />;
      if (tab.language === 'markdown') return <MarkdownRenderer content={tab.content!} />;
      return <CodeViewer content={tab.content!} language={tab.language} />;

    case 'pdf':   // Futuro
      return <PdfViewer filePath={tab.filePath} />;

    case 'doc':   // Futuro
      return <DocViewer htmlContent={tab.htmlContent} />;

    default:
      return <EmptyState message="Unsupported content type" />;
  }
}
```

### 5.6 SidebarSections (wrapper con tab bar)

**Archivo**: `src/renderer/components/sidebar/SidebarSections.tsx`

Nuevo componente wrapper que reemplaza al `ChatList` directo en `sidebarContent`. Contiene el header fijo (New Chat + Search), el tab bar, y despacha al contenido correcto.

```
┌────────────────────────┐
│ + New Conversation     │  ← header fijo (siempre visible)
│ 🔍 Search...           │  ← search (siempre visible, filtra según tab activa)
├────────────────────────┤
│ [💬 Chats] [📁 Files]  │  ← tab bar (siempre visible)
├────────────────────────┤
│                        │
│  (contenido scrollable │  ← ChatList content O FileBrowserContent
│   según tab activa)    │
│                        │
└────────────────────────┘
```

```typescript
type SidebarSection = 'chats' | 'files';

function SidebarSections({ chatListProps }: { chatListProps: ChatListProps }) {
  const [activeSection, setActiveSection] = useState<SidebarSection>('chats');
  const [searchQuery, setSearchQuery] = useState('');

  // --- Condición de visibilidad de la tab "Files" ---
  // Solo se muestra si Cowork mode está activo Y hay un CWD configurado.
  // Se lee de las preferencias persistidas (ui-preferences.json) via hook.
  const [coworkMode] = usePreference('coworkMode');           // boolean
  const [coworkModeCwd] = usePreference('coworkModeCwd');     // string | null
  // También considerar el CWD de proyecto/sesión si aplica (effectiveCwd)
  const showFilesTab = (coworkMode ?? false) && coworkModeCwd !== null;

  // Si el usuario desactiva Cowork mientras está en la tab "Files",
  // volver automáticamente a "Chats"
  useEffect(() => {
    if (!showFilesTab && activeSection === 'files') {
      setActiveSection('chats');
    }
  }, [showFilesTab, activeSection]);

  return (
    <div className="flex flex-col h-full">
      {/* Header fijo: New Chat + Search (siempre visible) */}
      <div className="p-4 border-b shrink-0">
        <Button onClick={chatListProps.onNewChat} className="w-full mb-2">
          <Plus size={16} className="mr-2" />
          New Conversation
        </Button>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={activeSection === 'chats' ? 'Search conversations...' : 'Filter files...'}
            className="pl-8 h-8 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Tab bar: debajo del search, solo visible si hay más de una tab */}
      {showFilesTab && (
        <div className="flex border-b shrink-0">
          <button
            onClick={() => setActiveSection('chats')}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors",
              activeSection === 'chats'
                ? "text-foreground border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <MessageSquare size={13} />
            Chats
          </button>
          <button
            onClick={() => setActiveSection('files')}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors",
              activeSection === 'files'
                ? "text-foreground border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <FolderTree size={13} />
            Files
          </button>
        </div>
      )}

      {/* Contenido scrollable: solo uno visible a la vez */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {activeSection === 'chats' || !showFilesTab ? (
          <ChatListContent {...chatListProps} searchQuery={searchQuery} />
        ) : (
          <FileBrowserContent searchQuery={searchQuery} cwd={coworkModeCwd!} />
        )}
      </div>
    </div>
  );
}
```

**Decisiones clave**:

1. **Tab "Files" condicionada a Cowork mode**: La tab solo aparece si `coworkMode === true` Y hay un CWD configurado (`coworkModeCwd !== null`). Se lee de las preferencias persistidas via `usePreference('coworkMode')` y `usePreference('coworkModeCwd')`.
2. **Sin Cowork → sin tab bar visible**: Cuando Cowork está desactivado, la tab bar completa se oculta y el sidebar muestra solo el ChatList, exactamente como funciona actualmente. No hay cambio visual si el usuario no usa Cowork.
3. **Fallback automático**: Si el usuario desactiva Cowork mientras está viendo la tab "Files", un `useEffect` cambia automáticamente a la tab "Chats".
4. **CWD como prop**: El `coworkModeCwd` se pasa como prop a `FileBrowserContent` para que el file tree sepa qué directorio raíz mostrar. Esto evita que `FileBrowserContent` tenga que resolver el CWD por su cuenta.
5. **Header compartido**: "New Conversation" y el search se mantienen fijos arriba siempre visibles.
6. **Search dual**: El mismo input filtra conversaciones o archivos según la tab activa.
7. **ChatList refactorizado**: Se extrae el contenido scrollable de `ChatList` (proyectos + conversaciones) a `ChatListContent` sin header.

### 5.7 FileBrowserContent (contenido del file tree)

**Archivo**: `src/renderer/components/file-browser/FileBrowserContent.tsx`

Componente que muestra el file tree. Se renderiza **solo** cuando Cowork mode está activo y hay un CWD. Recibe el `cwd` como prop desde `SidebarSections`.

```typescript
interface FileBrowserContentProps {
  searchQuery: string;
  cwd: string;  // CWD del Cowork mode (ya validado como no-null por SidebarSections)
}

function FileBrowserContent({ searchQuery, cwd }: FileBrowserContentProps) {
  const { entries, expandedDirs, isLoadingDir, showHiddenFiles,
          loadDirectory, toggleDirectory, refreshDirectory, setShowHidden } = useFileBrowserStore();
  const { openFileTab } = useSidePanelStore();

  // Inicializar con el CWD del Cowork mode
  useEffect(() => { loadDirectory(cwd); }, [cwd, loadDirectory]);

  const handleFileClick = (entry: DirectoryEntry) => {
    if (entry.type === 'directory') {
      toggleDirectory(entry.path);
    } else {
      openFileTab(entry.path);  // Abre tab en panel derecho
    }
  };

  return (
    <div className="flex flex-col">
      {/* Toolbar del file tree */}
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground">
        <span className="truncate font-mono">{path.basename(workingDirectory)}</span>
        <div className="flex gap-0.5 shrink-0">
          <Button size="icon" variant="ghost" className="h-5 w-5"
                  onClick={() => setShowHidden(!showHiddenFiles)}
                  title={showHiddenFiles ? 'Hide hidden files' : 'Show hidden files'}>
            <Eye size={12} />
          </Button>
          <Button size="icon" variant="ghost" className="h-5 w-5"
                  onClick={() => refreshDirectory(workingDirectory)}
                  title="Refresh">
            <RefreshCw size={12} />
          </Button>
        </div>
      </div>

      {/* File tree */}
      <FileTree
        entries={entries.get(workingDirectory) ?? []}
        expandedDirs={expandedDirs}
        allEntries={entries}
        depth={0}
        onItemClick={handleFileClick}
        filterQuery={searchQuery}
      />
    </div>
  );
}
```

### 5.8 FileTreeNode

```typescript
function FileTreeNode({ entry, depth, isExpanded, isSelected, onToggle, onSelect }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 py-0.5 px-2 cursor-pointer hover:bg-accent rounded-sm text-sm",
        isSelected && "bg-accent text-accent-foreground",
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={() => entry.type === 'directory' ? onToggle(entry.path) : onSelect(entry.path)}
    >
      {entry.type === 'directory' ? (
        <ChevronRight className={cn("h-3 w-3 transition-transform shrink-0",
          isExpanded && "rotate-90")} />
      ) : (
        <span className="w-3 shrink-0" /> // Spacer para alinear con directorios
      )}
      <FileIcon extension={entry.extension} type={entry.type} className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{entry.name}</span>
    </div>
  );
}
```

### 5.9 Renderers de Contenido

#### MarkdownRenderer

```typescript
function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ScrollArea className="h-full">
      <div className="prose prose-sm dark:prose-invert max-w-none p-4">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code: ({ className, children }) => {
              const language = className?.replace('language-', '');
              if (language) {
                return <CodeBlock code={String(children)} language={language} />;
              }
              return <code className="bg-muted px-1 rounded">{children}</code>;
            },
            table: ({ children }) => (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">{children}</table>
              </div>
            ),
          }}
        />
      </div>
    </ScrollArea>
  );
}
```

#### CodeViewer

```typescript
function CodeViewer({ content, language }: { content: string; language: string }) {
  return (
    <ScrollArea className="h-full">
      <div className="relative">
        <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b text-xs text-muted-foreground sticky top-0">
          <span>{language}</span>
          <span>{content.split('\n').length} lines</span>
        </div>
        <pre className="p-4 text-sm">
          <code>
            {content.split('\n').map((line, i) => (
              <div key={i} className="flex">
                <span className="text-muted-foreground select-none w-12 text-right pr-4 shrink-0">
                  {i + 1}
                </span>
                <span className="flex-1">
                  <HighlightedLine code={line} language={language} />
                </span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </ScrollArea>
  );
}
```

---

## 6. Renderers Futuros (PDF y Documentos)

### 6.1 PDF Viewer (Fase 5)

**Dependencia**: `react-pdf` (basado en pdf.js de Mozilla)

```typescript
// Futuro: src/renderer/components/file-browser/PdfViewer.tsx
import { Document, Page } from 'react-pdf';

function PdfViewer({ filePath }: { filePath: string }) {
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.0);

  // Carga el PDF via IPC (readBinary) convertido a base64 → data URL
  const pdfData = usePdfData(filePath);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar: zoom, paginación */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b">
        <Button onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>←</Button>
        <span className="text-xs">{currentPage} / {numPages}</span>
        <Button onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}>→</Button>
        <Button onClick={() => setScale(s => s - 0.1)}>−</Button>
        <span className="text-xs">{Math.round(scale * 100)}%</span>
        <Button onClick={() => setScale(s => s + 0.1)}>+</Button>
      </div>

      {/* Documento */}
      <ScrollArea className="flex-1">
        <Document file={pdfData} onLoadSuccess={({ numPages }) => setNumPages(numPages)}>
          <Page pageNumber={currentPage} scale={scale} />
        </Document>
      </ScrollArea>
    </div>
  );
}
```

**Consideraciones**:
- `react-pdf` necesita workers de pdf.js (configurar en Vite/Electron)
- Los PDFs se leen como binario vía `levante/fs:readBinary` y se convierten a data URL
- Tamaño máximo de PDF: 10MB (configurable, más alto que archivos de texto)
- Soporta búsqueda de texto dentro del PDF (feature de pdf.js)

### 6.2 Document Viewer (Fase 6)

**Dependencias**:
- `mammoth`: Word (.docx) → HTML
- `xlsx` (sheetjs): Excel (.xlsx) → tabla HTML

```typescript
// Futuro: src/renderer/components/file-browser/DocViewer.tsx
import mammoth from 'mammoth';

function DocViewer({ htmlContent, isLoading }: { htmlContent: string | null; isLoading: boolean }) {
  if (isLoading) return <LoadingState />;
  if (!htmlContent) return <EmptyState message="Could not render document" />;

  return (
    <ScrollArea className="h-full">
      <div
        className="prose prose-sm dark:prose-invert max-w-none p-4"
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    </ScrollArea>
  );
}

// Conversión en el main process (o en el store):
async function convertDocxToHtml(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml({ buffer });
  return result.value; // HTML string
}
```

**Consideraciones**:
- La conversión DOCX → HTML no es perfecta (pierde algunos estilos complejos)
- Para Excel, se puede mostrar como tabla HTML o usar una grid interactiva
- Los archivos `.doc` (formato antiguo) tienen soporte limitado
- `dangerouslySetInnerHTML` requiere sanitización del HTML generado (usar `DOMPurify`)

### 6.3 Image Viewer (Fase 5, bajo esfuerzo)

```typescript
// Futuro: src/renderer/components/file-browser/ImageViewer.tsx
function ImageViewer({ filePath }: { filePath: string }) {
  // Para SVG: cargar como texto y renderizar inline
  // Para raster (png/jpg): convertir a data URL via readBinary
  const imageUrl = useImageUrl(filePath);

  return (
    <div className="flex items-center justify-center h-full p-4 bg-checkered">
      <img
        src={imageUrl}
        alt={path.basename(filePath)}
        className="max-w-full max-h-full object-contain"
      />
    </div>
  );
}
```

### 6.4 Roadmap de Renderers

| Fase | Renderer | Extensiones | Dependencia | Esfuerzo |
|------|---------|-------------|-------------|----------|
| **3** | CodeViewer | .js .ts .jsx .tsx .py .css .json etc. | shiki o highlight.js | Medio |
| **3** | MarkdownRenderer | .md .mdx | react-markdown + remark-gfm | Bajo |
| **5** | ImageViewer | .png .jpg .gif .svg .webp | Ninguna (nativo) | Bajo |
| **5** | PdfViewer | .pdf | react-pdf (~500KB) | Medio |
| **6** | DocViewer | .docx | mammoth (~200KB) | Medio |
| **6** | SpreadsheetViewer | .xlsx | xlsx/sheetjs (~300KB) | Alto |

---

## 7. Migración desde WebPreviewPanel

### 7.1 Estrategia de Migración

La migración es **incremental** — no se rompe funcionalidad existente en ningún momento:

1. **Crear `sidePanelStore`** que internamente consume los mismos eventos que `webPreviewStore`
2. **Crear `SidePanel`** que renderiza las mismas `ServerTab` con la misma UI
3. **Verificar paridad** — el panel funciona exactamente igual que antes
4. **Agregar `FileTab`** — extender el store y componentes con tabs de archivos
5. **Deprecar `webPreviewStore` y `WebPreviewPanel`** — una vez que `SidePanel` está estable

### 7.2 Mapeo de Estado (webPreviewStore → sidePanelStore)

| webPreviewStore | sidePanelStore |
|----------------|---------------|
| `servers: DetectedServer[]` | `tabs.filter(t => t.type === 'server')` |
| `isPanelOpen: boolean` | `isPanelOpen: boolean` (igual) |
| `activeTaskId: string` | `activeTabId: string` (generalizado) |
| `pendingToast: DetectedServer` | `pendingToast: ServerTab` (misma idea) |
| `addServer()` | `addServerTab()` |
| `markServerDead()` | `markServerDead()` |
| `removeServer()` | `removeServerTab()` |
| `openPanel()` | `openPanel()` |
| `closePanel()` | `closePanel()` |
| `setActiveServer()` | `setActiveTab()` |

### 7.3 Compatibilidad con useWebPreview Hook

El hook `useWebPreview` que suscribe a `onPortDetected` y hace reconciliación cada 3s se mantiene funcionando. Solo cambia a qué store llama:

```typescript
// ANTES:
const { addServer, removeServer } = useWebPreviewStore();

// DESPUÉS:
const { addServerTab, removeServerTab } = useSidePanelStore();
```

---

## 8. Integración en la App

### 8.1 ChatPage.tsx

```typescript
// ANTES:
import { WebPreviewPanel } from '@/components/chat/WebPreviewPanel';
import { useWebPreview } from '@/hooks/useWebPreview';
useWebPreview();

return (
  <div className="flex flex-row h-full relative">
    <div className="flex flex-col flex-1 relative">{/* Chat */}</div>
    <WebPreviewPanel />
  </div>
);

// DESPUÉS:
import { SidePanel } from '@/components/chat/SidePanel';
import { useWebPreview } from '@/hooks/useWebPreview';  // Sin cambios
useWebPreview();

return (
  <div className="flex flex-row h-full relative">
    <div className="flex flex-col flex-1 relative">{/* Chat */}</div>
    <SidePanel />
  </div>
);
```

### 8.2 Sidebar (MainLayout)

```typescript
// ANTES (en ChatPageWithProvider.getSidebarContent):
return <ChatList sessions={...} onSessionSelect={...} ... />;

// DESPUÉS:
return (
  <SidebarSections
    chatListProps={{
      sessions,
      currentSessionId,
      onSessionSelect,
      onNewChat,
      deleteSession,
      updateSessionTitle,
      // ... todos los props actuales de ChatList
    }}
  />
);
```

**Refactorización de ChatList**:

`ChatList` actualmente incluye su propio header (botón New Chat + Search). Con el nuevo enfoque,
ese header se extrae a `SidebarSections` y `ChatList` se refactoriza en dos partes:

1. **`SidebarSections`** (nuevo): gestiona header fijo + tab bar + despacho de contenido
2. **`ChatListContent`** (extraído de ChatList): solo la parte scrollable (proyectos + conversaciones agrupadas por fecha)

Esto es un refactor de extracción — la funcionalidad del ChatList no cambia, solo se mueve
el header a un nivel superior para compartirlo con el file browser.

### 8.3 Coordinación Sidebar ↔ Panel

```typescript
// En SidePanel, al cambiar de tab:
useEffect(() => {
  if (!isPanelOpen) return;
  const activeTab = tabs.find(t => t.id === activeTabId);

  if (activeTab?.type === 'server') {
    // Comportamiento original: cerrar sidebar para dar espacio al iframe
    setSidebarOpen(false);
  }
  // File tabs: NO cierran sidebar (el file tree está ahí)
}, [activeTabId, isPanelOpen]);
```

---

## 9. Seguridad

### 9.1 Validación de Paths

```typescript
private validatePath(requestedPath: string): string {
  const resolved = path.resolve(requestedPath);
  const real = fs.realpathSync(resolved);

  if (!real.startsWith(this.workingDirectory!)) {
    throw new Error('Access denied: path outside working directory');
  }

  return real;
}
```

### 9.2 Límites de Lectura

| Tipo | Límite | Justificación |
|------|--------|---------------|
| Archivo de texto | 1MB | Suficiente para cualquier archivo de código razonable |
| PDF (futuro) | 10MB | PDFs pueden ser más grandes |
| DOCX (futuro) | 5MB | Documentos Word raramente superan esto |
| Imagen (futuro) | 5MB | Fotos de alta resolución |

### 9.3 Permisos

- Solo lectura dentro del working directory
- No permite escribir, renombrar, o eliminar archivos
- HTML generado por mammoth se sanitiza con DOMPurify antes de renderizar
- No expone información del sistema fuera del proyecto

---

## 10. Performance

### 10.1 Estrategias

1. **Lazy loading de directorios**: Solo carga al expandir
2. **Cache de entradas**: `entries` Map con invalidación por watcher
3. **Debounce del watcher**: 300ms
4. **Truncamiento de archivos**: >1MB se truncan con indicador
5. **Tabs cerradas liberan contenido**: Al cerrar una file tab, el contenido se descarta del store
6. **Renderers lazy loaded**: PDfViewer y DocViewer se cargan con `React.lazy()` solo cuando se necesitan
7. **No pre-cargar contenido**: El archivo se carga solo cuando su tab se activa por primera vez

### 10.2 Patrones de Ignorar

```typescript
const IGNORED_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', 'out',
  '.next', '.nuxt', '__pycache__', '.venv', 'venv',
  'env', '.tox', 'coverage', '.cache', '.turbo',
]);

const IGNORED_FILES = new Set([
  '.DS_Store', 'Thumbs.db', 'desktop.ini',
]);
```

---

## 11. Estados y Edge Cases

### 11.1 Estados de la UI

| Estado | File Tree (izquierda) | Panel (derecha) |
|--------|----------------------|-----------------|
| Sin working directory | "No working directory" | Panel cerrado |
| Directorio vacío | "Empty directory" | Panel cerrado |
| Cargando directorio | Spinner en nodo | Sin cambio |
| Archivo seleccionado | Nodo resaltado | Tab abierta con contenido |
| Archivo binario | Nodo resaltado | "Binary file - cannot preview" |
| Archivo muy grande | Nodo resaltado | Contenido truncado + indicador |
| Archivo eliminado (watcher) | Nodo desaparece | Tab muestra "File not found" |
| Archivo modificado (watcher) | Sin cambio visual | Auto-recarga si tab está activa |
| Muchas tabs abiertas | Sin efecto | Scroll horizontal en tab bar |
| PDF sin renderer instalado (futuro) | N/A | "PDF preview not available" |

### 11.2 Límite de Tabs Abiertas

Limitar a **10 file tabs** simultáneas. Al abrir la 11ª, se cierra automáticamente la tab de archivo más antigua (LRU). Las server tabs no cuentan para este límite.

---

## 12. Plan de Implementación por Fases

### Fase 1: Backend & IPC

**Archivos a crear**:
1. `src/main/services/filesystem/fileSystemService.ts`
2. `src/main/services/filesystem/index.ts`
3. `src/main/ipc/fileSystemHandlers.ts`
4. `src/preload/api/filesystem.ts`

**Archivos a modificar**:
1. `src/preload/preload.ts` — registrar `fs` API
2. `src/preload/types.ts` — tipos de la nueva API
3. `src/main/ipc/index.ts` o similar — registrar handlers
4. `src/main/services/servicesConfig.ts` o `initialization.ts` — inicializar servicio

**Entregable**: API IPC funcional para listar directorios y leer archivos.

### Fase 2: Store Unificado & Migración WebPreview

**Archivos a crear**:
1. `src/renderer/stores/sidePanelStore.ts`

**Archivos a modificar**:
1. `src/renderer/components/chat/WebPreviewPanel.tsx` → refactorizar a `SidePanel.tsx`
2. `src/renderer/hooks/useWebPreview.ts` — apuntar al nuevo store
3. `src/renderer/components/chat/WebPreviewButton.tsx` — apuntar al nuevo store
4. `src/renderer/components/chat/WebPreviewToast.tsx` — apuntar al nuevo store
5. `src/renderer/pages/ChatPage.tsx` — usar `SidePanel`

**Entregable**: Panel funciona exactamente igual que antes pero con el store unificado. Paridad verificada.

### Fase 3: Sidebar Tab Bar + File Tree + File Tabs

**Archivos a crear**:
1. `src/renderer/components/sidebar/SidebarSections.tsx` — Wrapper con header + tab bar
2. `src/renderer/components/chat/ChatListContent.tsx` — Contenido scrollable extraído de ChatList
3. `src/renderer/stores/fileBrowserStore.ts`
4. `src/renderer/components/file-browser/FileBrowserContent.tsx` — Contenido del file tree
5. `src/renderer/components/file-browser/FileTreeNode.tsx`
6. `src/renderer/components/file-browser/FileIcon.tsx`
7. `src/renderer/components/file-browser/index.ts`
8. `src/renderer/components/chat/panel/PanelTabBar.tsx`
9. `src/renderer/components/chat/panel/PanelContextBar.tsx`
10. `src/renderer/components/chat/panel/PanelContent.tsx`
11. `src/renderer/components/chat/panel/TabChip.tsx`
12. `src/renderer/components/file-browser/FileContentRenderer.tsx`
13. `src/renderer/components/file-browser/CodeViewer.tsx`
14. `src/renderer/components/file-browser/MarkdownRenderer.tsx`

**Archivos a modificar**:
1. `src/renderer/components/chat/ChatList.tsx` — Extraer contenido scrollable a `ChatListContent`
2. `src/renderer/pages/ChatPage.tsx` (o `App.tsx` `getSidebarContent`) — Usar `SidebarSections` en lugar de `ChatList` directo

**Entregable**: Sidebar con tab bar [Chats | Files], file tree funcional, tabs de archivos con código y markdown.

### Fase 4: Syntax Highlighting & Polish

**Tareas**:
1. Integrar Shiki o highlight.js para highlighting completo
2. Estilos de Markdown (prose Tailwind, tablas, GFM)
3. Números de línea en code viewer
4. File watcher para auto-actualización
5. Respetar `.gitignore`
6. Keyboard navigation en file tree
7. Límite de tabs (LRU)
8. Testing

### Fase 5 (Futuro): Imágenes + PDF

**Archivos a crear**:
1. `src/renderer/components/file-browser/ImageViewer.tsx`
2. `src/renderer/components/file-browser/PdfViewer.tsx`

**Dependencias nuevas**: `react-pdf`

**Tareas**:
1. Implementar `levante/fs:readBinary` en IPC
2. ImageViewer para png/jpg/gif/svg/webp
3. PdfViewer con paginación y zoom
4. Agregar `PdfTab` al type union y al store

### Fase 6 (Futuro): Documentos Office

**Archivos a crear**:
1. `src/renderer/components/file-browser/DocViewer.tsx`
2. `src/renderer/components/file-browser/SpreadsheetViewer.tsx`

**Dependencias nuevas**: `mammoth`, `xlsx`, `dompurify`

**Tareas**:
1. Conversión DOCX → HTML sanitizado
2. Conversión XLSX → tabla HTML
3. Agregar `DocTab` al store

---

## 13. Archivos Completos

### Nuevos (Fases 1-4): ~20 archivos

| # | Archivo | Capa | Fase |
|---|---------|------|------|
| 1 | `src/main/services/filesystem/fileSystemService.ts` | Main | 1 |
| 2 | `src/main/services/filesystem/index.ts` | Main | 1 |
| 3 | `src/main/ipc/fileSystemHandlers.ts` | Main | 1 |
| 4 | `src/preload/api/filesystem.ts` | Preload | 1 |
| 5 | `src/renderer/stores/sidePanelStore.ts` | Renderer | 2 |
| 6 | `src/renderer/components/chat/SidePanel.tsx` | Renderer | 2 |
| 7 | `src/renderer/stores/fileBrowserStore.ts` | Renderer | 3 |
| 8 | `src/renderer/components/sidebar/SidebarSections.tsx` | Renderer | 3 |
| 9 | `src/renderer/components/file-browser/FileBrowserContent.tsx` | Renderer | 3 |
| 10 | `src/renderer/components/file-browser/FileTreeNode.tsx` | Renderer | 3 |
| 11 | `src/renderer/components/file-browser/FileIcon.tsx` | Renderer | 3 |
| 12 | `src/renderer/components/file-browser/index.ts` | Renderer | 3 |
| 13 | `src/renderer/components/chat/panel/PanelTabBar.tsx` | Renderer | 3 |
| 14 | `src/renderer/components/chat/panel/PanelContextBar.tsx` | Renderer | 3 |
| 15 | `src/renderer/components/chat/panel/PanelContent.tsx` | Renderer | 3 |
| 16 | `src/renderer/components/chat/panel/TabChip.tsx` | Renderer | 3 |
| 17 | `src/renderer/components/file-browser/FileContentRenderer.tsx` | Renderer | 3 |
| 18 | `src/renderer/components/file-browser/CodeViewer.tsx` | Renderer | 3 |
| 19 | `src/renderer/components/file-browser/MarkdownRenderer.tsx` | Renderer | 3 |
| 20 | `src/renderer/components/chat/ChatListContent.tsx` | Renderer | 3 |

### Modificados: ~9 archivos

| # | Archivo | Cambio |
|---|---------|--------|
| 1 | `src/preload/preload.ts` | Registrar `fs` API |
| 2 | `src/preload/types.ts` | Agregar tipos `fs` |
| 3 | `src/main/initialization.ts` o similar | Inicializar FileSystemService |
| 4 | `src/main/ipc/index.ts` | Registrar fileSystemHandlers |
| 5 | `src/renderer/pages/ChatPage.tsx` | SidePanel + usar SidebarSections |
| 6 | `src/renderer/components/chat/ChatList.tsx` | Extraer contenido scrollable a ChatListContent |
| 7 | `src/renderer/hooks/useWebPreview.ts` | Apuntar a sidePanelStore |
| 8 | `src/renderer/components/chat/WebPreviewButton.tsx` | Apuntar a sidePanelStore |
| 9 | `src/renderer/components/chat/WebPreviewToast.tsx` | Apuntar a sidePanelStore |

### Deprecados (post-migración)

| Archivo | Reemplazado por |
|---------|----------------|
| `src/renderer/stores/webPreviewStore.ts` | `sidePanelStore.ts` |
| `src/renderer/components/chat/WebPreviewPanel.tsx` | `SidePanel.tsx` |

---

## 14. Dependencias

### Existentes (sin cambios)

| Dependencia | Uso |
|------------|-----|
| `zustand` | Stores |
| `lucide-react` | Iconos |
| `tailwindcss` | Estilos |
| `@radix-ui/react-scroll-area` | Scroll |
| shadcn/ui components | Button, Badge, ScrollArea, Sidebar |

### Nuevas (Fases 1-4)

| Dependencia | Uso | Notas |
|------------|-----|-------|
| `react-markdown` | Markdown rendering | Verificar si ya existe |
| `remark-gfm` | GitHub Flavored Markdown | Plugin de react-markdown |
| `shiki` | Syntax highlighting | Alternativa: highlight.js |

### Futuras (Fases 5-6)

| Dependencia | Uso | Tamaño aprox. |
|------------|-----|--------------|
| `react-pdf` | PDF viewer | ~500KB |
| `mammoth` | DOCX → HTML | ~200KB |
| `xlsx` | Excel → tabla | ~300KB |
| `dompurify` | Sanitizar HTML generado | ~50KB |

---

## 15. Testing

### Unit Tests

```typescript
describe('FileSystemService', () => {
  test('readDirectory returns sorted entries');
  test('readDirectory filters hidden files by default');
  test('readDirectory filters ignored directories');
  test('readFile returns content with language detection');
  test('readFile truncates large files');
  test('readFile detects binary files');
  test('validatePath rejects paths outside workingDirectory');
  test('detectLanguage maps extensions correctly');
  test('getContentCategory categorizes files correctly');
});

describe('sidePanelStore', () => {
  test('addServerTab adds server and shows toast if panel closed');
  test('openFileTab creates new tab with loaded content');
  test('openFileTab focuses existing tab if already open');
  test('closeTab removes file tab and selects adjacent');
  test('closeTab does nothing for server tabs');
  test('LRU eviction when exceeding max file tabs');
  test('markServerDead updates server tab state');
});

describe('fileBrowserStore', () => {
  test('loadDirectory populates entries cache');
  test('toggleDirectory expands/collapses');
  test('entries cache invalidation on refresh');
});
```

### E2E Tests (Playwright)

```typescript
describe('File Browser & Unified Panel', () => {
  test('file tree shows project structure in sidebar');
  test('clicking directory expands/collapses it');
  test('clicking file opens tab in right panel');
  test('file tab appears next to server tabs');
  test('closing file tab with X button');
  test('markdown renders formatted');
  test('code shows syntax highlighting');
  test('server tab still works (iframe loads)');
  test('switching between server and file tabs');
  test('file tab does not close sidebar');
  test('server tab closes sidebar');
});
```

---

## 16. Métricas de Éxito

1. **Funcional**: Navegar file tree y abrir archivo en < 200ms
2. **Performance**: Directorio con 1000 archivos carga en < 500ms
3. **Paridad**: WebPreview sigue funcionando idéntico post-migración
4. **UX**: Tabs unificadas se sienten naturales (server + file + futuro)
5. **Extensibilidad**: Agregar PdfViewer requiere < 1 día de trabajo
6. **Seguridad**: No se puede acceder a archivos fuera del proyecto

---

## 17. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Romper WebPreview durante migración | Media | Alto | Fase 2 dedicada a paridad, tests de regresión |
| Performance con monorepos | Media | Alto | Virtualización, ignorar node_modules, lazy loading |
| Muchas tabs abiertas degradan UX | Media | Bajo | Límite LRU de 10 file tabs |
| Syntax highlighting aumenta bundle | Media | Bajo | Lazy loading de gramáticas Shiki |
| react-pdf requiere config de workers | Baja | Medio | Configurar en Vite, documentar setup |
| mammoth genera HTML inseguro | Baja | Alto | DOMPurify para sanitizar |

---

## 18. Decisiones Abiertas

1. **¿Shiki o highlight.js?** — Shiki: mejor calidad, temas VS Code, más pesado. highlight.js: más ligero, menos preciso. Reutilizar lo que ya use `code-block.tsx`.

2. **¿Respetar `.gitignore`?** — Recomendado sí. Usar librería `ignore` para parsear.

3. **¿Buscar archivos en el file tree?** — Input de búsqueda/filtro útil pero diferible a Fase 5.

4. **¿Drag & drop de archivos al chat?** — Arrastrar desde tree al input como adjuntos. Feature futura.

5. **¿Reutilizar CodeBlock existente del chat?** — Investigar `src/renderer/components/ai-elements/code-block.tsx`.

6. **¿Nombre definitivo del store?** — `sidePanelStore` vs `previewPanelStore` vs `rightPanelStore`.
