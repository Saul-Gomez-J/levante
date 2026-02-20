# Runbook de Implementación: Background Tasks para Coding Tools en Levante

## Documento
- Estado: `READY FOR IMPLEMENTATION`
- Versión: `2.0`
- Fecha: `2026-02-19`
- Audiencia: IA/ingeniero que implementará el cambio completo

---

## 1. Objetivo

Implementar un sistema robusto de **tareas en segundo plano** para comandos de shell ejecutados desde el tool `bash` de Cowork mode.

El sistema debe permitir:
1. Lanzar comandos en background y devolver un `taskId`.
2. Consultar estado, salida y estadísticas de tareas por IPC.
3. Esperar la finalización de una tarea (wait) desde renderer si se necesita.
4. Matar tareas activas de forma segura.
5. Limpiar tareas y procesos al apagar la app.

---

## 2. Estado actual de Levante (real)

Este runbook está alineado con la estructura actual del proyecto:

1. **Shell execution actual**:
   - `src/main/services/ai/codingTools/utils/shell.ts`
   - Existe `executeCommand(...)`, `killProcessTree(...)`, `sanitizeBinaryOutput(...)`, `getShellConfig(...)`.

2. **Tool bash actual**:
   - `src/main/services/ai/codingTools/tools/bash.ts`
   - Ejecuta comandos de forma síncrona (espera resultado).
   - Actualmente no existe `run_in_background`.

3. **Preload real**:
   - El bridge NO está en `src/preload/index.ts`.
   - El archivo correcto es `src/preload/preload.ts`.
   - Los módulos API viven en `src/preload/api/*.ts`.

4. **Logging real**:
   - Categorías disponibles en `src/main/types/logger.ts`: `ai-sdk`, `mcp`, `database`, `ipc`, `preferences`, `models`, `core`, `analytics`, `oauth`.
   - **No existe** categoría `coding`.

5. **Registro de IPC handlers**:
   - `src/main/lifecycle/initialization.ts` -> `registerIPCHandlers(...)`.

6. **Shutdown global**:
   - `src/main/lifecycle/shutdown.ts` -> `gracefulShutdown()`.

---

## 3. Alcance y no alcance

### 3.1 Alcance
1. Background tasks para `bash` en Cowork mode.
2. Servicio en main para gestionar procesos y output.
3. IPC + preload para acceso desde renderer.
4. Limpieza de procesos en shutdown.
5. UI opcional en Settings (fase separada).

### 3.2 No alcance
1. No modifica flujo MCP tools ni mcp-use.
2. No modifica aprobación de tools.
3. No cambia comportamiento de `bash` foreground existente.
4. No se implementa streaming push de eventos al renderer en esta versión (polling por IPC es suficiente).

---

## 4. Comportamiento funcional esperado

### 4.1 En `bash` tool
1. Si `run_in_background !== true`: comportamiento actual intacto.
2. Si `run_in_background === true`:
   - Se crea una tarea en `BackgroundTaskManager`.
   - Se devuelve inmediatamente:
     - `status: "background"`
     - `taskId`
     - `pid` (si existe)
     - `message` informativo.

### 4.2 En main
1. El proceso queda registrado con:
   - comando, cwd, timestamps, estado, exitCode, flags.
2. Se captura stdout/stderr con límites de memoria.
3. `kill(taskId)` mata árbol de procesos.
4. `wait(taskId)` resuelve cuando la tarea termina/killed/failed.
5. `clearAll()` se ejecuta en shutdown.

### 4.3 En renderer
1. Puede listar tareas.
2. Puede ver output (completo o tail).
3. Puede matar tareas.
4. Puede esperar tarea si usa API `wait`.

---

## 5. Arquitectura final

## 5.1 Archivos nuevos

```text
src/main/services/tasks/
├── BackgroundTaskManager.ts
├── types.ts
└── index.ts

src/main/ipc/
└── taskHandlers.ts

src/preload/api/
└── tasks.ts

(opcional)
src/renderer/stores/
└── taskStore.ts

(opcional)
src/renderer/components/settings/
└── BackgroundTasksSection.tsx
```

## 5.2 Archivos modificados

```text
src/main/services/ai/codingTools/tools/bash.ts
src/main/lifecycle/initialization.ts
src/main/lifecycle/shutdown.ts
src/preload/preload.ts

(opcional)
src/renderer/components/settings/index.ts
src/renderer/pages/SettingsPage.tsx
src/renderer/locales/en/settings.json
src/renderer/locales/es/settings.json
```

## 5.3 Matriz de cambios (obligatorio vs opcional)

| Archivo | Tipo | Obligatorio | Razón |
|---|---|---|---|
| `src/main/services/tasks/types.ts` | Nuevo | Sí | Contratos internos y DTO |
| `src/main/services/tasks/BackgroundTaskManager.ts` | Nuevo | Sí | Núcleo de background tasks |
| `src/main/services/tasks/index.ts` | Nuevo | Sí | Exportaciones públicas |
| `src/main/ipc/taskHandlers.ts` | Nuevo | Sí | Control desde renderer |
| `src/main/lifecycle/initialization.ts` | Editar | Sí | Registrar handlers IPC |
| `src/main/lifecycle/shutdown.ts` | Editar | Sí | Limpieza de procesos en cierre |
| `src/main/services/ai/codingTools/tools/bash.ts` | Editar | Sí | Entrada `run_in_background` |
| `src/preload/api/tasks.ts` | Nuevo | Sí | Bridge preload para renderer |
| `src/preload/preload.ts` | Editar | Sí | Exponer `window.levante.tasks` |
| `src/renderer/stores/taskStore.ts` | Nuevo | No | Estado UI |
| `src/renderer/components/settings/BackgroundTasksSection.tsx` | Nuevo | No | Gestión visual de tareas |
| `src/renderer/components/settings/index.ts` | Editar | No | Export del componente |
| `src/renderer/pages/SettingsPage.tsx` | Editar | No | Render de sección |
| `src/renderer/locales/en/settings.json` | Editar | No | i18n UI |
| `src/renderer/locales/es/settings.json` | Editar | No | i18n UI |

---

## 6. Contratos de datos

## 6.1 Tipos internos (main)

Crear `src/main/services/tasks/types.ts`:

```ts
export enum TaskStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  KILLED = 'killed',
}

export type TaskStream = 'stdout' | 'stderr';

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

export interface SpawnTaskOptions {
  cwd: string;
  timeout?: number; // ms, default 120000
  description?: string;
  env?: NodeJS.ProcessEnv;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface GetOutputOptions {
  includeTimestamps?: boolean;
  tail?: number;
}

export interface WaitTaskOptions {
  timeoutMs?: number; // default 30000
}

export interface TaskStats {
  total: number;
  running: number;
  completed: number;
  failed: number;
  killed: number;
}

export interface TaskEvents {
  'task:spawn': (taskId: string, info: TaskInfo) => void;
  'task:output': (taskId: string, line: string, stream: TaskStream) => void;
  'task:complete': (taskId: string, info: TaskInfo) => void;
  'task:killed': (taskId: string, info: TaskInfo) => void;
  'task:error': (taskId: string, error: Error) => void;
}
```

## 6.2 Respuesta estándar de IPC

Usar este shape en handlers (igual patrón existente):

```ts
type IPCResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };
```

## 6.3 Canales IPC

Implementar en `taskHandlers.ts`:

1. `levante/tasks:list`
   - input: `filter?: { status?: TaskStatus }`
   - output: `IPCResult<TaskInfoDTO[]>`

2. `levante/tasks:get`
   - input: `taskId: string`
   - output: `IPCResult<TaskInfoDTO | null>`

3. `levante/tasks:getOutput`
   - input: `taskId: string, options?: GetOutputOptions`
   - output: `IPCResult<string>`

4. `levante/tasks:wait`
   - input: `taskId: string, options?: WaitTaskOptions`
   - output: `IPCResult<TaskInfoDTO>`

5. `levante/tasks:kill`
   - input: `taskId: string`
   - output: `IPCResult<boolean>`

6. `levante/tasks:stats`
   - input: none
   - output: `IPCResult<TaskStats>`

7. `levante/tasks:cleanup`
   - input: `maxAgeMs?: number`
   - output: `IPCResult<number>`

---

## 7. Diseño del `BackgroundTaskManager`

Crear `src/main/services/tasks/BackgroundTaskManager.ts`.

## 7.1 Requisitos de implementación

1. Singleton exportado como `taskManager`.
2. Almacenamiento en memoria:
   - `Map<string, TaskEntry>`.
3. Límite de output:
   - `MAX_OUTPUT_LINES = 5000`
   - `MAX_OUTPUT_BYTES = 2 * 1024 * 1024`.
4. Logging con categorías existentes:
   - usar `logger.aiSdk` para eventos de tareas.
5. Reusar utilidades existentes:
   - `getShellConfig`, `getShellEnv`, `killProcessTree`, `sanitizeBinaryOutput`.

## 7.2 Estructura interna sugerida

```ts
interface TaskOutputLine {
  ts: number;
  stream: 'stdout' | 'stderr';
  text: string;
}

interface TaskEntry {
  info: TaskInfo;
  process: ChildProcess | null;
  output: TaskOutputLine[];
  outputBytes: number;
  stdoutRemainder: string;
  stderrRemainder: string;
}
```

## 7.3 Reglas importantes de parsing de output

1. No perder líneas parciales entre chunks.
2. Mantener `stdoutRemainder` y `stderrRemainder`.
3. `sanitizeBinaryOutput` antes de parsear.
4. Al cerrar proceso, flush de remainders no vacíos.

## 7.4 Reglas de estado

1. Estado inicial: `RUNNING`.
2. Timeout:
   - marcar `timedOut = true`.
   - llamar `kill(taskId)`.
3. `kill(taskId)`:
   - si running, matar árbol y marcar:
     - `status = KILLED`
     - `interrupted = true`
     - `completedAt = new Date()`.
4. Evento `close`:
   - si aún está `RUNNING`:
     - `COMPLETED` si code 0
     - `FAILED` en otro caso.
   - set `exitCode`.
   - set `completedAt` si faltaba.
5. `wait(taskId)` debe resolver para estados terminales:
   - `COMPLETED`, `FAILED`, `KILLED`.

## 7.5 API del manager (obligatoria)

1. `spawn(command: string, options: SpawnTaskOptions): { taskId: string; pid: number | null }`
2. `kill(taskId: string): boolean`
3. `getStatus(taskId: string): TaskInfo | null`
4. `getOutput(taskId: string, options?: GetOutputOptions): string | null`
5. `list(filter?: { status?: TaskStatus }): TaskInfo[]`
6. `wait(taskId: string, timeoutMs?: number): Promise<TaskInfo>`
7. `cleanup(maxAgeMs?: number): number`
8. `clearAll(): void`
9. `getStatistics(): TaskStats`
10. `toDTO(info: TaskInfo): TaskInfoDTO`
11. `toDTOList(list: TaskInfo[]): TaskInfoDTO[]`

## 7.6 Logging recomendado

Usar `logger.aiSdk`.

Eventos mínimos:
1. spawn
2. complete
3. killed
4. timeout
5. error
6. cleanup

---

## 8. Integración en lifecycle

## 8.1 `src/main/lifecycle/shutdown.ts`

Añadir import:

```ts
import { taskManager } from '../services/tasks';
```

En `gracefulShutdown()` ejecutar al inicio:

```ts
try {
  taskManager.clearAll();
  logger.core.info('Background tasks cleared');
} catch (error) {
  logger.core.error('Error clearing background tasks', {
    error: error instanceof Error ? error.message : error,
  });
}
```

## 8.2 `src/main/lifecycle/initialization.ts`

Añadir import:

```ts
import { setupTaskHandlers } from '../ipc/taskHandlers';
```

Registrar handlers dentro de `registerIPCHandlers(...)`:

```ts
setupTaskHandlers();
```

---

## 9. IPC handlers

Crear `src/main/ipc/taskHandlers.ts`.

## 9.1 Reglas

1. Usar `ipcMain.removeHandler(channel)` antes de registrar.
2. Validar inputs mínimos (`taskId` no vacío, `tail > 0`, etc.).
3. Manejar errores y devolver `IPCResult`.
4. Logging con `logger.ipc` para errores de handler.

## 9.2 Ejemplo de estructura

```ts
ipcMain.removeHandler('levante/tasks:list');
ipcMain.handle('levante/tasks:list', async (_, filter) => { ... });
```

## 9.3 Normalización de salida

1. Siempre devolver DTO (`TaskInfoDTO`) al renderer.
2. No devolver objetos `Date` crudos.

## 9.4 Esqueleto recomendado de handlers

Usar este patrón completo para cada canal:

```ts
import { ipcMain } from 'electron';
import { getLogger } from '../services/logging';
import { taskManager, TaskStatus } from '../services/tasks';

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

export function setupTaskHandlers(): void {
  ipcMain.removeHandler('levante/tasks:list');
  ipcMain.handle('levante/tasks:list', async (_, filter?: { status?: TaskStatus }) => {
    try {
      const tasks = taskManager.list(filter);
      return ok(taskManager.toDTOList(tasks));
    } catch (error) {
      logger.ipc.error('Failed to list background tasks', { error: String(error) });
      return fail(error);
    }
  });

  // Repetir patrón para:
  // - levante/tasks:get
  // - levante/tasks:getOutput
  // - levante/tasks:wait
  // - levante/tasks:kill
  // - levante/tasks:stats
  // - levante/tasks:cleanup
}
```

---

## 10. Integración en `bash` tool

Modificar `src/main/services/ai/codingTools/tools/bash.ts`.

## 10.1 Cambios de schema

Añadir en `inputSchema`:

```ts
run_in_background: z.boolean().optional().describe(
  'If true, starts the command as background task and returns taskId immediately'
),
```

## 10.2 Cambios de execute

1. Extender destructuring:

```ts
execute: async ({ command, description, timeout: cmdTimeout, run_in_background }: {...}) => { ... }
```

2. Si `run_in_background`:
   - calcular `effectiveTimeout` como ya se hace.
   - `taskManager.spawn(command, { cwd: config.cwd, timeout: effectiveTimeout, description })`.
   - return:

```ts
{
  status: 'background',
  taskId,
  pid,
  exitCode: null,
  output: `Command started in background (taskId: ${taskId})`,
  truncated: false,
}
```

3. Si no, mantener flujo actual sin cambios.

## 10.3 Import

```ts
import { taskManager } from '../../../tasks';
```

---

## 11. Preload bridge

## 11.1 Crear `src/preload/api/tasks.ts`

Implementar módulo similar a `preferencesApi`:

```ts
import { ipcRenderer } from 'electron';

export const tasksApi = {
  list: (filter?: { status?: string }) => ipcRenderer.invoke('levante/tasks:list', filter),
  get: (taskId: string) => ipcRenderer.invoke('levante/tasks:get', taskId),
  getOutput: (taskId: string, options?: { includeTimestamps?: boolean; tail?: number }) =>
    ipcRenderer.invoke('levante/tasks:getOutput', taskId, options),
  wait: (taskId: string, options?: { timeoutMs?: number }) =>
    ipcRenderer.invoke('levante/tasks:wait', taskId, options),
  kill: (taskId: string) => ipcRenderer.invoke('levante/tasks:kill', taskId),
  stats: () => ipcRenderer.invoke('levante/tasks:stats'),
  cleanup: (maxAgeMs?: number) => ipcRenderer.invoke('levante/tasks:cleanup', maxAgeMs),
};
```

## 11.2 Modificar `src/preload/preload.ts`

1. Importar `tasksApi`.
2. Extender interfaz `LevanteAPI` con `tasks`.
3. Añadir `tasks: tasksApi` en el objeto `api`.

## 11.3 Contrato mínimo en `LevanteAPI`

Añadir en `src/preload/preload.ts` una sección `tasks` con este shape:

```ts
tasks: {
  list: (filter?: { status?: 'running' | 'completed' | 'failed' | 'killed' }) => Promise<{ success: boolean; data?: any; error?: string }>;
  get: (taskId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  getOutput: (taskId: string, options?: { includeTimestamps?: boolean; tail?: number }) => Promise<{ success: boolean; data?: string; error?: string }>;
  wait: (taskId: string, options?: { timeoutMs?: number }) => Promise<{ success: boolean; data?: any; error?: string }>;
  kill: (taskId: string) => Promise<{ success: boolean; data?: boolean; error?: string }>;
  stats: () => Promise<{ success: boolean; data?: any; error?: string }>;
  cleanup: (maxAgeMs?: number) => Promise<{ success: boolean; data?: number; error?: string }>;
};
```

Nota:
1. Se puede refinar tipado después con interfaces compartidas.
2. No bloquear implementación por tipado avanzado si ya compila con el patrón existente.

---

## 12. UI opcional (fase 2)

Esta fase es opcional y puede ir después de tener core estable.

## 12.1 Store

Crear `src/renderer/stores/taskStore.ts`.

Requisitos:
1. Estado:
   - `tasks`, `loading`, `error`, `selectedTaskOutput`.
2. Acciones:
   - `fetchTasks(filter?)`
   - `killTask(taskId)`
   - `loadOutput(taskId, tail?)`
   - `waitTask(taskId, timeoutMs?)`
   - `cleanup(maxAgeMs?)`
3. Polling simple desde componente (cada 2s).

## 12.2 Componente de settings

Crear `src/renderer/components/settings/BackgroundTasksSection.tsx`.

Requisitos UI mínimos:
1. Tabla/lista con:
   - status
   - command
   - pid
   - startedAt
   - exitCode
2. Botón `Kill` para tareas running.
3. Botón `View output`.
4. Botón `Cleanup completed`.

## 12.3 Integración de settings

1. Exportar componente en `src/renderer/components/settings/index.ts`.
2. Renderizar en `src/renderer/pages/SettingsPage.tsx`.
3. Recomendación: mostrar solo si `developerMode === true`.

## 12.4 i18n (si se agrega UI)

Agregar llaves en:
- `src/renderer/locales/en/settings.json`
- `src/renderer/locales/es/settings.json`

Ejemplo de namespace:

```json
"background_tasks": {
  "title": "Background Tasks",
  "description": "Manage shell commands running in the background",
  "refresh": "Refresh",
  "cleanup": "Cleanup completed",
  "no_tasks": "No tasks",
  "status": "Status",
  "command": "Command",
  "pid": "PID",
  "started": "Started",
  "exit_code": "Exit code",
  "actions": "Actions",
  "kill": "Kill",
  "view_output": "View output"
}
```

---

## 13. Seguridad y estabilidad

## 13.1 Límites de memoria

1. Limitar por líneas y bytes simultáneamente.
2. Calcular bytes con `Buffer.byteLength(...)` para precisión.

## 13.2 Procesos huérfanos

1. Mantener `detached: process.platform !== 'win32'`.
2. Usar `killProcessTree(pid)` siempre para kill.
3. Ejecutar `clearAll()` en shutdown.
4. En `setTimeout` de cada tarea usar `timeoutId.unref?.()` para no bloquear cierre de proceso principal.

## 13.3 Validaciones

1. `cwd` obligatorio en spawn.
2. `taskId` no vacío en IPC.
3. `tail` y `timeoutMs` con límites razonables (`>0`).

## 13.4 No exponer secretos innecesarios

1. No loggear env completo.
2. Loggear `command` y metadatos básicos únicamente.

---

## 14. Plan de pruebas

## 14.1 Unit tests (obligatorio)

Crear `src/main/services/tasks/__tests__/BackgroundTaskManager.test.ts`.

Casos mínimos:
1. `spawn()` crea task y estado `RUNNING` inicial.
2. Comando corto finaliza `COMPLETED` y captura output.
3. `kill()` cambia a `KILLED`.
4. `wait()` resuelve al terminar.
5. `cleanup()` elimina terminadas antiguas.
6. `getOutput({ tail })` devuelve últimas líneas.
7. `getOutput({ includeTimestamps: true })` incluye formato timestamp.

Notas:
1. Evitar comandos dependientes de `/tmp` o `sleep` puro.
2. Preferir comandos portables con shell disponible (`echo`) y/o mocks para spawn.

## 14.2 IPC tests (recomendado)

Validar handlers:
1. `list/get/getOutput/wait/kill/stats/cleanup` responden shape correcto.
2. Error path devuelve `success:false`.

## 14.3 Manual QA (obligatorio)

1. Iniciar chat en cowork mode.
2. Ejecutar tool `bash` con `run_in_background: true`.
3. Verificar retorno de `taskId`.
4. Consultar vía API `window.levante.tasks.list()` desde renderer.
5. Matar tarea running.
6. Cerrar app con tareas vivas y verificar que no queden procesos colgados.

---

## 15. Criterios de aceptación

La implementación se considera completa si:

1. `pnpm typecheck` pasa.
2. `pnpm test` pasa (o al menos tests nuevos + suite estable).
3. `bash` acepta `run_in_background` sin romper comportamiento previo.
4. Se pueden listar, consultar output, esperar y matar tareas por IPC/preload.
5. `gracefulShutdown()` limpia tareas activas.
6. No se introducen cambios en MCP ni en aprobación de tools.

---

## 16. Plan de implementación por fases

## Fase 1: Core en main (obligatoria)

1. Crear `services/tasks/types.ts`.
2. Crear `services/tasks/BackgroundTaskManager.ts`.
3. Crear `services/tasks/index.ts`.
4. Crear `ipc/taskHandlers.ts`.
5. Registrar handlers en `lifecycle/initialization.ts`.
6. Agregar cleanup en `lifecycle/shutdown.ts`.

Resultado esperado:
- Sistema usable desde main (sin UI).

## Fase 2: Integración bash + preload (obligatoria)

1. Modificar `codingTools/tools/bash.ts` con `run_in_background`.
2. Crear `preload/api/tasks.ts`.
3. Modificar `preload/preload.ts` para exponer `window.levante.tasks`.

Resultado esperado:
- Funcionalidad usable desde renderer/API.

## Fase 3: UI de administración 

1. Crear store de tareas en renderer.
2. Crear sección en settings.
3. Integrar traducciones.

Resultado esperado:
- Usuario gestiona tareas visualmente.

---

## 17. Checklist ejecutable

### Pre-implementación
- [ ] Confirmar rama limpia para cambios nuevos.
- [ ] Confirmar que no existe `src/main/services/tasks`.

### Fase 1
- [ ] `src/main/services/tasks/types.ts`
- [ ] `src/main/services/tasks/BackgroundTaskManager.ts`
- [ ] `src/main/services/tasks/index.ts`
- [ ] `src/main/ipc/taskHandlers.ts`
- [ ] `src/main/lifecycle/initialization.ts`
- [ ] `src/main/lifecycle/shutdown.ts`

### Fase 2
- [ ] `src/main/services/ai/codingTools/tools/bash.ts`
- [ ] `src/preload/api/tasks.ts`
- [ ] `src/preload/preload.ts`

### Fase 3 (opcional)
- [ ] `src/renderer/stores/taskStore.ts`
- [ ] `src/renderer/components/settings/BackgroundTasksSection.tsx`
- [ ] `src/renderer/components/settings/index.ts`
- [ ] `src/renderer/pages/SettingsPage.tsx`
- [ ] `src/renderer/locales/en/settings.json`
- [ ] `src/renderer/locales/es/settings.json`

### Validación final
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] QA manual de background tasks

---

## 18. Riesgos y mitigaciones

1. Riesgo: doble emisión de eventos (`killed` + `complete`).
   - Mitigación: en `close`, no sobreescribir estado terminal si ya `KILLED`.

2. Riesgo: pérdida de líneas por chunking.
   - Mitigación: usar `stdoutRemainder/stderrRemainder`.

3. Riesgo: saturación de memoria por output masivo.
   - Mitigación: límites por bytes + líneas con estrategia FIFO.

4. Riesgo: rutas de preload incorrectas.
   - Mitigación: usar únicamente `src/preload/preload.ts` y `src/preload/api/tasks.ts`.

5. Riesgo: categoría de logger inexistente.
   - Mitigación: usar `logger.aiSdk`/`logger.ipc`/`logger.core`.

---

## 19. Rollback plan

Si hay regresión:

1. Revertir integración en `bash.ts` (desactivar `run_in_background`).
2. Mantener código `services/tasks` sin usar (no afecta flujo foreground).
3. Remover registro de handlers en `initialization.ts`.
4. Remover API de preload `tasks`.

Esto restaura comportamiento previo sin tocar MCP ni chat base.

---

## 20. Definición de terminado

El ticket está terminado cuando:

1. Funciona `run_in_background` desde `bash`.
2. Se puede operar ciclo completo: spawn -> list -> getOutput -> wait/kill -> cleanup.
3. No quedan procesos huérfanos al cerrar app.
4. `typecheck` y tests pasan.
5. (si fase UI) la sección de tareas es usable y estable.

---

## 21. Notas de implementación para IA ejecutora

1. No inventar rutas nuevas fuera de las listadas.
2. No usar categoría `logger.coding`.
3. No tocar MCP ni `mcpToolsAdapter.ts`.
4. Mantener compatibilidad completa con el comportamiento actual de `bash` cuando `run_in_background` no se use.
5. Priorizar cambios pequeños, compilables y testeables por fase.
