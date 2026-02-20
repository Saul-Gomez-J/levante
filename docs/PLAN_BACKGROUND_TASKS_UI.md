# Runbook Completo: Background Tasks UI + AI Tools (Cowork)

## Documento
- Estado: `READY FOR IMPLEMENTATION`
- Versión: `3.0`
- Fecha: `2026-02-20`
- Audiencia: IA ejecutora sin contexto previo
- Objetivo: implementar capa de tools para gestionar background tasks desde el agente + panel UI en chat para usuario final.

---

## 1) Objetivo funcional final

Al terminar esta implementación:

1. El agente en Cowork mode tendrá 3 tools nuevas:
   - `getTaskOutput`
   - `killTask`
   - `listTasks`
2. El usuario verá un dropdown en la barra del chat para:
   - listar tareas en background
   - ver output
   - matar tareas running
   - limpiar tareas terminadas
3. Todo debe funcionar contra el contrato IPC real del proyecto: `IPCResult<T> = { success, data?, error? }`.

---

## 2) Estado real actual (importante)

Esta base YA existe en el repo y NO hay que re-implementarla:

1. Manager de tareas background:
   - `src/main/services/tasks/BackgroundTaskManager.ts`
2. Tipos de tareas:
   - `src/main/services/tasks/types.ts`
3. Export de servicio:
   - `src/main/services/tasks/index.ts`
4. IPC handlers de tasks:
   - `src/main/ipc/taskHandlers.ts`
5. Registro de handlers en lifecycle:
   - `src/main/lifecycle/initialization.ts`
6. Cleanup al apagar app:
   - `src/main/lifecycle/shutdown.ts`
7. API preload de tasks:
   - `src/preload/api/tasks.ts`
   - `src/preload/preload.ts` (expuesto en `window.levante.tasks`)
8. `bash` tool ya soporta `run_in_background`:
   - `src/main/services/ai/codingTools/tools/bash.ts`

---

## 3) Alcance de este runbook

Este documento SOLO implementa lo faltante para completar la feature UI + tools de agente:

1. Añadir 3 coding tools para gestionar tasks desde la IA.
2. Registrar esas tools en `getCodingTools`.
3. Añadir store Zustand en renderer para consumir `window.levante.tasks`.
4. Crear dropdown UI en chat.
5. Integrar dropdown en `ToolsMenu`.
6. Añadir i18n en `chat.json` EN/ES.

---

## 4) Archivos a crear/modificar

## 4.1 Nuevos

1. `src/main/services/ai/codingTools/tools/task-output.ts`
2. `src/main/services/ai/codingTools/tools/kill-task.ts`
3. `src/main/services/ai/codingTools/tools/list-tasks.ts`
4. `src/renderer/stores/taskStore.ts`
5. `src/renderer/components/chat/BackgroundTasksDropdown.tsx`

## 4.2 Modificados

1. `src/main/services/ai/codingTools/index.ts`
2. `src/main/services/aiService.ts` (solo tipado `codeMode.tools`)
3. `src/preload/types/index.ts` (solo tipado `codeMode.tools`)
4. `src/renderer/components/chat/ToolsMenu.tsx`
5. `src/renderer/locales/en/chat.json`
6. `src/renderer/locales/es/chat.json`

## 4.3 No tocar

1. `src/main/ipc/taskHandlers.ts`
2. `src/preload/api/tasks.ts`
3. `src/preload/preload.ts`
4. `src/main/services/tasks/*`

Esos contratos ya están correctos y alineados con `IPCResult`.

---

## 5) Contratos a respetar

## 5.1 Estados de task

Usar exactamente:
- `running`
- `completed`
- `failed`
- `killed`

## 5.2 Campo de cierre en task

Usar `completedAt` (NO `endedAt`).

## 5.3 API tasks en renderer

Siempre llega `IPCResult<T>`:

```ts
type IPCResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};
```

No asumir respuestas planas.

---

## 6) Implementación exacta

## 6.1 Crear `src/main/services/ai/codingTools/tools/task-output.ts`

```ts
/**
 * Tool: getTaskOutput
 *
 * Read output from a background task started via bash(run_in_background=true).
 */

import { tool } from "ai";
import { z } from "zod";
import { taskManager } from "../../../tasks";

export interface TaskOutputToolConfig {
  cwd: string;
}

export function createTaskOutputTool(config: TaskOutputToolConfig) {
  return tool({
    description: `Get output from a background task started with bash(run_in_background=true).
Use this to inspect logs from long-running commands.
Current cowork directory: ${config.cwd}`,

    inputSchema: z.object({
      taskId: z.string().min(1).describe("Background task ID"),
      tail: z.number().int().positive().max(5000).optional().describe("Return only the last N lines"),
      includeTimestamps: z.boolean().optional().describe("Include timestamps and stream labels"),
    }),

    execute: async ({
      taskId,
      tail,
      includeTimestamps,
    }: {
      taskId: string;
      tail?: number;
      includeTimestamps?: boolean;
    }) => {
      const task = taskManager.getStatus(taskId);

      if (!task) {
        return {
          success: false,
          error: `Task not found: ${taskId}`,
        };
      }

      const output = taskManager.getOutput(taskId, {
        ...(tail !== undefined ? { tail } : {}),
        ...(includeTimestamps !== undefined ? { includeTimestamps } : {}),
      });

      return {
        success: true,
        taskId,
        status: task.status,
        pid: task.pid,
        exitCode: task.exitCode,
        completedAt: task.completedAt?.toISOString() ?? null,
        output: output ?? "",
      };
    },
  });
}
```

---

## 6.2 Crear `src/main/services/ai/codingTools/tools/kill-task.ts`

```ts
/**
 * Tool: killTask
 *
 * Stop a running background task by taskId.
 */

import { tool } from "ai";
import { z } from "zod";
import { taskManager, TaskStatus } from "../../../tasks";

export interface KillTaskToolConfig {
  cwd: string;
}

export function createKillTaskTool(config: KillTaskToolConfig) {
  return tool({
    description: `Kill a running background task.
Use this when a dev server/watch/build is no longer needed.
Current cowork directory: ${config.cwd}`,

    inputSchema: z.object({
      taskId: z.string().min(1).describe("Task ID to kill"),
    }),

    execute: async ({ taskId }: { taskId: string }) => {
      const task = taskManager.getStatus(taskId);

      if (!task) {
        return {
          success: false,
          error: `Task not found: ${taskId}`,
        };
      }

      if (task.status !== TaskStatus.RUNNING) {
        return {
          success: false,
          error: `Task is not running (status: ${task.status})`,
          exitCode: task.exitCode,
        };
      }

      const killed = taskManager.kill(taskId);

      if (!killed) {
        return {
          success: false,
          error: `Failed to kill task: ${taskId}`,
        };
      }

      const updated = taskManager.getStatus(taskId);
      const output = taskManager.getOutput(taskId, { tail: 100 }) ?? "";

      return {
        success: true,
        taskId,
        status: updated?.status ?? TaskStatus.KILLED,
        exitCode: updated?.exitCode ?? null,
        output,
        message: `Task ${taskId} killed successfully`,
      };
    },
  });
}
```

---

## 6.3 Crear `src/main/services/ai/codingTools/tools/list-tasks.ts`

```ts
/**
 * Tool: listTasks
 *
 * List background tasks and summary stats.
 */

import { tool } from "ai";
import { z } from "zod";
import { taskManager, TaskStatus } from "../../../tasks";

type ListStatus = "running" | "completed" | "failed" | "killed" | "all";

export interface ListTasksToolConfig {
  cwd: string;
}

export function createListTasksTool(config: ListTasksToolConfig) {
  return tool({
    description: `List background tasks with status, pid and timing info.
Use this to inspect active and completed background jobs.
Current cowork directory: ${config.cwd}`,

    inputSchema: z.object({
      status: z
        .enum(["running", "completed", "failed", "killed", "all"])
        .optional()
        .describe("Optional status filter. Default: all"),
    }),

    execute: async ({ status }: { status?: ListStatus }) => {
      const filter =
        status && status !== "all"
          ? { status: status as TaskStatus }
          : undefined;

      const tasks = taskManager.list(filter);
      const stats = taskManager.getStatistics();

      return {
        success: true,
        tasks: tasks.map((task) => ({
          taskId: task.id,
          command:
            task.command.length > 160
              ? `${task.command.slice(0, 160)}...`
              : task.command,
          status: task.status,
          pid: task.pid,
          exitCode: task.exitCode,
          startedAt: task.startedAt.toISOString(),
          completedAt: task.completedAt?.toISOString() ?? null,
        })),
        stats: {
          total: stats.total,
          running: stats.running,
          completed: stats.completed,
          failed: stats.failed,
          killed: stats.killed,
        },
      };
    },
  });
}
```

---

## 6.4 Reemplazar completo `src/main/services/ai/codingTools/index.ts`

```ts
/**
 * Coding Tools para Levante.
 * Herramientas de desarrollo: bash, read, write, edit, grep, find, ls.
 * Incluye gestión de tareas en background para Cowork mode.
 */

import { createBashTool, BashToolConfig } from "./tools/bash";
import { createReadTool, ReadToolConfig } from "./tools/read";
import { createWriteTool, WriteToolConfig } from "./tools/write";
import { createEditTool, EditToolConfig } from "./tools/edit";
import { createGrepTool, GrepToolConfig } from "./tools/grep";
import { createFindTool, FindToolConfig } from "./tools/find";
import { createLsTool, LsToolConfig } from "./tools/ls";
import {
  createTaskOutputTool,
  TaskOutputToolConfig,
} from "./tools/task-output";
import { createKillTaskTool, KillTaskToolConfig } from "./tools/kill-task";
import { createListTasksTool, ListTasksToolConfig } from "./tools/list-tasks";

export interface CodingToolsConfig {
  cwd: string;
  enabled?: {
    bash?: boolean;
    read?: boolean;
    write?: boolean;
    edit?: boolean;
    grep?: boolean;
    find?: boolean;
    ls?: boolean;
    taskOutput?: boolean;
    killTask?: boolean;
    listTasks?: boolean;
  };
  // Config específica por herramienta
  bash?: Partial<BashToolConfig>;
  read?: Partial<ReadToolConfig>;
  grep?: Partial<GrepToolConfig>;
  find?: Partial<FindToolConfig>;
  ls?: Partial<LsToolConfig>;
}

/**
 * Crear todas las coding tools configuradas.
 * Retorna un objeto compatible con Vercel AI SDK streamText().
 */
export function getCodingTools(config: CodingToolsConfig) {
  const enabled = {
    bash: true,
    read: true,
    write: true,
    edit: true,
    grep: true,
    find: true,
    ls: true,
    taskOutput: true,
    killTask: true,
    listTasks: true,
    ...config.enabled,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};

  if (enabled.bash) {
    tools.bash = createBashTool({
      cwd: config.cwd,
      ...config.bash,
    });
  }

  if (enabled.read) {
    tools.read = createReadTool({
      cwd: config.cwd,
      ...config.read,
    });
  }

  if (enabled.write) {
    tools.write = createWriteTool({
      cwd: config.cwd,
    });
  }

  if (enabled.edit) {
    tools.edit = createEditTool({
      cwd: config.cwd,
    });
  }

  if (enabled.grep) {
    tools.grep = createGrepTool({
      cwd: config.cwd,
      ...config.grep,
    });
  }

  if (enabled.find) {
    tools.find = createFindTool({
      cwd: config.cwd,
      ...config.find,
    });
  }

  if (enabled.ls) {
    tools.ls = createLsTool({
      cwd: config.cwd,
      ...config.ls,
    });
  }

  // Background task tools
  if (enabled.taskOutput) {
    tools.getTaskOutput = createTaskOutputTool({
      cwd: config.cwd,
    });
  }

  if (enabled.killTask) {
    tools.killTask = createKillTaskTool({
      cwd: config.cwd,
    });
  }

  if (enabled.listTasks) {
    tools.listTasks = createListTasksTool({
      cwd: config.cwd,
    });
  }

  return tools;
}

// Re-exportar tipos
export type { BashToolConfig } from "./tools/bash";
export type { ReadToolConfig } from "./tools/read";
export type { WriteToolConfig } from "./tools/write";
export type { EditToolConfig } from "./tools/edit";
export type { GrepToolConfig } from "./tools/grep";
export type { FindToolConfig } from "./tools/find";
export type { LsToolConfig } from "./tools/ls";
export type { TaskOutputToolConfig } from "./tools/task-output";
export type { KillTaskToolConfig } from "./tools/kill-task";
export type { ListTasksToolConfig } from "./tools/list-tasks";

// Re-exportar utilidades por si se necesitan
export { executeCommand } from "./utils/shell";
export { truncateHead, truncateTail, formatSize } from "./utils/truncate";
export { resolveToCwd, resolveReadPath, expandPath } from "./utils/path-utils";
```

---

## 6.5 Modificar tipado en `src/main/services/aiService.ts`

Dentro de `ChatRequest.codeMode.tools`, agregar los 3 flags.

Reemplazar este bloque:

```ts
tools?: {
  bash?: boolean;
  read?: boolean;
  write?: boolean;
  edit?: boolean;
  grep?: boolean;
  find?: boolean;
  ls?: boolean;
};
```

por:

```ts
tools?: {
  bash?: boolean;
  read?: boolean;
  write?: boolean;
  edit?: boolean;
  grep?: boolean;
  find?: boolean;
  ls?: boolean;
  taskOutput?: boolean;
  killTask?: boolean;
  listTasks?: boolean;
};
```

---

## 6.6 Modificar tipado en `src/preload/types/index.ts`

Dentro de `ChatRequest.codeMode.tools`, aplicar el mismo reemplazo:

```ts
tools?: {
  bash?: boolean;
  read?: boolean;
  write?: boolean;
  edit?: boolean;
  grep?: boolean;
  find?: boolean;
  ls?: boolean;
  taskOutput?: boolean;
  killTask?: boolean;
  listTasks?: boolean;
};
```

---

## 6.7 Crear `src/renderer/stores/taskStore.ts`

```ts
/**
 * Task store for Background Tasks dropdown.
 *
 * IMPORTANT: tasks API returns IPCResult<T> envelopes.
 */

import { create } from 'zustand';

export type TaskStatus = 'running' | 'completed' | 'failed' | 'killed';

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

export interface TaskStatsDTO {
  total: number;
  running: number;
  completed: number;
  failed: number;
  killed: number;
}

type IPCResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

function unwrapResult<T>(result: IPCResult<T>, fallbackMessage: string): T {
  if (!result.success) {
    throw new Error(result.error || fallbackMessage);
  }

  if (result.data === undefined) {
    throw new Error(result.error || fallbackMessage);
  }

  return result.data;
}

interface TaskStoreState {
  tasks: TaskInfoDTO[];
  stats: TaskStatsDTO;
  selectedTaskId: string | null;
  selectedTaskOutput: string | null;
  loading: boolean;
  error: string | null;

  fetchTasks: () => Promise<void>;
  killTask: (taskId: string) => Promise<boolean>;
  loadOutput: (taskId: string, tail?: number) => Promise<void>;
  cleanup: (maxAgeMs?: number) => Promise<number>;
  selectTask: (taskId: string | null) => void;
  clearError: () => void;
}

export const useTaskStore = create<TaskStoreState>((set, get) => ({
  tasks: [],
  stats: {
    total: 0,
    running: 0,
    completed: 0,
    failed: 0,
    killed: 0,
  },
  selectedTaskId: null,
  selectedTaskOutput: null,
  loading: false,
  error: null,

  fetchTasks: async () => {
    set({ loading: true, error: null });

    try {
      const [tasksResult, statsResult] = await Promise.all([
        window.levante.tasks.list(),
        window.levante.tasks.stats(),
      ]);

      const tasks = unwrapResult<TaskInfoDTO[]>(
        tasksResult,
        'Failed to fetch background tasks'
      );

      const stats = unwrapResult<TaskStatsDTO>(
        statsResult,
        'Failed to fetch background tasks stats'
      );

      const selectedTaskId = get().selectedTaskId;
      const selectedStillExists =
        selectedTaskId === null || tasks.some((task) => task.id === selectedTaskId);

      set({
        tasks,
        stats,
        loading: false,
        ...(selectedStillExists
          ? {}
          : { selectedTaskId: null, selectedTaskOutput: null }),
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch tasks',
      });
    }
  },

  killTask: async (taskId: string) => {
    try {
      const killResult = await window.levante.tasks.kill(taskId);
      const killed = unwrapResult<boolean>(killResult, 'Failed to kill task');

      if (!killed) {
        set({ error: `Task could not be killed: ${taskId}` });
        return false;
      }

      await get().fetchTasks();

      if (get().selectedTaskId === taskId) {
        await get().loadOutput(taskId, 100);
      }

      return true;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to kill task',
      });
      return false;
    }
  },

  loadOutput: async (taskId: string, tail?: number) => {
    try {
      const outputResult = await window.levante.tasks.getOutput(taskId, {
        ...(tail !== undefined ? { tail } : {}),
      });

      const output = unwrapResult<string>(
        outputResult,
        'Failed to load task output'
      );

      set({
        selectedTaskId: taskId,
        selectedTaskOutput: output,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load task output',
      });
    }
  },

  cleanup: async (maxAgeMs?: number) => {
    try {
      const cleanupResult = await window.levante.tasks.cleanup(maxAgeMs);
      const removedCount = unwrapResult<number>(
        cleanupResult,
        'Failed to cleanup tasks'
      );

      await get().fetchTasks();
      return removedCount;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to cleanup tasks',
      });
      return 0;
    }
  },

  selectTask: (taskId: string | null) => {
    set({
      selectedTaskId: taskId,
      selectedTaskOutput: taskId === null ? null : get().selectedTaskOutput,
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));
```

---

## 6.8 Crear `src/renderer/components/chat/BackgroundTasksDropdown.tsx`

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Square,
  Terminal,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  useTaskStore,
  type TaskInfoDTO,
  type TaskStatus,
} from '@/stores/taskStore';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

interface BackgroundTasksDropdownProps {
  className?: string;
}

const statusVariantMap: Record<TaskStatus, BadgeVariant> = {
  running: 'default',
  completed: 'secondary',
  failed: 'destructive',
  killed: 'outline',
};

function getStatusIcon(status: TaskStatus) {
  switch (status) {
    case 'running':
      return <Loader2 size={14} className="animate-spin text-blue-500" />;
    case 'completed':
      return <CheckCircle2 size={14} className="text-green-500" />;
    case 'failed':
      return <XCircle size={14} className="text-red-500" />;
    case 'killed':
      return <Square size={14} className="text-orange-500" />;
    default:
      return null;
  }
}

function formatClock(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getCommandPreview(command: string): string {
  return command.length > 75 ? `${command.slice(0, 75)}...` : command;
}

export function BackgroundTasksDropdown({ className }: BackgroundTasksDropdownProps) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);

  const {
    tasks,
    stats,
    loading,
    error,
    fetchTasks,
    killTask,
    loadOutput,
    cleanup,
    selectedTaskId,
    selectedTaskOutput,
    selectTask,
    clearError,
  } = useTaskStore();

  useEffect(() => {
    if (!open) {
      return;
    }

    void fetchTasks();
  }, [open, fetchTasks]);

  useEffect(() => {
    if (!open || stats.running === 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void fetchTasks();

      if (selectedTaskId) {
        void loadOutput(selectedTaskId, 100);
      }
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [open, stats.running, selectedTaskId, fetchTasks, loadOutput]);

  const handleOutputClick = async (task: TaskInfoDTO) => {
    if (selectedTaskId === task.id) {
      selectTask(null);
      return;
    }

    selectTask(task.id);
    await loadOutput(task.id, 100);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('relative rounded-lg text-muted-foreground h-8 w-8', className)}
          title={t('background_tasks.title', 'Background tasks')}
          type="button"
        >
          <Activity size={16} />
          {stats.running > 0 && (
            <Badge
              variant="default"
              className="absolute -top-1 -right-1 h-4 min-w-4 px-1 flex items-center justify-center text-[10px]"
            >
              {stats.running}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-[440px] p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="flex items-center gap-2">
            <Activity size={16} />
            <span className="text-sm font-medium">
              {t('background_tasks.title', 'Background tasks')}
            </span>
            {stats.running > 0 && (
              <Badge variant="default" className="text-xs">
                {t('background_tasks.running_count', {
                  count: stats.running,
                  defaultValue: '{{count}} running',
                })}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => void fetchTasks()}
              disabled={loading}
              title={t('background_tasks.refresh', 'Refresh')}
              type="button"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </Button>

            {stats.total > stats.running && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => void cleanup()}
                title={t('background_tasks.cleanup', 'Cleanup completed tasks')}
                type="button"
              >
                <Trash2 size={14} />
              </Button>
            )}
          </div>
        </div>

        {error && (
          <div className="mx-2 mt-2 p-2 rounded-md border border-amber-200 bg-amber-50 text-amber-800 text-xs flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium">
                {t('background_tasks.error_prefix', 'Task error')}
              </p>
              <p className="break-words">{error}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={clearError}
              type="button"
            >
              <X size={12} />
            </Button>
          </div>
        )}

        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Terminal size={30} className="mb-2 opacity-50" />
            <p className="text-sm">{t('background_tasks.no_tasks', 'No background tasks')}</p>
            <p className="text-xs text-center px-4">
              {t(
                'background_tasks.no_tasks_hint',
                'Tasks started with run_in_background will appear here'
              )}
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[420px]">
            <div className="p-2 space-y-1">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className={cn(
                    'p-2 rounded-md border text-sm',
                    selectedTaskId === task.id
                      ? 'bg-accent border-primary'
                      : 'hover:bg-accent/50'
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {getStatusIcon(task.status)}
                      <code className="text-xs font-mono truncate flex-1">
                        {getCommandPreview(task.command)}
                      </code>
                    </div>
                    <Badge variant={statusVariantMap[task.status]} className="text-xs shrink-0">
                      {t(`background_tasks.status.${task.status}`, task.status)}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground gap-2">
                    <div className="flex items-center gap-3 overflow-x-auto">
                      <span>
                        {t('background_tasks.task_id', 'ID')}: {task.id.slice(0, 8)}
                      </span>
                      {task.pid !== null && (
                        <span>
                          {t('background_tasks.pid', 'PID')}: {task.pid}
                        </span>
                      )}
                      <span>
                        {t('background_tasks.started', 'Started')}: {formatClock(task.startedAt)}
                      </span>
                      {task.exitCode !== null && (
                        <span>
                          {t('background_tasks.exit_code', 'Exit')}: {task.exitCode}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => void handleOutputClick(task)}
                        type="button"
                      >
                        <Terminal size={12} className="mr-1" />
                        {selectedTaskId === task.id
                          ? t('background_tasks.hide_output', 'Hide')
                          : t('background_tasks.output', 'Output')}
                      </Button>

                      {task.status === 'running' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                          onClick={() => void killTask(task.id)}
                          type="button"
                        >
                          <X size={12} className="mr-1" />
                          {t('background_tasks.kill', 'Kill')}
                        </Button>
                      )}
                    </div>
                  </div>

                  {selectedTaskId === task.id && (
                    <div className="mt-2 p-2 bg-muted rounded text-xs font-mono max-h-40 overflow-auto whitespace-pre-wrap break-words">
                      {selectedTaskOutput && selectedTaskOutput.length > 0
                        ? selectedTaskOutput
                        : '(no output)'}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {tasks.length > 0 && (
          <div className="px-3 py-2 border-t text-xs text-muted-foreground flex items-center gap-3">
            <span>
              {t('background_tasks.total', 'Total')}: {stats.total}
            </span>
            <span className="text-green-600">
              {t('background_tasks.completed', 'Completed')}: {stats.completed}
            </span>
            <span className="text-red-600">
              {t('background_tasks.failed', 'Failed')}: {stats.failed}
            </span>
            <span className="text-orange-600">
              {t('background_tasks.killed', 'Killed')}: {stats.killed}
            </span>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

---

## 6.9 Modificar `src/renderer/components/chat/ToolsMenu.tsx`

### 6.9.1 Import nuevo

Agregar junto al resto de imports:

```ts
import { BackgroundTasksDropdown } from '@/components/chat/BackgroundTasksDropdown';
```

### 6.9.2 Render del botón

Después del bloque del indicador Cowork (después del `</div>` que cierra el indicador), agregar:

```tsx
      {/* 3. Background Tasks Dropdown - Only when Cowork is enabled */}
      {coworkMode && (
        <BackgroundTasksDropdown />
      )}
```

### 6.9.3 Comentario de numeración (opcional)

El bloque de MCP wrench quedará como item 4 visualmente; si quieres, actualiza el comentario `/* 3. Tools Dropdown... */` a `/* 4. Tools Dropdown... */`.

---

## 6.10 Modificar `src/renderer/locales/en/chat.json`

Agregar este objeto en raíz (mismo nivel que `tools_menu`, `tool_approval_warning`, etc):

```json
"background_tasks": {
  "title": "Background Tasks",
  "running_count": "{{count}} running",
  "refresh": "Refresh",
  "cleanup": "Cleanup completed tasks",
  "no_tasks": "No background tasks",
  "no_tasks_hint": "Tasks started with run_in_background will appear here",
  "task_id": "ID",
  "pid": "PID",
  "started": "Started",
  "exit_code": "Exit",
  "output": "Output",
  "hide_output": "Hide",
  "kill": "Kill",
  "total": "Total",
  "completed": "Completed",
  "failed": "Failed",
  "killed": "Killed",
  "error_prefix": "Task error",
  "status": {
    "running": "running",
    "completed": "completed",
    "failed": "failed",
    "killed": "killed"
  }
}
```

---

## 6.11 Modificar `src/renderer/locales/es/chat.json`

Agregar este objeto en raíz:

```json
"background_tasks": {
  "title": "Tareas en Background",
  "running_count": "{{count}} ejecutándose",
  "refresh": "Actualizar",
  "cleanup": "Limpiar tareas completadas",
  "no_tasks": "No hay tareas en background",
  "no_tasks_hint": "Las tareas iniciadas con run_in_background aparecerán aquí",
  "task_id": "ID",
  "pid": "PID",
  "started": "Inicio",
  "exit_code": "Salida",
  "output": "Output",
  "hide_output": "Ocultar",
  "kill": "Matar",
  "total": "Total",
  "completed": "Completadas",
  "failed": "Fallidas",
  "killed": "Terminadas",
  "error_prefix": "Error de tarea",
  "status": {
    "running": "ejecutando",
    "completed": "completada",
    "failed": "fallida",
    "killed": "terminada"
  }
}
```

---

## 7) Validación técnica

Ejecutar:

```bash
pnpm typecheck
pnpm lint
```

Si hay test suite estable:

```bash
pnpm test
```

---

## 8) QA manual obligatoria

## 8.1 Flujo de agente (tools)

1. Abrir chat con Cowork mode activo y directorio seleccionado.
2. Pedir a la IA: “arranca `npm run dev` en background”.
3. Verificar que usa `bash` con `run_in_background: true` y devuelve `taskId`.
4. Pedir: “lista tareas activas” -> debe usar `listTasks`.
5. Pedir: “muéstrame la salida de esa tarea” -> debe usar `getTaskOutput`.
6. Pedir: “detén la tarea” -> debe usar `killTask`.

## 8.2 Flujo UI

1. Con Cowork activo, verificar que aparece icono de actividad en barra.
2. Abrir dropdown:
   - si no hay tareas, ver empty state
   - si hay tareas, ver lista + estados
3. Pulsar `Output` y ver log.
4. Pulsar `Kill` en una tarea `running` y confirmar cambio de estado.
5. Pulsar `Cleanup completed tasks` y confirmar reducción de tareas terminales.
6. Verificar auto-refresh cada 3s solo cuando el dropdown está abierto y hay tasks running.

---

## 9) Criterios de aceptación

La feature se considera terminada si:

1. `typecheck` y `lint` pasan.
2. Las 3 tools nuevas aparecen en Cowork mode.
3. El agente puede hacer ciclo completo:
   - `run_in_background` -> `listTasks` -> `getTaskOutput` -> `killTask`
4. El dropdown UI permite observar y gestionar tareas sin errores.
5. No hay cambios de contrato en IPC (se mantiene `IPCResult`).

---

## 10) Riesgos y mitigaciones

1. Riesgo: romper contrato frontend-backend por asumir respuestas planas.
   - Mitigación: usar `unwrapResult` en store para `IPCResult<T>`.
2. Riesgo: usar campo incorrecto `endedAt`.
   - Mitigación: usar `completedAt` en todos los mappings UI/tools.
3. Riesgo: duplicar lógica de core ya implementada.
   - Mitigación: no tocar `services/tasks`, `taskHandlers`, `preload/api/tasks`.

---

## 11) Checklist ejecutable

- [ ] Crear `task-output.ts`
- [ ] Crear `kill-task.ts`
- [ ] Crear `list-tasks.ts`
- [ ] Reemplazar `codingTools/index.ts`
- [ ] Actualizar tipado `codeMode.tools` en `aiService.ts`
- [ ] Actualizar tipado `codeMode.tools` en `preload/types/index.ts`
- [ ] Crear `taskStore.ts`
- [ ] Crear `BackgroundTasksDropdown.tsx`
- [ ] Integrar dropdown en `ToolsMenu.tsx`
- [ ] Añadir i18n EN/ES en `chat.json`
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] QA manual de flujos agente + UI

