# PRD: Web Preview Side Panel

**Feature:** Detección automática de puertos en background tasks con panel lateral de previsualización web
**Estado:** Propuesta
**Fecha:** 2026-02-21
**Rama sugerida:** `feat/web-preview-panel`

---

## 1. Resumen Ejecutivo

Cuando el agente lanza una background task (por ejemplo, `npm run dev`, `python -m uvicorn main:app`, `npx serve .`), Levante detecta automáticamente si esa tarea levantó un servidor web analizando su stdout. Si se detecta un puerto activo, aparece un panel lateral colapsable en el chat donde el usuario puede ver e interactuar con la web que se está ejecutando, sin salir de la aplicación.

---

## 2. Motivación

El flujo actual exige al usuario:
1. Ver en el output de la task que el servidor arrancó en cierto puerto
2. Abrir manualmente un navegador externo
3. Navegar a `http://localhost:PORT`

Esto rompe el flujo de trabajo del agente-desarrollador que quiere construir, previsualizar e iterar desde una sola pantalla. La feature cierra ese gap convirtiendo a Levante en un entorno integrado de desarrollo asistido por IA.

---

## 3. Comportamiento Esperado (User Story)

```
DADO que el agente ejecuta un comando con run_in_background=true
  (ej: "npm run dev" en el directorio del proyecto)

CUANDO el stdout de esa tarea contiene una URL con puerto
  (ej: "Local:   http://localhost:5173/")

ENTONCES el sistema detecta el puerto automáticamente
  Y muestra una notificación discreta: "Servidor detectado en :5173"
  Y aparece un botón en la barra de herramientas del chat

CUANDO el usuario hace clic en ese botón (o el panel se abre automáticamente)
  ENTONCES se despliega un panel lateral a la derecha del chat
  Y el panel carga un iframe apuntando a http://localhost:5173
  Y el usuario puede interactuar con la web directamente

CUANDO hay múltiples tareas con puertos detectados
  ENTONCES el panel muestra tabs o un selector para cambiar entre ellos

CUANDO la tarea es killed o completa
  ENTONCES el panel muestra un estado "servidor detenido"
  Y el botón desaparece si no hay más servidores activos
```

---

## 4. Decisiones de Diseño

### 4.1 Mecanismo de Previsualización: iframe

**Decisión:** Usar `<iframe>` nativo en lugar de `<webview>` de Electron.

**Razón:** La ventana principal tiene `sandbox: true` en webPreferences (ver `src/main/lifecycle/window.ts` línea 46), y la documentación de Electron indica que `<webview>` no funciona dentro de renderers sandboxed. Los iframes de localhost ya funcionan en esta app (ver `UIResourceMessage.tsx` que carga `http://localhost:PORT` para los widgets MCP).

**Atributos del iframe:**
```html
<iframe
  src="http://localhost:{PORT}"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
  allow="fullscreen; clipboard-read; clipboard-write"
/>
```

### 4.2 Detección de Puertos: Análisis de stdout

**Decisión:** Escanear cada línea del stdout/stderr de las background tasks con regex en el `BackgroundTaskManager`.

**Razón:** El punto de captura más natural es donde ya se procesa el output línea a línea (`handleOutput()`). Es O(1) por línea y no requiere polling.

**Patrones regex a detectar** (ordenados por prioridad):
```
1. https?://(localhost|127\.0\.0\.1):(\d{2,5})   → Vite, CRA, Next.js, FastAPI, etc.
2. (?:port|listening on|started on port)\s*:?\s*(\d{2,5})  → Express, Flask, generic
3. ➜\s+Local:\s+https?://\S+:(\d{2,5})            → Vite específico
4. ready.*?:(\d{2,5})                              → Next.js
5. \*\s+Running on\s+https?://\S+:(\d{2,5})       → Flask/Werkzeug
```

### 4.3 Comportamiento de Apertura del Panel

**Decisión:** El panel NO se abre automáticamente. Se muestra un indicador visual (punto animado) en un botón de la barra de herramientas. El usuario decide cuándo abrir el panel.

**Razón:** Abrir el panel automáticamente es intrusivo, especialmente si el usuario está leyendo el chat. El patrón de "badge/indicador → acción voluntaria" ya existe en `BackgroundTasksDropdown`.

**Excepción:** Primera vez que se detecta un puerto, mostrar un toast no-bloqueante "Servidor detectado en :PORT. [Ver preview]" durante 5 segundos.

### 4.4 Múltiples Servidores

**Decisión:** El panel soporta múltiples tareas con puertos. Se muestra un selector de tabs en la cabecera del panel.

---

## 5. Arquitectura de la Solución

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MAIN PROCESS                                │
│                                                                     │
│  BackgroundTaskManager                                              │
│   handleOutput()                                                    │
│     ├── [ya existente] addOutputLine()                              │
│     └── [NUEVO] detectPort(line)                                    │
│           → si detecta puerto:                                      │
│             entry.info.detectedPort = port                          │
│             this.emit('port-detected', { taskId, port })           │
│                                                                     │
│  taskHandlers.ts (setupTaskHandlers)                                │
│     └── [NUEVO] taskManager.on('port-detected', ...)               │
│           → mainWindow.webContents.send(                           │
│               'levante/tasks:portDetected',                        │
│               { taskId, port, command }                            │
│             )                                                       │
└─────────────────────────────────────────────────────────────────────┘
                              │ IPC
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         PRELOAD                                     │
│                                                                     │
│  src/preload/api/tasks.ts                                           │
│   [NUEVO] onPortDetected: (cb) =>                                  │
│     ipcRenderer.on('levante/tasks:portDetected', (_, data) =>      │
│       cb(data))                                                     │
│                                                                     │
│  src/preload/preload.ts (LevanteAPI interface)                      │
│   tasks: {                                                          │
│     ...ya existente...                                              │
│     [NUEVO] onPortDetected: (cb) => () => void                     │
│   }                                                                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         RENDERER                                    │
│                                                                     │
│  src/renderer/stores/webPreviewStore.ts  [NUEVO]                   │
│   Estado: servidores detectados, panel visible, tab activo         │
│                                                                     │
│  src/renderer/hooks/useWebPreview.ts  [NUEVO]                      │
│   Suscribe a onPortDetected, actualiza store                       │
│                                                                     │
│  src/renderer/components/chat/WebPreviewPanel.tsx  [NUEVO]         │
│   Panel colapsable con iframe, tabs, controles                     │
│                                                                     │
│  src/renderer/components/chat/WebPreviewButton.tsx  [NUEVO]        │
│   Botón en la barra de herramientas con badge animado              │
│                                                                     │
│  src/renderer/pages/ChatPage.tsx  [MODIFICAR]                      │
│   Añadir layout horizontal con WebPreviewPanel                     │
│                                                                     │
│  src/renderer/components/chat/ChatPromptInput.tsx  [MODIFICAR]     │
│   Añadir WebPreviewButton en la barra de herramientas              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Implementación Paso a Paso

---

### PASO 1: Tipos — Añadir `detectedPort` a TaskInfo

**Archivo:** `src/main/services/tasks/types.ts`

Añadir el campo `detectedPort` a `TaskInfo` y `TaskInfoDTO`:

```typescript
// ANTES:
export interface TaskInfo {
  id: string;
  command: string;
  description?: string;
  status: TaskStatus;
  pid: number | null;
  cwd: string;
  startedAt: Date;
  completedAt: Date | null;
  exitCode: number | null;
  timedOut: boolean;
  interrupted: boolean;
}

// DESPUÉS (añadir solo el campo nuevo al final):
export interface TaskInfo {
  id: string;
  command: string;
  description?: string;
  status: TaskStatus;
  pid: number | null;
  cwd: string;
  startedAt: Date;
  completedAt: Date | null;
  exitCode: number | null;
  timedOut: boolean;
  interrupted: boolean;
  detectedPort: number | null;  // <-- NUEVO
}

// ANTES:
export interface TaskInfoDTO {
  id: string;
  command: string;
  description?: string;
  status: TaskStatus;
  pid: number | null;
  cwd: string;
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  timedOut: boolean;
  interrupted: boolean;
}

// DESPUÉS (añadir solo el campo nuevo al final):
export interface TaskInfoDTO {
  id: string;
  command: string;
  description?: string;
  status: TaskStatus;
  pid: number | null;
  cwd: string;
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  timedOut: boolean;
  interrupted: boolean;
  detectedPort: number | null;  // <-- NUEVO
}
```

También añadir el evento al tipo `TaskEvents`:

```typescript
// ANTES:
export interface TaskEvents {
  'task:spawn': (taskId: string, info: TaskInfo) => void;
  'task:output': (taskId: string, line: string, stream: TaskStream) => void;
  'task:complete': (taskId: string, info: TaskInfo) => void;
  'task:killed': (taskId: string, info: TaskInfo) => void;
  'task:error': (taskId: string, error: Error) => void;
}

// DESPUÉS:
export interface TaskEvents {
  'task:spawn': (taskId: string, info: TaskInfo) => void;
  'task:output': (taskId: string, line: string, stream: TaskStream) => void;
  'task:complete': (taskId: string, info: TaskInfo) => void;
  'task:killed': (taskId: string, info: TaskInfo) => void;
  'task:error': (taskId: string, error: Error) => void;
  'task:port-detected': (taskId: string, port: number, info: TaskInfo) => void;  // <-- NUEVO
}
```

---

### PASO 2: BackgroundTaskManager — Detección de puertos y EventEmitter

**Archivo:** `src/main/services/tasks/BackgroundTaskManager.ts`

**2.1** Hacer que la clase extienda `EventEmitter`:

```typescript
// ANTES:
import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';

// DESPUÉS:
import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
```

```typescript
// ANTES:
class BackgroundTaskManager {
  private tasks: Map<string, TaskEntry> = new Map();
  private timeouts: Map<string, NodeJS.Timeout> = new Map();

// DESPUÉS:
class BackgroundTaskManager extends EventEmitter {
  private tasks: Map<string, TaskEntry> = new Map();
  private timeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    super();
  }
```

**2.2** Añadir las constantes de detección de puertos tras las importaciones:

```typescript
// Añadir tras las constantes MAX_OUTPUT_LINES / MAX_OUTPUT_BYTES:

/**
 * Regex patterns for detecting server ports in task output.
 * Ordered by specificity/priority.
 */
const PORT_DETECTION_PATTERNS: RegExp[] = [
  // URL completa: http://localhost:3000 o http://127.0.0.1:8080
  /https?:\/\/(?:localhost|127\.0\.0\.1):(\d{2,5})/i,
  // Vite: ➜  Local:   http://localhost:5173/
  /➜\s+Local:\s+https?:\/\/[^:]+:(\d{2,5})/i,
  // Next.js: started server on 0.0.0.0:3000
  /started server on [^:]+:(\d{2,5})/i,
  // Express / genérico: Listening on port 3000
  /(?:listening on|running on)\s+(?:port\s+)?(\d{2,5})/i,
  // Flask/Werkzeug: * Running on http://127.0.0.1:5000
  /\*\s+Running on\s+https?:\/\/[^:]+:(\d{2,5})/i,
  // Genérico: port 3000 o :3000
  /\bport[:\s]+(\d{2,5})\b/i,
];

const PORT_MIN = 1024;
const PORT_MAX = 65535;

function extractPortFromLine(line: string): number | null {
  for (const pattern of PORT_DETECTION_PATTERNS) {
    const match = line.match(pattern);
    if (match?.[1]) {
      const port = parseInt(match[1], 10);
      if (port >= PORT_MIN && port <= PORT_MAX) {
        return port;
      }
    }
  }
  return null;
}
```

**2.3** Actualizar `TaskInfo` al inicializarse con `detectedPort: null`:

```typescript
// En el método spawn(), en la inicialización de TaskInfo:
// ANTES:
const info: TaskInfo = {
  id: taskId,
  command,
  description: options.description,
  status: TaskStatus.RUNNING,
  pid: null,
  cwd: options.cwd,
  startedAt: new Date(),
  completedAt: null,
  exitCode: null,
  timedOut: false,
  interrupted: false,
};

// DESPUÉS:
const info: TaskInfo = {
  id: taskId,
  command,
  description: options.description,
  status: TaskStatus.RUNNING,
  pid: null,
  cwd: options.cwd,
  startedAt: new Date(),
  completedAt: null,
  exitCode: null,
  timedOut: false,
  interrupted: false,
  detectedPort: null,  // <-- NUEVO
};
```

**2.4** Añadir la llamada a detección en `addOutputLine()`:

```typescript
// ANTES:
private addOutputLine(entry: TaskEntry, line: TaskOutputLine): void {
  const lineBytes = Buffer.byteLength(line.text, 'utf8') + 50;

  while (
    entry.output.length >= MAX_OUTPUT_LINES ||
    entry.outputBytes + lineBytes > MAX_OUTPUT_BYTES
  ) {
    const removed = entry.output.shift();
    if (removed) {
      entry.outputBytes -= Buffer.byteLength(removed.text, 'utf8') + 50;
    } else {
      break;
    }
  }

  entry.output.push(line);
  entry.outputBytes += lineBytes;
}

// DESPUÉS:
private addOutputLine(entry: TaskEntry, line: TaskOutputLine): void {
  const lineBytes = Buffer.byteLength(line.text, 'utf8') + 50;

  while (
    entry.output.length >= MAX_OUTPUT_LINES ||
    entry.outputBytes + lineBytes > MAX_OUTPUT_BYTES
  ) {
    const removed = entry.output.shift();
    if (removed) {
      entry.outputBytes -= Buffer.byteLength(removed.text, 'utf8') + 50;
    } else {
      break;
    }
  }

  entry.output.push(line);
  entry.outputBytes += lineBytes;

  // Port detection: solo si aún no detectamos un puerto para esta tarea
  if (entry.info.detectedPort === null && line.text.trim()) {
    const port = extractPortFromLine(line.text);
    if (port !== null) {
      entry.info.detectedPort = port;
      logger.aiSdk.info('Port detected in task output', {
        taskId: entry.info.id,
        port,
        line: line.text.substring(0, 200),
      });
      // Emitir evento para que los handlers IPC lo reenvíen al renderer
      this.emit('task:port-detected', entry.info.id, port, { ...entry.info });
    }
  }
}
```

**2.5** Actualizar `toDTO()` para incluir `detectedPort`:

```typescript
// ANTES:
toDTO(info: TaskInfo): TaskInfoDTO {
  return {
    id: info.id,
    command: info.command,
    description: info.description,
    status: info.status,
    pid: info.pid,
    cwd: info.cwd,
    startedAt: info.startedAt.toISOString(),
    completedAt: info.completedAt?.toISOString() ?? null,
    exitCode: info.exitCode,
    timedOut: info.timedOut,
    interrupted: info.interrupted,
  };
}

// DESPUÉS:
toDTO(info: TaskInfo): TaskInfoDTO {
  return {
    id: info.id,
    command: info.command,
    description: info.description,
    status: info.status,
    pid: info.pid,
    cwd: info.cwd,
    startedAt: info.startedAt.toISOString(),
    completedAt: info.completedAt?.toISOString() ?? null,
    exitCode: info.exitCode,
    timedOut: info.timedOut,
    interrupted: info.interrupted,
    detectedPort: info.detectedPort,  // <-- NUEVO
  };
}
```

---

### PASO 3: taskHandlers.ts — Emitir evento IPC al renderer

**Archivo:** `src/main/ipc/taskHandlers.ts`

Modificar `setupTaskHandlers` para aceptar la referencia a la ventana principal y suscribirse al evento `task:port-detected`:

```typescript
// ANTES:
import { ipcMain } from 'electron';
import { getLogger } from '../services/logging';
import { taskManager, TaskStatus, GetOutputOptions, WaitTaskOptions } from '../services/tasks';

// DESPUÉS:
import { ipcMain, BrowserWindow } from 'electron';
import { getLogger } from '../services/logging';
import { taskManager, TaskStatus, GetOutputOptions, WaitTaskOptions } from '../services/tasks';
```

```typescript
// ANTES:
export function setupTaskHandlers(): void {

// DESPUÉS:
export function setupTaskHandlers(mainWindow: BrowserWindow): void {
  // Forward port detection events to the renderer
  taskManager.on('task:port-detected', (taskId: string, port: number, info: any) => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('levante/tasks:portDetected', {
      taskId,
      port,
      command: info.command,
      description: info.description,
    });
    logger.ipc.info('Port detected event forwarded to renderer', { taskId, port });
  });

  // ... resto de handlers sin cambios
```

---

### PASO 4: initialization.ts — Pasar mainWindow a setupTaskHandlers

**Archivo:** `src/main/lifecycle/initialization.ts`

Buscar donde se llama a `setupTaskHandlers()` y pasarle `mainWindow`:

```typescript
// ANTES (buscar la llamada):
setupTaskHandlers();

// DESPUÉS:
setupTaskHandlers(mainWindow);
```

> **Nota:** Si `mainWindow` no está disponible en ese punto del código, puede pasarse como parámetro a la función `initializeServices()` o similar. Revisar el archivo para determinar el patrón exacto.

---

### PASO 5: Preload — Exponer `onPortDetected`

**Archivo:** `src/preload/api/tasks.ts`

```typescript
// ANTES:
import { ipcRenderer } from 'electron';

export const tasksApi = {
  list: (filter?: { status?: string }) =>
    ipcRenderer.invoke('levante/tasks:list', filter),
  get: (taskId: string) =>
    ipcRenderer.invoke('levante/tasks:get', taskId),
  getOutput: (taskId: string, options?: { includeTimestamps?: boolean; tail?: number }) =>
    ipcRenderer.invoke('levante/tasks:getOutput', taskId, options),
  wait: (taskId: string, options?: { timeoutMs?: number }) =>
    ipcRenderer.invoke('levante/tasks:wait', taskId, options),
  kill: (taskId: string) =>
    ipcRenderer.invoke('levante/tasks:kill', taskId),
  stats: () =>
    ipcRenderer.invoke('levante/tasks:stats'),
  cleanup: (maxAgeMs?: number) =>
    ipcRenderer.invoke('levante/tasks:cleanup', maxAgeMs),
};

// DESPUÉS: añadir onPortDetected al objeto
export const tasksApi = {
  list: (filter?: { status?: string }) =>
    ipcRenderer.invoke('levante/tasks:list', filter),
  get: (taskId: string) =>
    ipcRenderer.invoke('levante/tasks:get', taskId),
  getOutput: (taskId: string, options?: { includeTimestamps?: boolean; tail?: number }) =>
    ipcRenderer.invoke('levante/tasks:getOutput', taskId, options),
  wait: (taskId: string, options?: { timeoutMs?: number }) =>
    ipcRenderer.invoke('levante/tasks:wait', taskId, options),
  kill: (taskId: string) =>
    ipcRenderer.invoke('levante/tasks:kill', taskId),
  stats: () =>
    ipcRenderer.invoke('levante/tasks:stats'),
  cleanup: (maxAgeMs?: number) =>
    ipcRenderer.invoke('levante/tasks:cleanup', maxAgeMs),

  // Evento push: el main process notifica cuando se detecta un puerto
  onPortDetected: (
    callback: (data: { taskId: string; port: number; command: string; description?: string }) => void
  ): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { taskId: string; port: number; command: string; description?: string }) => {
      callback(data);
    };
    ipcRenderer.on('levante/tasks:portDetected', handler);
    return () => ipcRenderer.removeListener('levante/tasks:portDetected', handler);
  },
};
```

**Archivo:** `src/preload/preload.ts`

Actualizar el tipo `LevanteAPI` en la sección `tasks`:

```typescript
// ANTES (en la interfaz LevanteAPI):
tasks: {
  list: (filter?: { status?: 'running' | 'completed' | 'failed' | 'killed' }) => Promise<{ success: boolean; data?: any; error?: string }>;
  get: (taskId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  getOutput: (taskId: string, options?: { includeTimestamps?: boolean; tail?: number }) => Promise<{ success: boolean; data?: string; error?: string }>;
  wait: (taskId: string, options?: { timeoutMs?: number }) => Promise<{ success: boolean; data?: any; error?: string }>;
  kill: (taskId: string) => Promise<{ success: boolean; data?: boolean; error?: string }>;
  stats: () => Promise<{ success: boolean; data?: any; error?: string }>;
  cleanup: (maxAgeMs?: number) => Promise<{ success: boolean; data?: number; error?: string }>;
};

// DESPUÉS: añadir onPortDetected al tipo
tasks: {
  list: (filter?: { status?: 'running' | 'completed' | 'failed' | 'killed' }) => Promise<{ success: boolean; data?: any; error?: string }>;
  get: (taskId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  getOutput: (taskId: string, options?: { includeTimestamps?: boolean; tail?: number }) => Promise<{ success: boolean; data?: string; error?: string }>;
  wait: (taskId: string, options?: { timeoutMs?: number }) => Promise<{ success: boolean; data?: any; error?: string }>;
  kill: (taskId: string) => Promise<{ success: boolean; data?: boolean; error?: string }>;
  stats: () => Promise<{ success: boolean; data?: any; error?: string }>;
  cleanup: (maxAgeMs?: number) => Promise<{ success: boolean; data?: number; error?: string }>;
  onPortDetected: (
    callback: (data: { taskId: string; port: number; command: string; description?: string }) => void
  ) => () => void;
};
```

---

### PASO 6: Renderer — Actualizar TaskInfoDTO en el store

**Archivo:** `src/renderer/stores/taskStore.ts`

```typescript
// ANTES:
export interface TaskInfoDTO {
  id: string;
  command: string;
  description?: string;
  status: TaskStatus;
  pid: number | null;
  cwd: string;
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  timedOut: boolean;
  interrupted: boolean;
}

// DESPUÉS:
export interface TaskInfoDTO {
  id: string;
  command: string;
  description?: string;
  status: TaskStatus;
  pid: number | null;
  cwd: string;
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  timedOut: boolean;
  interrupted: boolean;
  detectedPort: number | null;  // <-- NUEVO
}
```

---

### PASO 7: Renderer — Crear webPreviewStore

**Archivo nuevo:** `src/renderer/stores/webPreviewStore.ts`

```typescript
/**
 * Web Preview Store
 *
 * Manages the state of the web preview side panel.
 * Tracks detected server ports from background tasks.
 */

import { create } from 'zustand';

export interface DetectedServer {
  taskId: string;
  port: number;
  url: string;        // http://localhost:{port}
  command: string;
  description?: string;
  detectedAt: number; // timestamp
  isAlive: boolean;   // true mientras la task sigue running
}

interface WebPreviewState {
  // Lista de servidores detectados (puede haber varios)
  servers: DetectedServer[];

  // Estado del panel
  isPanelOpen: boolean;
  activeTaskId: string | null;  // taskId del servidor actualmente visible

  // Toast de notificación
  pendingToast: DetectedServer | null;

  // Acciones
  addServer: (server: DetectedServer) => void;
  markServerDead: (taskId: string) => void;
  removeServer: (taskId: string) => void;
  openPanel: (taskId?: string) => void;
  closePanel: () => void;
  setActiveServer: (taskId: string) => void;
  clearToast: () => void;
}

export const useWebPreviewStore = create<WebPreviewState>((set, get) => ({
  servers: [],
  isPanelOpen: false,
  activeTaskId: null,
  pendingToast: null,

  addServer: (server) => {
    set((state) => {
      // No duplicar si ya existe este taskId
      const exists = state.servers.some((s) => s.taskId === server.taskId);
      if (exists) return state;

      const newServers = [...state.servers, server];

      // Si el panel está cerrado, mostrar toast
      return {
        servers: newServers,
        pendingToast: state.isPanelOpen ? null : server,
        // Si no hay servidor activo, activar este
        activeTaskId: state.activeTaskId ?? server.taskId,
      };
    });
  },

  markServerDead: (taskId) => {
    set((state) => ({
      servers: state.servers.map((s) =>
        s.taskId === taskId ? { ...s, isAlive: false } : s
      ),
    }));
  },

  removeServer: (taskId) => {
    set((state) => {
      const newServers = state.servers.filter((s) => s.taskId !== taskId);
      const newActiveTaskId =
        state.activeTaskId === taskId
          ? (newServers.find((s) => s.isAlive)?.taskId ?? newServers[0]?.taskId ?? null)
          : state.activeTaskId;
      return {
        servers: newServers,
        activeTaskId: newActiveTaskId,
        isPanelOpen: newServers.length === 0 ? false : state.isPanelOpen,
      };
    });
  },

  openPanel: (taskId) => {
    set((state) => ({
      isPanelOpen: true,
      activeTaskId: taskId ?? state.activeTaskId ?? state.servers[0]?.taskId ?? null,
      pendingToast: null,
    }));
  },

  closePanel: () => {
    set({ isPanelOpen: false });
  },

  setActiveServer: (taskId) => {
    set({ activeTaskId: taskId });
  },

  clearToast: () => {
    set({ pendingToast: null });
  },
}));
```

---

### PASO 8: Renderer — Hook useWebPreview

**Archivo nuevo:** `src/renderer/hooks/useWebPreview.ts`

```typescript
/**
 * useWebPreview hook
 *
 * Subscribes to port detection events and task status changes
 * to keep the web preview store in sync.
 */

import { useEffect } from 'react';
import { useWebPreviewStore } from '@/stores/webPreviewStore';
import { useTaskStore } from '@/stores/taskStore';

export function useWebPreview() {
  const addServer = useWebPreviewStore((s) => s.addServer);
  const markServerDead = useWebPreviewStore((s) => s.markServerDead);
  const tasks = useTaskStore((s) => s.tasks);

  // Suscribirse al evento de detección de puertos desde el main process
  useEffect(() => {
    const unsubscribe = window.levante.tasks.onPortDetected((data) => {
      addServer({
        taskId: data.taskId,
        port: data.port,
        url: `http://localhost:${data.port}`,
        command: data.command,
        description: data.description,
        detectedAt: Date.now(),
        isAlive: true,
      });
    });

    return unsubscribe;
  }, [addServer]);

  // Marcar servidores como muertos cuando la task termina o es killed
  useEffect(() => {
    const { servers } = useWebPreviewStore.getState();
    for (const server of servers) {
      if (!server.isAlive) continue;
      const task = tasks.find((t) => t.id === server.taskId);
      if (task && task.status !== 'running') {
        markServerDead(server.taskId);
      }
    }
  }, [tasks, markServerDead]);
}
```

---

### PASO 9: Renderer — Componente WebPreviewPanel

**Archivo nuevo:** `src/renderer/components/chat/WebPreviewPanel.tsx`

```typescript
/**
 * WebPreviewPanel
 *
 * Panel lateral colapsable que muestra una previsualización web
 * de los servidores detectados en background tasks.
 */

import { useRef, useState, useCallback } from 'react';
import { X, RefreshCw, ExternalLink, Monitor, ChevronRight, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useWebPreviewStore, type DetectedServer } from '@/stores/webPreviewStore';
import { Badge } from '@/components/ui/badge';

const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 900;
const DEFAULT_PANEL_WIDTH = 480;

function ServerTab({
  server,
  isActive,
  onClick,
}: {
  server: DetectedServer;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors shrink-0',
        isActive
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
      title={server.command}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full shrink-0',
          server.isAlive ? 'bg-green-400' : 'bg-red-400'
        )}
      />
      <span>:{server.port}</span>
      {!server.isAlive && (
        <Badge variant="outline" className="text-[9px] py-0 px-1 h-3.5">
          stopped
        </Badge>
      )}
    </button>
  );
}

export function WebPreviewPanel() {
  const { servers, isPanelOpen, activeTaskId, closePanel, setActiveServer } =
    useWebPreviewStore();

  const [width, setWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [iframeKey, setIframeKey] = useState(0); // para forzar reload
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const activeServer = servers.find((s) => s.taskId === activeTaskId) ?? servers[0];

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = width;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = startX.current - ev.clientX;
      const newWidth = Math.min(
        MAX_PANEL_WIDTH,
        Math.max(MIN_PANEL_WIDTH, startWidth.current + delta)
      );
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [width]);

  const handleReload = () => {
    setIframeKey((k) => k + 1);
  };

  const handleOpenExternal = () => {
    if (activeServer) {
      window.levante.openExternal(activeServer.url);
    }
  };

  if (!isPanelOpen || servers.length === 0) {
    return null;
  }

  return (
    <div
      className="flex shrink-0 h-full"
      style={{ width }}
    >
      {/* Handle de resize */}
      <div
        className="w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors shrink-0 h-full"
        onMouseDown={handleMouseDown}
      />

      {/* Panel principal */}
      <div className="flex-1 flex flex-col border-l bg-background overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-b shrink-0 bg-muted/30">
          <Monitor size={13} className="text-muted-foreground shrink-0" />

          {/* Tabs de servidores */}
          <div className="flex-1 flex items-center gap-1 overflow-x-auto min-w-0 scrollbar-none">
            {servers.map((server) => (
              <ServerTab
                key={server.taskId}
                server={server}
                isActive={server.taskId === activeTaskId}
                onClick={() => setActiveServer(server.taskId)}
              />
            ))}
          </div>

          {/* Controles */}
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleReload}
              title="Reload preview"
              disabled={!activeServer?.isAlive}
            >
              <RefreshCw size={12} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleOpenExternal}
              title="Open in browser"
              disabled={!activeServer}
            >
              <ExternalLink size={12} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={closePanel}
              title="Close preview"
            >
              <X size={12} />
            </Button>
          </div>
        </div>

        {/* URL bar */}
        {activeServer && (
          <div className="flex items-center gap-2 px-2 py-1 border-b bg-muted/20 shrink-0">
            <Server size={11} className="text-muted-foreground shrink-0" />
            <span className="text-xs font-mono text-muted-foreground truncate">
              {activeServer.url}
            </span>
            {!activeServer.isAlive && (
              <Badge variant="destructive" className="text-[10px] py-0 px-1.5 h-4 shrink-0">
                offline
              </Badge>
            )}
          </div>
        )}

        {/* Contenido */}
        <div className="flex-1 relative overflow-hidden">
          {!activeServer ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No server selected
            </div>
          ) : !activeServer.isAlive ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <Server size={32} className="opacity-30" />
              <div className="text-center">
                <p className="text-sm font-medium">Server stopped</p>
                <p className="text-xs mt-1 opacity-70">
                  The process running on :{activeServer.port} has ended
                </p>
              </div>
            </div>
          ) : (
            <iframe
              key={iframeKey}
              src={activeServer.url}
              title={`Preview :${activeServer.port}`}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-top-navigation-by-user-activation"
              allow="fullscreen; clipboard-read; clipboard-write"
              className="absolute inset-0 w-full h-full border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}
```

---

### PASO 10: Renderer — Botón WebPreviewButton

**Archivo nuevo:** `src/renderer/components/chat/WebPreviewButton.tsx`

```typescript
/**
 * WebPreviewButton
 *
 * Botón para la barra de herramientas del chat.
 * Muestra un badge animado cuando hay servidores detectados.
 * Abre/cierra el WebPreviewPanel.
 */

import { Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useWebPreviewStore } from '@/stores/webPreviewStore';

interface WebPreviewButtonProps {
  className?: string;
}

export function WebPreviewButton({ className }: WebPreviewButtonProps) {
  const servers = useWebPreviewStore((s) => s.servers);
  const isPanelOpen = useWebPreviewStore((s) => s.isPanelOpen);
  const openPanel = useWebPreviewStore((s) => s.openPanel);
  const closePanel = useWebPreviewStore((s) => s.closePanel);

  const aliveServers = servers.filter((s) => s.isAlive);

  // No renderizar si no hay ningún servidor detectado nunca
  if (servers.length === 0) {
    return null;
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        'relative rounded-lg h-8 w-8',
        isPanelOpen
          ? 'text-primary bg-primary/10'
          : 'text-muted-foreground',
        className
      )}
      onClick={() => (isPanelOpen ? closePanel() : openPanel())}
      title={
        isPanelOpen
          ? 'Close web preview'
          : `Web preview (${aliveServers.length} server${aliveServers.length !== 1 ? 's' : ''})`
      }
      type="button"
    >
      <Monitor size={16} />
      {aliveServers.length > 0 && !isPanelOpen && (
        <Badge
          variant="default"
          className="absolute -top-1 -right-1 h-4 min-w-4 px-1 flex items-center justify-center text-[10px] bg-green-500 border-0"
        >
          {aliveServers.length}
        </Badge>
      )}
      {/* Indicador animado cuando hay servidor pero panel cerrado */}
      {aliveServers.length > 0 && !isPanelOpen && (
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        </span>
      )}
    </Button>
  );
}
```

---

### PASO 11: Renderer — Toast de notificación

**Archivo nuevo:** `src/renderer/components/chat/WebPreviewToast.tsx`

```typescript
/**
 * WebPreviewToast
 *
 * Notificación no-bloqueante que aparece cuando se detecta
 * un nuevo servidor por primera vez.
 */

import { useEffect } from 'react';
import { Monitor, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useWebPreviewStore } from '@/stores/webPreviewStore';

export function WebPreviewToast() {
  const pendingToast = useWebPreviewStore((s) => s.pendingToast);
  const clearToast = useWebPreviewStore((s) => s.clearToast);
  const openPanel = useWebPreviewStore((s) => s.openPanel);

  // Auto-dismiss después de 6 segundos
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
          openPanel(pendingToast.taskId);
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

---

### PASO 12: Renderer — Modificar ChatPage para el panel lateral

**Archivo:** `src/renderer/pages/ChatPage.tsx`

El ChatPage actualmente tiene un `<div className="flex flex-col h-full relative">` como raíz del render. Necesitamos envolverlo en un layout horizontal que soporte el panel lateral.

**12.1** Añadir imports al inicio de `ChatPage.tsx`:

```typescript
// Añadir estas importaciones:
import { WebPreviewPanel } from '@/components/chat/WebPreviewPanel';
import { WebPreviewToast } from '@/components/chat/WebPreviewToast';
import { useWebPreview } from '@/hooks/useWebPreview';
import { useWebPreviewStore } from '@/stores/webPreviewStore';
```

**12.2** Añadir el hook en el cuerpo del componente `ChatPage`:

```typescript
// Añadir dentro del componente ChatPage, junto a los otros hooks:
useWebPreview(); // Activa la suscripción a eventos de detección de puertos
const isPanelOpen = useWebPreviewStore((s) => s.isPanelOpen);
```

**12.3** Modificar el JSX de retorno para incluir el panel lateral.

El return actual es:
```typescript
return (
  <div
    className={cn(
      "flex flex-col h-full relative",
      isDragging && "ring-2 ring-primary ring-inset"
    )}
    ...
  >
    {/* contenido del chat */}
  </div>
);
```

Cambiarlo a:
```typescript
return (
  <>
    <WebPreviewToast />
    <div
      className={cn(
        "flex flex-row h-full relative",  // ← flex-col → flex-row
        isDragging && "ring-2 ring-primary ring-inset"
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Área de chat — igual que antes, pero con flex-col y flex-1 */}
      <div className="flex flex-col flex-1 relative min-w-0">
        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-50 bg-primary/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <p className="text-lg font-semibold text-primary">Drop images or PDFs here</p>
              <p className="text-sm text-muted-foreground mt-1">to attach them to your message</p>
            </div>
          </div>
        )}
        {/* ... resto del contenido del chat sin cambios ... */}
      </div>

      {/* Panel lateral de preview */}
      <WebPreviewPanel />
    </div>
  </>
);
```

---

### PASO 13: Renderer — Añadir WebPreviewButton a la barra de herramientas

El botón de preview debe aparecer en la barra de herramientas del chat junto a `BackgroundTasksDropdown`. Hay que localizar dónde se renderiza ese componente.

**Archivo a buscar:** `src/renderer/components/chat/ChatPromptInput.tsx`

Buscar el lugar donde está `<BackgroundTasksDropdown />` y añadir `<WebPreviewButton />` justo a su lado:

```typescript
// Añadir import:
import { WebPreviewButton } from '@/components/chat/WebPreviewButton';

// En el JSX, junto a BackgroundTasksDropdown:
<BackgroundTasksDropdown className="..." />
<WebPreviewButton className="..." />
```

---

## 7. Resumen de Archivos Modificados / Creados

### Archivos a MODIFICAR:

| Archivo | Cambio |
|---|---|
| `src/main/services/tasks/types.ts` | Añadir `detectedPort` a `TaskInfo`, `TaskInfoDTO`, `TaskEvents` |
| `src/main/services/tasks/BackgroundTaskManager.ts` | Extender `EventEmitter`, añadir `extractPortFromLine()`, emitir `task:port-detected`, actualizar `toDTO()` |
| `src/main/ipc/taskHandlers.ts` | Aceptar `mainWindow: BrowserWindow`, suscribirse a `task:port-detected` y emitir IPC al renderer |
| `src/main/lifecycle/initialization.ts` | Pasar `mainWindow` a `setupTaskHandlers()` |
| `src/preload/api/tasks.ts` | Añadir `onPortDetected` listener |
| `src/preload/preload.ts` | Añadir `onPortDetected` al tipo `LevanteAPI.tasks` |
| `src/renderer/stores/taskStore.ts` | Añadir `detectedPort` a `TaskInfoDTO` |
| `src/renderer/pages/ChatPage.tsx` | Añadir layout horizontal, integrar `WebPreviewPanel`, `WebPreviewToast`, `useWebPreview` |
| `src/renderer/components/chat/ChatPromptInput.tsx` | Añadir `WebPreviewButton` en la toolbar |

### Archivos a CREAR:

| Archivo | Descripción |
|---|---|
| `src/renderer/stores/webPreviewStore.ts` | Zustand store para estado del panel de preview |
| `src/renderer/hooks/useWebPreview.ts` | Hook que suscribe eventos IPC y sincroniza el store |
| `src/renderer/components/chat/WebPreviewPanel.tsx` | Panel lateral con iframe, tabs, resize handle |
| `src/renderer/components/chat/WebPreviewButton.tsx` | Botón de toolbar con badge animado |
| `src/renderer/components/chat/WebPreviewToast.tsx` | Notificación no-bloqueante de servidor detectado |

---

## 8. Flujo de Datos Completo

```
[Agente ejecuta bash tool con run_in_background=true]
           │
           ▼
[BackgroundTaskManager.spawn()]
  └── child_process.spawn()
  └── onStdout callback registrado
           │
           │ (stdout llega línea a línea)
           ▼
[BackgroundTaskManager.handleOutput()]
  └── addOutputLine()
        └── extractPortFromLine(line)
              └── si detecta puerto:
                    entry.info.detectedPort = port
                    this.emit('task:port-detected', taskId, port, info)
           │
           ▼
[taskHandlers.ts - listener de 'task:port-detected']
  └── mainWindow.webContents.send(
        'levante/tasks:portDetected',
        { taskId, port, command, description }
      )
           │
           │ (IPC cross-process)
           ▼
[Preload - ipcRenderer.on('levante/tasks:portDetected')]
  └── callback del renderer
           │
           ▼
[useWebPreview hook - useEffect con onPortDetected]
  └── webPreviewStore.addServer({ taskId, port, url, ... })
           │
           ▼
[webPreviewStore - React state update]
  └── servers: [..., newServer]
  └── pendingToast: newServer (si panel cerrado)
  └── activeTaskId: newServer.taskId (si era null)
           │
    ┌──────┴──────────┐
    │                 │
    ▼                 ▼
[WebPreviewToast]   [WebPreviewButton]
  muestra toast       muestra badge verde
  "Ver preview"       con ping animation
           │
           │ [usuario hace clic]
           ▼
[webPreviewStore.openPanel()]
  └── isPanelOpen = true
           │
           ▼
[WebPreviewPanel renderiza]
  └── <iframe src="http://localhost:{port}" />
```

---

## 9. Consideraciones de Seguridad

### 9.1 Validación de puertos
- Solo aceptar puertos en rango 1024-65535 (excluye privilegiados)
- Los puertos detectados vienen siempre de stdout del proceso hijo, nunca del usuario directamente

### 9.2 iframe sandbox
- El iframe usa `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-top-navigation-by-user-activation"`
- `allow-same-origin` es necesario para que las apps web funcionen correctamente (sin él, `localStorage`, cookies, etc. no funcionan)
- NO se usa `allow-top-navigation` (sin `by-user-activation`) para prevenir redirecciones no autorizadas

### 9.3 Solo localhost
- La URL del iframe siempre es `http://localhost:{port}` o `http://127.0.0.1:{port}`
- Nunca se carga una URL externa en el panel de preview
- El `extractPortFromLine` solo extrae el número de puerto, la URL se construye en el renderer con `http://localhost:{port}`

### 9.4 CSP
- La CSP actual (`script-src 'self' 'unsafe-inline' blob:`) no tiene `frame-src`, por lo que iframes de localhost están permitidos por defecto en Electron
- No es necesario modificar la CSP

---

## 10. Casos Edge y Manejo de Errores

### 10.1 Servidor no listo aún
- El iframe puede mostrar "Connection refused" los primeros ms después de detectar el puerto
- El componente muestra un botón "Reload" visible para que el usuario pueda reintentar
- Considerar añadir un `setTimeout(500ms)` antes de mostrar el iframe (mejora futura)

### 10.2 Puerto ocupado / falso positivo
- Si el regex detecta un número de 4-5 dígitos en un contexto no relacionado (ej: "error code 50000"), podría generar un falso positivo
- Mitigación: los patterns están ordenados de más específico (URL completa) a más genérico; se usa el primero que coincide
- El usuario puede cerrar el panel si el preview no tiene sentido

### 10.3 Múltiples detecciones del mismo task
- El evento `task:port-detected` puede dispararse múltiples veces si el patrón aparece en varias líneas
- Mitigación en `BackgroundTaskManager`: `if (entry.info.detectedPort === null)` — solo detecta una vez por tarea
- Mitigación en `webPreviewStore.addServer()`: `if (exists) return state` — no duplica si el taskId ya existe

### 10.4 Task killed / completada
- `useWebPreview` hook observa los cambios en `taskStore.tasks`
- Cuando una task deja de estar `running`, llama a `markServerDead(taskId)`
- El panel muestra el estado "Server stopped" en lugar del iframe

### 10.5 Resize del panel
- El panel tiene un mínimo de 320px y un máximo de 900px
- El resize es manejado con mouse events en el handle lateral
- Durante el resize, el iframe no captura eventos del mouse (el div superpuesto al iframe durante drag previene que el iframe "robe" los eventos)

---

## 11. Testing

### Unit Tests (Vitest)

**`BackgroundTaskManager.port-detection.test.ts`** (nuevo):
```
- extractPortFromLine con URL http://localhost:3000 → 3000
- extractPortFromLine con Vite output → 5173
- extractPortFromLine con Express "Listening on port 8080" → 8080
- extractPortFromLine con Next.js → 3000
- extractPortFromLine con texto sin puerto → null
- extractPortFromLine con puerto < 1024 → null
- Detección solo ocurre una vez (detectedPort no se sobreescribe)
- Evento 'task:port-detected' se emite correctamente
```

**`webPreviewStore.test.ts`** (nuevo):
```
- addServer agrega correctamente
- addServer no duplica si mismo taskId
- addServer establece pendingToast si panel cerrado
- markServerDead actualiza isAlive
- removeServer ajusta activeTaskId correctamente
- openPanel/closePanel cambian isPanelOpen
```

### E2E Tests (Playwright)

**`web-preview.e2e.ts`** (nuevo):
```
- Lanzar task con "npm run dev", esperar detección de puerto
- Verificar que el badge aparece en el botón
- Verificar que el toast aparece
- Abrir el panel y verificar que el iframe carga
- Kill de la task → verificar "Server stopped"
```

---

## 12. Dependencias

No se requieren dependencias nuevas de npm. Todos los elementos utilizados ya existen:
- `EventEmitter` (Node.js built-in)
- `zustand` (ya en el proyecto)
- `iframe` (HTML nativo)
- `lucide-react` (ya en el proyecto)
- shadcn/ui components (ya en el proyecto)

---

## 13. Orden de Implementación Recomendado

1. **PASO 1** — Tipos (`types.ts`) → sin riesgos, base de todo
2. **PASO 2** — `BackgroundTaskManager` → detección de puertos
3. **PASO 3 + 4** — `taskHandlers.ts` + `initialization.ts` → IPC al renderer
4. **PASO 5** — Preload → bridge al renderer
5. **PASO 6** — `taskStore.ts` → añadir campo en el DTO
6. **PASO 7** — `webPreviewStore.ts` → nuevo store
7. **PASO 8** — `useWebPreview.ts` → nuevo hook
8. **PASO 9** — `WebPreviewPanel.tsx` → componente principal
9. **PASO 10** — `WebPreviewButton.tsx` → botón toolbar
10. **PASO 11** — `WebPreviewToast.tsx` → notificación
11. **PASO 12** — `ChatPage.tsx` → integración del layout
12. **PASO 13** — `ChatPromptInput.tsx` → añadir botón

Este orden permite validar cada capa de forma incremental antes de pasar a la siguiente.
