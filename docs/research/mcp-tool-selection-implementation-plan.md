# Plan de Implementación: Selección Individual de Tools MCP

> **Fecha:** 2026-01-12
> **Basado en:** Investigación de mercado (Claude Desktop, Cursor, Cline, Continue.dev) + análisis del codebase

---

## Resumen

Implementar un sistema que permita a los usuarios seleccionar qué tools de cada servidor MCP estarán disponibles para el agente, siguiendo el patrón de **Claude Desktop** y **Cursor**.

### Características Principales
- Cache de tools en memoria al conectar + persistencia en JSON
- Toggle individual por tool
- Toggle por servidor (habilitar/deshabilitar todas)
- Warning cuando hay muchas tools (40+)
- Persistencia de preferencias entre sesiones

---

## Arquitectura Propuesta

```
┌─────────────────────────────────────────────────────────────────────┐
│                    FLUJO DE TOOLS MCP                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  CONEXIÓN                           PERSISTENCIA                    │
│  ┌──────────────┐                   ┌──────────────────────┐       │
│  │ connectServer│ ──listTools()──►  │ ui-preferences.json  │       │
│  └──────────────┘                   │ └─ mcp.toolsCache    │       │
│         │                           │ └─ mcp.disabledTools │       │
│         ▼                           └──────────────────────┘       │
│  ┌──────────────┐                            ▲                      │
│  │  mcpStore    │ ◄──────────────────────────┘                      │
│  │ .serverTools │                                                   │
│  │ .disabledTools│                                                  │
│  └──────────────┘                                                   │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐        │
│  │  ToolsMenu   │ ──► │ ChatRequest  │ ──► │ getMCPTools  │        │
│  │  (UI Select) │     │ +disabledTools│     │ (filtrado)   │        │
│  └──────────────┘     └──────────────┘     └──────────────┘        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Fase 1: Tipos e Interfaces

### 1.1 Nuevos tipos en `src/main/types/mcp.ts`

```typescript
// Añadir después de línea 67 (después de interface Tool)

/**
 * Tool con información de servidor para UI
 */
export interface ServerTool extends Tool {
  serverId: string;
  serverName?: string;
  enabled: boolean;  // Si está seleccionada para uso
}

/**
 * Cache de tools por servidor
 */
export interface ToolsCache {
  [serverId: string]: {
    tools: Tool[];
    lastUpdated: number;  // timestamp
  };
}

/**
 * Tools deshabilitadas por servidor
 * serverId → array de toolNames bloqueados
 * Si un servidor no está en el objeto, todas sus tools están habilitadas (default)
 * Ventajas de este enfoque:
 * - Nuevas tools quedan habilitadas automáticamente
 * - Lista más compacta (normalmente se bloquean pocas tools)
 * - Patrón usado por Claude Desktop (disallowedTools) y mcp-use
 */
export interface DisabledTools {
  [serverId: string]: string[];  // toolNames bloqueados
}
```

### 1.2 Actualizar `src/renderer/types/mcp.ts`

```typescript
// Exportar los nuevos tipos para el renderer
export type { ServerTool, ToolsCache, DisabledTools } from '../../../main/types/mcp';
```

---

## Fase 2: Persistencia en Preferencias

### 2.1 Actualizar schema de preferencias

**Archivo:** `src/main/services/preferencesService.ts` (o donde se define el schema)

Añadir al objeto `mcp`:

```typescript
mcp: {
  // ... existente ...

  /** Cache de tools por servidor (para mostrar en UI sin reconectar) */
  toolsCache?: ToolsCache;

  /** Tools deshabilitadas por servidor (las que NO se incluyen) */
  disabledTools?: DisabledTools;
}
```

### 2.2 Estructura en `ui-preferences.json`

```json
{
  "mcp": {
    "servers": { ... },
    "disabled": { ... },
    "toolsCache": {
      "filesystem": {
        "tools": [
          { "name": "read_file", "description": "Read file contents" },
          { "name": "write_file", "description": "Write to file" },
          { "name": "delete_file", "description": "Delete a file" }
        ],
        "lastUpdated": 1704067200000
      },
      "github": {
        "tools": [
          { "name": "create_issue", "description": "Create GitHub issue" },
          { "name": "delete_repo", "description": "Delete repository" }
        ],
        "lastUpdated": 1704067200000
      }
    },
    "disabledTools": {
      "filesystem": ["delete_file"],
      "github": ["delete_repo"]
    }
  }
}
```

> **Nota:** Solo se almacenan las tools bloqueadas. Si `disabledTools["filesystem"]` no existe o está vacío, todas las tools de ese servidor están habilitadas.

---

## Fase 3: Backend - Handlers IPC

### 3.1 Nuevo handler para gestión de tools

**Archivo:** `src/main/ipc/mcpHandlers/tools.ts`

```typescript
import { ipcMain } from 'electron';
import { mcpService } from '../mcpHandlers';
import { preferencesService } from '../../services/preferencesService';
import type { Tool, ToolsCache, DisabledTools } from '../../types/mcp';

// Handler existente: levante/mcp/list-tools
// Ya existe, solo necesita actualizar el cache

/**
 * Obtener tools de un servidor y actualizar cache
 */
ipcMain.handle('levante/mcp/list-tools', async (_, serverId: string) => {
  try {
    const tools = await mcpService.listTools(serverId);

    // Actualizar cache en preferencias
    const prefs = await preferencesService.getAll();
    const toolsCache: ToolsCache = prefs.mcp?.toolsCache || {};

    toolsCache[serverId] = {
      tools,
      lastUpdated: Date.now()
    };

    await preferencesService.set('mcp.toolsCache', toolsCache);

    return { success: true, data: tools };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list tools'
    };
  }
});

/**
 * Obtener cache de tools (sin reconectar)
 */
ipcMain.handle('levante/mcp/get-tools-cache', async () => {
  try {
    const prefs = await preferencesService.getAll();
    return { success: true, data: prefs.mcp?.toolsCache || {} };
  } catch (error) {
    return { success: false, error: 'Failed to get tools cache' };
  }
});

/**
 * Obtener tools deshabilitadas
 */
ipcMain.handle('levante/mcp/get-disabled-tools', async () => {
  try {
    const prefs = await preferencesService.getAll();
    return { success: true, data: prefs.mcp?.disabledTools || {} };
  } catch (error) {
    return { success: false, error: 'Failed to get disabled tools' };
  }
});

/**
 * Actualizar tools deshabilitadas para un servidor
 */
ipcMain.handle('levante/mcp/set-disabled-tools', async (
  _,
  serverId: string,
  toolNames: string[]
) => {
  try {
    const prefs = await preferencesService.getAll();
    const disabledTools: DisabledTools = prefs.mcp?.disabledTools || {};

    if (toolNames.length === 0) {
      // Si no hay tools deshabilitadas, eliminar la entrada
      delete disabledTools[serverId];
    } else {
      disabledTools[serverId] = toolNames;
    }

    await preferencesService.set('mcp.disabledTools', disabledTools);

    return { success: true };
  } catch (error) {
    return { success: false, error: 'Failed to set disabled tools' };
  }
});

/**
 * Toggle una tool específica (habilitar/deshabilitar)
 * enabled=true → quitar de disabledTools (habilitar)
 * enabled=false → añadir a disabledTools (deshabilitar)
 */
ipcMain.handle('levante/mcp/toggle-tool', async (
  _,
  serverId: string,
  toolName: string,
  enabled: boolean
) => {
  try {
    const prefs = await preferencesService.getAll();
    const disabledTools: DisabledTools = prefs.mcp?.disabledTools || {};

    // Inicializar array si no existe
    if (!disabledTools[serverId]) {
      disabledTools[serverId] = [];
    }

    if (enabled) {
      // Habilitar = quitar de la lista de deshabilitadas
      disabledTools[serverId] = disabledTools[serverId].filter(n => n !== toolName);
      // Limpiar si queda vacío
      if (disabledTools[serverId].length === 0) {
        delete disabledTools[serverId];
      }
    } else {
      // Deshabilitar = añadir a la lista
      if (!disabledTools[serverId].includes(toolName)) {
        disabledTools[serverId].push(toolName);
      }
    }

    await preferencesService.set('mcp.disabledTools', disabledTools);

    return { success: true, data: disabledTools[serverId] || [] };
  } catch (error) {
    return { success: false, error: 'Failed to toggle tool' };
  }
});

/**
 * Habilitar/deshabilitar todas las tools de un servidor
 * enabled=true → vaciar disabledTools (habilitar todas)
 * enabled=false → añadir todas a disabledTools (deshabilitar todas)
 */
ipcMain.handle('levante/mcp/toggle-all-tools', async (
  _,
  serverId: string,
  enabled: boolean
) => {
  try {
    const prefs = await preferencesService.getAll();
    const disabledTools: DisabledTools = prefs.mcp?.disabledTools || {};
    const toolsCache: ToolsCache = prefs.mcp?.toolsCache || {};

    if (enabled) {
      // Habilitar todas = eliminar entrada de disabledTools
      delete disabledTools[serverId];
    } else {
      // Deshabilitar todas = añadir todas las tools al array
      const serverTools = toolsCache[serverId]?.tools || [];
      disabledTools[serverId] = serverTools.map(t => t.name);
    }

    await preferencesService.set('mcp.disabledTools', disabledTools);

    return { success: true, data: disabledTools[serverId] || [] };
  } catch (error) {
    return { success: false, error: 'Failed to toggle all tools' };
  }
});

/**
 * Limpiar cache y disabled tools de un servidor (al eliminar servidor)
 */
ipcMain.handle('levante/mcp/clear-server-tools', async (_, serverId: string) => {
  try {
    const prefs = await preferencesService.getAll();

    // Limpiar cache
    const toolsCache: ToolsCache = { ...prefs.mcp?.toolsCache };
    delete toolsCache[serverId];

    // Limpiar disabled tools
    const disabledTools: DisabledTools = { ...prefs.mcp?.disabledTools };
    delete disabledTools[serverId];

    await preferencesService.set('mcp.toolsCache', toolsCache);
    await preferencesService.set('mcp.disabledTools', disabledTools);

    return { success: true };
  } catch (error) {
    return { success: false, error: 'Failed to clear server tools' };
  }
});
```

### 3.2 Actualizar Preload API

**Archivo:** `src/preload/api/mcp.ts`

```typescript
// Añadir a la API existente

// Tools management
getToolsCache: () =>
  ipcRenderer.invoke('levante/mcp/get-tools-cache'),

getDisabledTools: () =>
  ipcRenderer.invoke('levante/mcp/get-disabled-tools'),

setDisabledTools: (serverId: string, toolNames: string[]) =>
  ipcRenderer.invoke('levante/mcp/set-disabled-tools', serverId, toolNames),

toggleTool: (serverId: string, toolName: string, enabled: boolean) =>
  ipcRenderer.invoke('levante/mcp/toggle-tool', serverId, toolName, enabled),

toggleAllTools: (serverId: string, enabled: boolean) =>
  ipcRenderer.invoke('levante/mcp/toggle-all-tools', serverId, enabled),

clearServerTools: (serverId: string) =>
  ipcRenderer.invoke('levante/mcp/clear-server-tools', serverId),
```

---

## Fase 4: Frontend - Store

### 4.1 Actualizar `src/renderer/stores/mcpStore.ts`

```typescript
import { create } from 'zustand';
import type {
  MCPServerConfig,
  MCPConnectionStatus,
  Tool,
  ToolsCache,
  DisabledTools
} from '../types/mcp';

interface MCPStore {
  // Estado existente...
  activeServers: MCPServerConfig[];
  connectionStatus: Record<string, MCPConnectionStatus>;
  isLoading: boolean;
  error: string | null;

  // NUEVO: Estado de tools
  toolsCache: ToolsCache;
  disabledTools: DisabledTools;  // Tools bloqueadas por servidor
  loadingTools: Record<string, boolean>;  // serverId → loading state

  // Acciones existentes...

  // NUEVO: Acciones de tools
  loadToolsCache: () => Promise<void>;
  loadDisabledTools: () => Promise<void>;
  fetchServerTools: (serverId: string) => Promise<Tool[]>;
  toggleTool: (serverId: string, toolName: string, enabled: boolean) => Promise<void>;
  toggleAllTools: (serverId: string, enabled: boolean) => Promise<void>;
  isToolEnabled: (serverId: string, toolName: string) => boolean;
  getServerTools: (serverId: string) => Tool[];
  getEnabledToolsCount: (serverId: string) => number;
  getDisabledToolsCount: (serverId: string) => number;
  getTotalToolsCount: () => number;
  getEnabledToolsTotal: () => number;
}

export const useMCPStore = create<MCPStore>((set, get) => ({
  // Estado inicial existente...

  // NUEVO: Estado inicial de tools
  toolsCache: {},
  disabledTools: {},  // Vacío = todas habilitadas por defecto
  loadingTools: {},

  // NUEVO: Cargar cache de tools desde preferencias
  loadToolsCache: async () => {
    try {
      const result = await window.levante.mcp.getToolsCache();
      if (result.success && result.data) {
        set({ toolsCache: result.data });
      }
    } catch (error) {
      console.error('Failed to load tools cache:', error);
    }
  },

  // NUEVO: Cargar tools deshabilitadas desde preferencias
  loadDisabledTools: async () => {
    try {
      const result = await window.levante.mcp.getDisabledTools();
      if (result.success && result.data) {
        set({ disabledTools: result.data });
      }
    } catch (error) {
      console.error('Failed to load disabled tools:', error);
    }
  },

  // NUEVO: Obtener tools de un servidor (con actualización de cache)
  fetchServerTools: async (serverId: string) => {
    set(state => ({
      loadingTools: { ...state.loadingTools, [serverId]: true }
    }));

    try {
      const result = await window.levante.mcp.listTools(serverId);

      if (result.success && result.data) {
        const tools = result.data;

        // Actualizar cache local
        set(state => ({
          toolsCache: {
            ...state.toolsCache,
            [serverId]: {
              tools,
              lastUpdated: Date.now()
            }
          },
          loadingTools: { ...state.loadingTools, [serverId]: false }
        }));

        // Con disabledTools, NO necesitamos inicializar nada
        // Si no hay entrada en disabledTools, todas están habilitadas por defecto

        return tools;
      }

      return [];
    } catch (error) {
      console.error('Failed to fetch server tools:', error);
      set(state => ({
        loadingTools: { ...state.loadingTools, [serverId]: false }
      }));
      return [];
    }
  },

  // NUEVO: Toggle una tool específica
  // enabled=true → quitar de disabledTools
  // enabled=false → añadir a disabledTools
  toggleTool: async (serverId: string, toolName: string, enabled: boolean) => {
    try {
      const result = await window.levante.mcp.toggleTool(serverId, toolName, enabled);

      if (result.success) {
        set(state => {
          const newDisabledTools = { ...state.disabledTools };
          if (result.data && result.data.length > 0) {
            newDisabledTools[serverId] = result.data;
          } else {
            // Si no hay tools deshabilitadas, eliminar la entrada
            delete newDisabledTools[serverId];
          }
          return { disabledTools: newDisabledTools };
        });
      }
    } catch (error) {
      console.error('Failed to toggle tool:', error);
    }
  },

  // NUEVO: Toggle todas las tools de un servidor
  toggleAllTools: async (serverId: string, enabled: boolean) => {
    try {
      const result = await window.levante.mcp.toggleAllTools(serverId, enabled);

      if (result.success) {
        set(state => {
          const newDisabledTools = { ...state.disabledTools };
          if (result.data && result.data.length > 0) {
            newDisabledTools[serverId] = result.data;
          } else {
            delete newDisabledTools[serverId];
          }
          return { disabledTools: newDisabledTools };
        });
      }
    } catch (error) {
      console.error('Failed to toggle all tools:', error);
    }
  },

  // NUEVO: Verificar si una tool está habilitada
  // Con disabledTools: habilitada si NO está en la lista
  isToolEnabled: (serverId: string, toolName: string) => {
    const { disabledTools } = get();

    // Si no hay entrada para este servidor, todas están habilitadas
    if (!disabledTools[serverId]) {
      return true;
    }

    // Habilitada si NO está en la lista de deshabilitadas
    return !disabledTools[serverId].includes(toolName);
  },

  // NUEVO: Obtener tools de un servidor desde cache
  getServerTools: (serverId: string) => {
    const { toolsCache } = get();
    return toolsCache[serverId]?.tools || [];
  },

  // NUEVO: Contar tools habilitadas de un servidor
  getEnabledToolsCount: (serverId: string) => {
    const { disabledTools, toolsCache } = get();
    const totalTools = toolsCache[serverId]?.tools?.length || 0;
    const disabledCount = disabledTools[serverId]?.length || 0;

    return totalTools - disabledCount;
  },

  // NUEVO: Contar tools deshabilitadas de un servidor
  getDisabledToolsCount: (serverId: string) => {
    const { disabledTools } = get();
    return disabledTools[serverId]?.length || 0;
  },

  // NUEVO: Contar total de tools de todos los servidores
  getTotalToolsCount: () => {
    const { toolsCache } = get();
    return Object.values(toolsCache).reduce(
      (sum, cache) => sum + (cache.tools?.length || 0),
      0
    );
  },

  // NUEVO: Contar total de tools habilitadas
  getEnabledToolsTotal: () => {
    const { disabledTools, toolsCache, activeServers } = get();

    return activeServers.reduce((sum, server) => {
      if (!server.enabled) return sum;

      const totalTools = toolsCache[server.id]?.tools?.length || 0;
      const disabledCount = disabledTools[server.id]?.length || 0;

      return sum + (totalTools - disabledCount);
    }, 0);
  },

  // Modificar removeServer existente para limpiar tools
  removeServer: async (serverId: string) => {
    // ... código existente ...

    // NUEVO: Limpiar tools cache y disabled tools
    try {
      await window.levante.mcp.clearServerTools(serverId);
      set(state => {
        const newToolsCache = { ...state.toolsCache };
        const newDisabledTools = { ...state.disabledTools };
        delete newToolsCache[serverId];
        delete newDisabledTools[serverId];
        return { toolsCache: newToolsCache, disabledTools: newDisabledTools };
      });
    } catch (error) {
      console.warn('Failed to clear server tools:', error);
    }
  },
}));
```

---

## Fase 5: Modificar getMCPTools para Filtrar

### 5.1 Actualizar `src/main/services/ai/mcpToolsAdapter.ts`

```typescript
// Línea 29 - Modificar firma de la función
export async function getMCPTools(
  disabledTools?: DisabledTools  // NUEVO PARÁMETRO: tools a excluir
): Promise<Record<string, any>> {
  const startTime = Date.now();

  try {
    const config = await configManager.loadConfiguration();
    const allTools: Record<string, any> = {};
    const serverEntries = Object.entries(config.mcpServers);

    // ... código existente de conexión (PHASE 1 y 2) ...

    // PHASE 3: Convert tools to AI SDK format (MODIFICADO)
    for (const result of toolsResults) {
      if (result.status !== "fulfilled" || !result.value.success) continue;

      const { serverId, tools: serverTools } = result.value;

      for (const mcpTool of serverTools) {
        // Validación existente...
        if (!mcpTool.name || mcpTool.name.trim() === "") {
          continue;
        }

        // NUEVO: Filtrar tools deshabilitadas
        if (disabledTools) {
          const serverDisabled = disabledTools[serverId];
          // Si la tool está en la lista de deshabilitadas, saltar
          if (serverDisabled && serverDisabled.includes(mcpTool.name)) {
            logger.aiSdk.debug("Tool filtered out (disabled)", {
              serverId,
              toolName: mcpTool.name,
            });
            continue;  // Saltar esta tool
          }
        }

        const toolId = `${serverId}_${mcpTool.name}`;

        // ... resto del código existente ...

        const aiTool = createAISDKTool(serverId, mcpTool);
        if (!aiTool) continue;

        allTools[toolId] = aiTool;
      }

      // ... log existente ...
    }

    // NUEVO: Log de filtrado
    if (disabledTools && Object.keys(disabledTools).length > 0) {
      const totalDisabled = Object.values(disabledTools).reduce(
        (sum, arr) => sum + arr.length, 0
      );
      logger.aiSdk.info("MCP tools filtered", {
        totalEnabled: Object.keys(allTools).length,
        totalDisabled,
      });
    }

    return allTools;
  } catch (error) {
    // ... manejo de error existente ...
  }
}
```

### 5.2 Actualizar llamada en `src/main/services/aiService.ts`

```typescript
// En streamChat(), alrededor de línea 943-1014

if (enableMCP) {
  // NUEVO: Obtener tools deshabilitadas desde preferencias
  const prefs = await preferencesService.getAll();
  const disabledTools = prefs.mcp?.disabledTools;

  // Pasar lista de deshabilitadas a getMCPTools (se excluirán)
  const mcpTools = await getMCPTools(disabledTools);
  tools = { ...builtInTools, ...mcpTools };

  // NUEVO: Warning si hay muchas tools
  const toolCount = Object.keys(mcpTools).length;
  if (toolCount > 40) {
    logger.aiSdk.warn("High number of MCP tools may impact performance", {
      toolCount,
      recommendation: "Consider disabling unused tools in Settings > MCP"
    });
  }
}
```

---

## Fase 6: Componente UI

### 6.1 Nuevo componente `ToolSelector.tsx`

**Archivo:** `src/renderer/components/settings/ToolSelector.tsx`

```tsx
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMCPStore } from '@/stores/mcpStore';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  AlertTriangle
} from 'lucide-react';
import type { Tool } from '@/types/mcp';

interface ToolSelectorProps {
  serverId: string;
  serverName: string;
}

export function ToolSelector({ serverId, serverName }: ToolSelectorProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const {
    toolsCache,
    disabledTools,
    loadingTools,
    fetchServerTools,
    toggleTool,
    toggleAllTools,
    isToolEnabled,
    getEnabledToolsCount,
  } = useMCPStore();

  const tools = toolsCache[serverId]?.tools || [];
  const enabledCount = getEnabledToolsCount(serverId);
  const isLoading = loadingTools[serverId] || false;

  // Cargar tools cuando se expande
  useEffect(() => {
    if (isOpen && tools.length === 0) {
      fetchServerTools(serverId);
    }
  }, [isOpen, serverId, tools.length]);

  const allEnabled = enabledCount === tools.length;
  const someEnabled = enabledCount > 0 && enabledCount < tools.length;

  const handleToggleAll = () => {
    toggleAllTools(serverId, !allEnabled);
  };

  const handleRefresh = async () => {
    await fetchServerTools(serverId);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border rounded-lg p-3">
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between cursor-pointer">
            <div className="flex items-center gap-2">
              {isOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <span className="font-medium">{serverName}</span>
              <Badge variant="secondary">
                {enabledCount}/{tools.length} tools
              </Badge>
            </div>

            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-3 pt-3 border-t">
            {/* Toggle all */}
            <div className="flex items-center justify-between mb-3 pb-2 border-b">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={allEnabled}
                  // @ts-ignore - indeterminate is valid
                  indeterminate={someEnabled}
                  onCheckedChange={handleToggleAll}
                />
                <span className="text-sm font-medium">
                  {t('mcp.tools.select_all', 'Select all')}
                </span>
              </label>
            </div>

            {/* Tool list */}
            {isLoading ? (
              <div className="text-sm text-muted-foreground py-2">
                {t('mcp.tools.loading', 'Loading tools...')}
              </div>
            ) : tools.length === 0 ? (
              <div className="text-sm text-muted-foreground py-2">
                {t('mcp.tools.no_tools', 'No tools available')}
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {tools.map((tool: Tool) => (
                  <ToolItem
                    key={tool.name}
                    tool={tool}
                    enabled={isToolEnabled(serverId, tool.name)}
                    onToggle={(enabled) => toggleTool(serverId, tool.name, enabled)}
                  />
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

interface ToolItemProps {
  tool: Tool;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

function ToolItem({ tool, enabled, onToggle }: ToolItemProps) {
  return (
    <label className="flex items-start gap-2 cursor-pointer p-2 hover:bg-accent rounded">
      <Checkbox
        checked={enabled}
        onCheckedChange={onToggle}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{tool.name}</div>
        {tool.description && (
          <div className="text-xs text-muted-foreground line-clamp-2">
            {tool.description}
          </div>
        )}
      </div>
    </label>
  );
}
```

### 6.2 Componente de Warning

**Archivo:** `src/renderer/components/settings/ToolsWarning.tsx`

```tsx
import { useMCPStore } from '@/stores/mcpStore';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const TOOLS_WARNING_THRESHOLD = 40;
const TOOLS_LIMIT = 80;

export function ToolsWarning() {
  const { t } = useTranslation();
  const { getEnabledToolsTotal } = useMCPStore();

  const totalEnabled = getEnabledToolsTotal();

  if (totalEnabled < TOOLS_WARNING_THRESHOLD) {
    return null;
  }

  const isOverLimit = totalEnabled >= TOOLS_LIMIT;

  return (
    <Alert variant={isOverLimit ? "destructive" : "warning"}>
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>
        {isOverLimit ? (
          t('mcp.tools.over_limit',
            `You have ${totalEnabled} tools enabled. This exceeds the recommended limit of ${TOOLS_LIMIT} and may significantly impact performance.`
          )
        ) : (
          t('mcp.tools.warning',
            `You have ${totalEnabled} tools enabled. Consider disabling unused tools for better performance (recommended: <${TOOLS_WARNING_THRESHOLD}).`
          )
        )}
      </AlertDescription>
    </Alert>
  );
}
```

### 6.3 Integrar en Settings

**Archivo:** `src/renderer/components/settings/MCPSection.tsx` (o equivalente)

```tsx
import { ToolSelector } from './ToolSelector';
import { ToolsWarning } from './ToolsWarning';
import { useMCPStore } from '@/stores/mcpStore';

export function MCPSection() {
  const { activeServers, connectionStatus } = useMCPStore();

  // Filtrar solo servidores conectados
  const connectedServers = activeServers.filter(
    server => connectionStatus[server.id] === 'connected'
  );

  return (
    <div className="space-y-4">
      {/* Warning de tools */}
      <ToolsWarning />

      {/* Sección existente de servidores... */}

      {/* Nueva sección: Tool Selection */}
      <div className="space-y-3">
        <h3 className="text-lg font-medium">
          {t('mcp.tools.title', 'Tool Selection')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t('mcp.tools.description',
            'Select which tools from each MCP server will be available to the AI agent.'
          )}
        </p>

        {connectedServers.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t('mcp.tools.no_servers', 'No MCP servers connected')}
          </div>
        ) : (
          <div className="space-y-2">
            {connectedServers.map(server => (
              <ToolSelector
                key={server.id}
                serverId={server.id}
                serverName={server.name || server.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## Fase 7: Inicialización

### 7.1 Cargar estado al iniciar la app

**Archivo:** `src/renderer/App.tsx` (o donde se inicializa)

```tsx
import { useEffect } from 'react';
import { useMCPStore } from '@/stores/mcpStore';

function App() {
  const { loadToolsCache, loadDisabledTools } = useMCPStore();

  useEffect(() => {
    // Cargar cache y tools deshabilitadas al iniciar
    loadToolsCache();
    loadDisabledTools();
  }, []);

  // ... resto del componente
}
```

### 7.2 Actualizar cache al conectar servidor

**Archivo:** `src/renderer/stores/mcpStore.ts` - método `connectServer`

```typescript
connectServer: async (config: MCPServerConfig) => {
  // ... código existente de conexión ...

  if (result.success) {
    // ... código existente ...

    // NUEVO: Cargar tools del servidor recién conectado
    setTimeout(() => {
      get().fetchServerTools(config.id);
    }, 500);  // Pequeño delay para asegurar que la conexión está establecida
  }
},
```

---

## Fase 8: Manejar `tools/list_changed`

### 8.1 Listener para notificaciones MCP

**Archivo:** `src/main/services/mcp/mcpUseService.ts` (o donde se maneje)

```typescript
// Al conectar un servidor, registrar listener para list_changed
session.on('tools/list_changed', async () => {
  logger.mcp.info('Tools list changed notification', { serverId });

  // Obtener nueva lista de tools
  const tools = await session.listTools();

  // Actualizar cache
  const prefs = await preferencesService.getAll();
  const toolsCache = prefs.mcp?.toolsCache || {};

  toolsCache[serverId] = {
    tools,
    lastUpdated: Date.now()
  };

  await preferencesService.set('mcp.toolsCache', toolsCache);

  // Notificar al renderer
  mainWindow?.webContents.send('mcp:tools-updated', { serverId, tools });
});
```

### 8.2 Listener en renderer

**Archivo:** `src/renderer/hooks/useMCPEvents.ts` (nuevo hook)

```typescript
import { useEffect } from 'react';
import { useMCPStore } from '@/stores/mcpStore';

export function useMCPEvents() {
  const { loadToolsCache } = useMCPStore();

  useEffect(() => {
    const handleToolsUpdated = (_event: any, data: { serverId: string }) => {
      console.log('Tools updated for server:', data.serverId);
      loadToolsCache();  // Recargar cache completo
    };

    window.levante.on?.('mcp:tools-updated', handleToolsUpdated);

    return () => {
      window.levante.off?.('mcp:tools-updated', handleToolsUpdated);
    };
  }, [loadToolsCache]);
}
```

---

## Resumen de Archivos a Modificar/Crear

### Nuevos Archivos
| Archivo | Descripción |
|---------|-------------|
| `src/renderer/components/settings/ToolSelector.tsx` | Componente de selección de tools |
| `src/renderer/components/settings/ToolsWarning.tsx` | Warning de muchas tools |
| `src/renderer/hooks/useMCPEvents.ts` | Hook para eventos MCP |

### Archivos a Modificar
| Archivo | Cambios |
|---------|---------|
| `src/main/types/mcp.ts` | Añadir `ServerTool`, `ToolsCache`, `DisabledTools` |
| `src/main/ipc/mcpHandlers/tools.ts` | Nuevos handlers IPC |
| `src/preload/api/mcp.ts` | Nuevos métodos en API |
| `src/renderer/stores/mcpStore.ts` | Estado y acciones de tools con `disabledTools` |
| `src/main/services/ai/mcpToolsAdapter.ts` | Filtrado por `disabledTools` |
| `src/main/services/aiService.ts` | Pasar `disabledTools` a getMCPTools |
| `src/renderer/components/settings/MCPSection.tsx` | Integrar ToolSelector |
| `src/renderer/App.tsx` | Inicialización |

---

## Testing

### Casos de Prueba
1. **Conexión inicial**: Al conectar un servidor, todas las tools deben estar habilitadas por defecto
2. **Toggle individual**: Deshabilitar una tool y verificar que no aparece en el chat
3. **Toggle servidor**: Deshabilitar todas las tools de un servidor
4. **Persistencia**: Cerrar y abrir la app, verificar que la selección se mantiene
5. **Reconexión**: Reconectar un servidor y verificar que la selección se aplica
6. **Warning**: Verificar que aparece warning con 40+ tools
7. **Límite**: Verificar comportamiento con 80+ tools
8. **Eliminar servidor**: Verificar que se limpia cache y selección

---

## Consideraciones Adicionales

### Performance
- El cache evita llamadas innecesarias a `listTools()`
- La selección se aplica en `getMCPTools()` antes de crear las tools del AI SDK
- Los tools deshabilitados nunca se incluyen en el contexto del modelo

### UX
- Por defecto, todas las tools están habilitadas (opt-out, no opt-in)
- El toggle de servidor permite habilitar/deshabilitar rápidamente todas
- El contador `X/Y tools` da visibilidad rápida del estado
- El warning ayuda a mantener el número de tools manejable

### Compatibilidad
- El sistema es backward-compatible: si no hay `disabledTools`, todas están habilitadas
- El cache se actualiza automáticamente al conectar o recibir `list_changed`
- Nuevas tools de servidores actualizados quedan habilitadas automáticamente (mejor UX)
- Sigue el patrón de Claude Desktop (`disallowedTools`) y mcp-use (`disallowed_tools`)
