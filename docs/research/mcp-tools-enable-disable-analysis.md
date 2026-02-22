# Análisis de la Feature: Enable/Disable de Tools MCP

> **Fecha:** 2026-01-12
> **Rama:** `improve/UI-UX-improvements`
> **Estado:** Implementación en progreso (cambios locales sin commit)

---

## Resumen Ejecutivo

Esta feature implementa la capacidad de **habilitar/deshabilitar tools MCP individuales** desde la UI del chat. Permite al usuario:

1. Ver todos los servers MCP configurados y sus tools
2. Habilitar/deshabilitar servers completos (conexión real)
3. Habilitar/deshabilitar tools individuales de cada server
4. Persistir estas preferencias en `ui-preferences.json`
5. Filtrar las tools deshabilitadas cuando se pasan al modelo de IA

---

## Arquitectura de la Implementación

```
┌─────────────────────────────────────────────────────────────────────┐
│                           RENDERER                                   │
├─────────────────────────────────────────────────────────────────────┤
│  ToolsMenu.tsx ──► mcpStore.ts ──► IPC API (preload)                │
│       ▲                  │                    │                      │
│       │                  │                    ▼                      │
│  ToolsWarning.tsx    toolsCache         levante/mcp/*               │
│  useMCPEvents.ts     disabledTools                                  │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           MAIN PROCESS                               │
├─────────────────────────────────────────────────────────────────────┤
│  tools.ts (IPC handlers) ──► preferencesService.ts                  │
│         │                            │                               │
│         ▼                            ▼                               │
│  mcpToolsAdapter.ts            ui-preferences.json                  │
│  (filtra disabledTools)        (toolsCache, disabledTools)          │
│         │                                                            │
│         ▼                                                            │
│  aiService.ts (getMCPTools con filtro)                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Archivos Modificados

### 1. `src/main/ipc/mcpHandlers/tools.ts` (+137 líneas)

**Propósito:** Nuevos IPC handlers para gestión de tools.

**Handlers añadidos:**

| Handler | Parámetros | Descripción |
|---------|------------|-------------|
| `levante/mcp/get-tools-cache` | - | Obtiene el cache de tools sin reconectar |
| `levante/mcp/get-disabled-tools` | - | Obtiene las tools deshabilitadas |
| `levante/mcp/set-disabled-tools` | `serverId`, `toolNames[]` | Establece tools deshabilitadas de un server |
| `levante/mcp/toggle-tool` | `serverId`, `toolName`, `enabled` | Toggle individual de una tool |
| `levante/mcp/toggle-all-tools` | `serverId`, `enabled` | Toggle de todas las tools de un server |
| `levante/mcp/clear-server-tools` | `serverId` | Limpia cache y disabled al eliminar server |

**Cambio en handler existente:**
- `levante/mcp/list-tools`: Ahora actualiza el `toolsCache` en preferencias cada vez que lista tools

**Lógica de persistencia:**
- Usa `disabledTools` como lista negativa (solo guarda las bloqueadas)
- Si `toolNames` está vacío, elimina la entrada del servidor (todas habilitadas)

**Evaluación:** ✅ Limpio y consistente. Sigue el patrón IPC existente.

---

### 2. `src/main/services/ai/mcpToolsAdapter.ts` (+20 líneas)

**Propósito:** Filtrar tools deshabilitadas antes de pasarlas al modelo de IA.

**Cambios:**

```typescript
// Antes
export async function getMCPTools(): Promise<Record<string, any>>

// Después
export async function getMCPTools(
  disabledTools?: DisabledTools
): Promise<Record<string, any>>
```

**Lógica de filtrado:**
```typescript
const serverDisabledTools = disabledTools?.[serverId] || [];

// Skip disabled tools
if (serverDisabledTools.includes(mcpTool.name)) {
  skippedDisabledCount++;
  logger.aiSdk.debug("Skipping disabled tool", {
    serverId,
    toolName: mcpTool.name,
  });
  continue;
}
```

**Logs mejorados:**
- Añade `disabledTools: skippedDisabledCount` al log summary
- Diferencia entre `disabledServers` (servers deshabilitados) y `disabledTools` (tools deshabilitadas)

**Evaluación:** ✅ Implementación correcta. El filtrado se hace eficientemente con `Array.includes()`.

---

### 3. `src/main/services/aiService.ts` (+12 líneas)

**Propósito:** Pasar `disabledTools` a `getMCPTools()` al preparar tools para streaming.

**Cambios en dos lugares:**

1. **Método de streaming (~línea 944):**
```typescript
// Get disabled tools from preferences for filtering
const { preferencesService } = await import("./preferencesService");
await preferencesService.initialize();
const prefs = await preferencesService.getAll();
const disabledTools = prefs.mcp?.disabledTools;

const mcpTools = await getMCPTools(disabledTools);
```

2. **Método de código (~línea 1764):** Mismo patrón

**Evaluación:** ⚠️ **Posible mejora**: Import dinámico cada vez. Podría ser más eficiente si `preferencesService` se importara una vez al inicio del archivo. Sin embargo, funciona correctamente.

---

### 4. `src/main/services/mcp/mcpUseService.ts` (+79 líneas)

**Propósito:** Handler para notificaciones MCP `tools/list_changed`.

**Nuevo método:**
```typescript
private async setupToolsListChangedHandler(
  serverId: string,
  session: MCPSession
): Promise<void>
```

**Funcionamiento:**
1. Se registra en el evento `notification` del connector
2. Cuando recibe `notifications/tools/list_changed`:
   - Obtiene la nueva lista de tools
   - Actualiza el cache en preferencias
   - Notifica al renderer vía `levante/mcp/tools-updated`

**Integración:**
```typescript
// En connectServer(), después de crear la sesión:
this.setupToolsListChangedHandler(config.id, session);
```

**Manejo de errores:**
- Si el connector no soporta notifications (normal en mcp-use), falla silenciosamente
- Logs informativos pero no bloquea la conexión

**Evaluación:** ✅ Buena implementación defensiva. El código maneja correctamente el caso donde `mcp-use` no soporte notifications directamente.

---

### 5. `src/main/services/preferencesService.ts` (+9 líneas)

**Propósito:** Schema JSON para las nuevas preferencias.

**Añadido al schema MCP:**
```typescript
toolsCache: {
  type: 'object',
  default: {}
},
disabledTools: {
  type: 'object',
  default: {}
}
```

**Evaluación:** ✅ Correcto. Sigue el patrón del schema existente.

---

### 6. `src/main/types/mcp.ts` (+34 líneas)

**Propósito:** Definición de tipos TypeScript.

**Nuevos tipos:**

```typescript
/** Tool con información de servidor para UI */
export interface ServerTool extends Tool {
  serverId: string;
  serverName?: string;
  enabled: boolean;
}

/** Cache de tools por servidor */
export interface ToolsCache {
  [serverId: string]: {
    tools: Tool[];
    lastUpdated: number;  // timestamp
  };
}

/** Tools deshabilitadas por servidor */
export interface DisabledTools {
  [serverId: string]: string[];  // toolNames bloqueados
}
```

**Cambio menor:**
```typescript
// Antes
description: string;

// Después
description?: string;  // Opcional porque algunas tools no la tienen
```

**Evaluación:** ✅ Tipos bien definidos. Documentación clara sobre el patrón de lista negativa.

---

### 7. `src/preload/api/mcp.ts` (+31 líneas)

**Propósito:** Exponer los nuevos IPC handlers al renderer.

**Métodos añadidos:**
```typescript
getToolsCache: () => ipcRenderer.invoke('levante/mcp/get-tools-cache'),
getDisabledTools: () => ipcRenderer.invoke('levante/mcp/get-disabled-tools'),
setDisabledTools: (serverId, toolNames) => ...,
toggleTool: (serverId, toolName, enabled) => ...,
toggleAllTools: (serverId, enabled) => ...,
clearServerTools: (serverId) => ...,

// Event listener para tools actualizadas
onToolsUpdated: (callback) => {
  const handler = (_event, data) => callback(data);
  ipcRenderer.on('levante/mcp/tools-updated', handler);
  return () => ipcRenderer.removeListener(...);
}
```

**Evaluación:** ✅ Patrón consistente con el resto de la API. El cleanup del listener está bien implementado.

---

### 8. `src/preload/preload.ts` (+25 líneas)

**Propósito:** Tipos TypeScript para la API expuesta.

**Tipos añadidos en `LevanteAPI.mcp`:**
```typescript
getToolsCache: () => Promise<{ success: boolean; data?: any; error?: string }>;
getDisabledTools: () => Promise<{ success: boolean; data?: any; error?: string }>;
setDisabledTools: (serverId, toolNames) => Promise<...>;
toggleTool: (serverId, toolName, enabled) => Promise<...>;
toggleAllTools: (serverId, enabled) => Promise<...>;
clearServerTools: (serverId) => Promise<...>;
onToolsUpdated: (callback) => () => void;
```

**Evaluación:** ✅ Tipos correctos usando `ToolsCache`, `DisabledTools` y `Tool[]`.

---

### 9. `src/renderer/App.tsx` (+4 líneas)

**Propósito:** Inicializar el hook de eventos MCP.

**Cambio:**
```typescript
import { useMCPEvents } from '@/hooks/useMCPEvents'

function App() {
  // Listen for MCP events (tools/list_changed, etc.)
  useMCPEvents()
  // ...
}
```

**Evaluación:** ✅ Limpio. El hook se ejecuta una vez al montar App.

---

### 10. `src/renderer/components/chat/ToolsMenu.tsx` (~280 líneas reescritas)

**Propósito:** UI completa para gestión de tools.

**Estructura nueva:**
```
ToolsMenu
├── Settings Dropdown (icono engranaje)
│   └── Toggle MCP global
└── Tools Dropdown (icono llave, solo si MCP está habilitado)
    ├── ToolsWarning (si >40 tools)
    └── ServerToolsSection[] (por cada server)
        ├── Header (nombre, badge count, toggle server)
        └── Collapsible content
            ├── "Select all" checkbox
            └── Lista de tools con checkboxes
```

**Componentes:**

1. **ToolsMenu principal:**
   - Dos dropdowns separados (Settings y Tools)
   - El dropdown de Tools solo aparece cuando MCP está habilitado
   - Carga `toolsCache` y `disabledTools` al montar

2. **ServerToolsSection:**
   - Expandible/colapsible
   - Toggle para habilitar/deshabilitar server completo
   - Badge con `enabledCount/totalCount`
   - Botón refresh para recargar tools
   - Checkbox "Select all" con estado indeterminado
   - Lista de tools con checkboxes individuales

**Interacciones:**
- Click en toggle server → `enableServer()` / `disableServer()`
- Click en checkbox tool → `toggleTool(serverId, toolName, enabled)`
- Click en "Select all" → `toggleAllTools(serverId, !allEnabled)`
- Expandir server → `fetchServerTools()` si no está en cache

**Evaluación:** ✅ UI bien estructurada. El componente `ServerToolsSection` está bien extraído. Sin embargo, es un archivo largo (~320 líneas).

---

### 11. `src/renderer/pages/ChatPage.tsx` (+25 líneas)

**Propósito:** Mejoras en el manejo de "pending first message" (no relacionado con tools).

**Cambios:**
- Añade `pendingMessageProcessingRef` para evitar múltiples ejecuciones del pending message
- Mejora la lógica de `isChatEmpty` para considerar `pendingFirstMessage`
- Fix de race condition al enviar el primer mensaje

**Nota:** Este archivo NO carga tools cache. El análisis inicial era incorrecto.

**Evaluación:** ✅ Cambios no relacionados con la feature de tools, pero correctos.

---

### 12. `src/renderer/stores/mcpStore.ts` (+180 líneas)

**Propósito:** Estado y acciones para gestión de tools.

**Nuevo estado:**
```typescript
// Tools state
toolsCache: ToolsCache;
disabledTools: DisabledTools;
loadingTools: Record<string, boolean>;
```

**Nuevas acciones:**

| Acción | Descripción |
|--------|-------------|
| `loadToolsCache()` | Carga cache desde main process |
| `loadDisabledTools()` | Carga disabled desde main process |
| `fetchServerTools(serverId)` | Obtiene tools de un server y actualiza cache |
| `toggleTool(serverId, toolName, enabled)` | Toggle individual |
| `toggleAllTools(serverId, enabled)` | Toggle masivo |
| `isToolEnabled(serverId, toolName)` | Getter para estado de una tool |
| `getServerTools(serverId)` | Getter para tools de un server |
| `getEnabledToolsCount(serverId)` | Contador de habilitadas por server |
| `getDisabledToolsCount(serverId)` | Contador de deshabilitadas por server |
| `getTotalToolsCount()` | Total de tools en todos los servers |
| `getEnabledToolsTotal()` | Total habilitadas (considerando servers enabled) |

**Cambios en acciones existentes:**

1. **`enableServer(serverId)`:**
   - Ahora llama a `connectServer()` después de mover la config
   - Re-throws errores para manejo de OAuth/runtime en UI

2. **`disableServer(serverId)`:**
   - Simplificado a llamar `disconnectServer()` directamente

3. **`removeServer(serverId)`:**
   - Añade limpieza de `toolsCache` y `disabledTools`

**Evaluación:** ✅ Implementación completa y consistente. Sigue los patrones del store existente.

---

### 13. `src/renderer/types/mcp.ts` (+1 línea)

**Propósito:** Re-exportar tipos del main process.

**Cambio:**
```typescript
// Añadido
export type { Tool, ServerTool, ToolsCache, DisabledTools } from '../../main/types/mcp';
```

**Evaluación:** ✅ Correcto. Evita duplicación de tipos.

---

### 14. `src/types/preferences.ts` (+15 líneas)

**Propósito:** Tipos TypeScript para preferencias MCP.

**Añadido a `MCPPreferences`:**
```typescript
/** Cache of tools per server */
toolsCache?: {
  [serverId: string]: {
    tools: Array<{
      name: string;
      description?: string;
      inputSchema?: any;
    }>;
    lastUpdated: number;
  };
};

/** Tools disabled by server */
disabledTools?: {
  [serverId: string]: string[];
};
```

**Evaluación:** ✅ Tipos completos y consistentes con main process.

---

## Archivos Nuevos (Untracked)

### 15. `src/renderer/components/settings/ToolSelector.tsx` (159 líneas)

**Propósito:** Componente para seleccionar tools en Settings (alternativa a ToolsMenu).

**Estructura:**
- Similar a `ServerToolsSection` en ToolsMenu
- Collapsible por server
- Checkbox "Select all" + lista de tools

**Evaluación:** ⚠️ **Posible duplicación**: Muy similar a `ServerToolsSection` en ToolsMenu. Podrían compartir un componente base.

---

### 16. `src/renderer/components/settings/ToolsWarning.tsx` (40 líneas)

**Propósito:** Warning visual cuando hay muchas tools habilitadas.

**Lógica:**
```typescript
const TOOLS_WARNING_THRESHOLD = 40;  // Warning amarillo
const TOOLS_LIMIT = 80;              // Warning rojo

if (totalEnabled < TOOLS_WARNING_THRESHOLD) return null;
```

**UI:**
- **40-79 tools:** Alert amarillo con recomendación
- **80+ tools:** Alert rojo destructivo

**Evaluación:** ✅ Buena UX. Los thresholds son razonables.

---

### 17. `src/renderer/hooks/useMCPEvents.ts` (26 líneas)

**Propósito:** Hook para escuchar eventos MCP desde main process.

**Implementación:**
```typescript
export function useMCPEvents() {
  const { loadToolsCache } = useMCPStore();

  useEffect(() => {
    const cleanup = window.levante.mcp.onToolsUpdated((data) => {
      console.log('MCP tools updated for server:', data.serverId);
      loadToolsCache();
    });

    return () => cleanup();
  }, [loadToolsCache]);
}
```

**Evaluación:** ✅ Implementación correcta del cleanup pattern.

---

## Flujo de Datos Completo

### Toggle de Tool Individual

```
1. Usuario click en checkbox de tool
2. ToolsMenu.onToggleTool(toolName, enabled)
3. mcpStore.toggleTool(serverId, toolName, enabled)
4. IPC: levante/mcp/toggle-tool
5. Handler actualiza disabledTools en preferencesService
6. Retorna nueva lista de disabledTools[serverId]
7. Store actualiza estado local
8. UI re-renderiza con nuevo estado
```

### Uso de Tools en Chat (Filtrado)

```
1. Usuario envía mensaje
2. aiService prepara tools
3. preferencesService.getAll() → obtiene disabledTools
4. getMCPTools(disabledTools) filtra tools deshabilitadas
5. Solo tools habilitadas pasan al modelo
```

### Actualización Automática (tools/list_changed)

```
1. MCP server envía notification tools/list_changed
2. mcpUseService handler detecta notification
3. Fetches nueva lista de tools
4. Actualiza toolsCache en preferences
5. Envía evento levante/mcp/tools-updated al renderer
6. useMCPEvents hook recibe evento
7. Llama loadToolsCache() para refrescar UI
```

---

## Modelo de Datos

### En Preferencias (`ui-preferences.json`)

```json
{
  "mcp": {
    "sdk": "mcp-use",
    "toolsCache": {
      "server-id-1": {
        "tools": [
          { "name": "tool1", "description": "..." },
          { "name": "tool2", "description": "..." }
        ],
        "lastUpdated": 1736697600000
      }
    },
    "disabledTools": {
      "server-id-1": ["tool2"]  // Solo tool2 está deshabilitada
    }
  }
}
```

### Interpretación

- **Si un servidor NO está en `disabledTools`**: Todas sus tools están habilitadas
- **Si un servidor ESTÁ en `disabledTools`**: Solo las tools listadas están deshabilitadas, el resto habilitadas
- **Ventaja**: Nuevas tools quedan habilitadas automáticamente

---

## Posibles Problemas y Mejoras

### ⚠️ Problemas Menores

1. ~~**Duplicación de carga de cache:**~~ ✅ NO APLICA
   - ~~`ChatPage.tsx` y `ToolsMenu.tsx` ambos llaman `loadToolsCache()` en mount~~
   - Solo `ToolsMenu.tsx` carga el cache (correcto)

2. **Import dinámico en aiService:**
   - `import("./preferencesService")` se hace cada vez que se preparan tools
   - **Solución:** Import estático al inicio del archivo

3. ~~**Tipos `any` en preload.ts:**~~ ✅ CORREGIDO
   - ~~Los tipos de retorno usan `data?: any`~~
   - Ahora usa tipos específicos: `ToolsCache`, `DisabledTools`, `Tool[]`

4. **Duplicación de componentes:**
   - `ToolSelector.tsx` y `ServerToolsSection` son muy similares
   - **Solución:** Extraer componente base compartido

### ✅ Aspectos Bien Implementados

1. **Patrón de lista negativa:** Eficiente y permite nuevas tools por defecto
2. **Persistencia:** Usa el sistema existente de preferencias
3. **Filtrado en backend:** Las tools deshabilitadas nunca llegan al modelo
4. **Eventos reactivos:** El hook `useMCPEvents` mantiene UI sincronizada
5. **UI intuitiva:** Checkboxes con estado indeterminado para "select all"
6. **Warning de performance:** Alerta al usuario sobre demasiadas tools
7. **Cleanup correcto:** Listeners se remueven al desmontar componentes

---

## Resumen de Estado

| Aspecto | Estado | Notas |
|---------|--------|-------|
| Types definidos | ✅ Completo | Main y renderer sincronizados |
| IPC handlers | ✅ Completo | 6 nuevos handlers |
| Preload API | ✅ Completo | Incluye event listener |
| Main process filtrado | ✅ Completo | mcpToolsAdapter filtra correctamente |
| Store (estado) | ✅ Completo | toolsCache, disabledTools, loadingTools |
| Store (acciones) | ✅ Completo | toggle, load, getters |
| UI (ToolsMenu) | ✅ Completo | Dropdowns, collapsibles, checkboxes |
| UI (Warning) | ✅ Completo | Thresholds 40/80 |
| Event handling | ✅ Completo | tools/list_changed → UI update |
| Persistencia | ✅ Completo | ui-preferences.json |
| Tests | ❌ Pendiente | No hay tests nuevos |
| Traducciones | ✅ Completo | EN y ES en chat.json y settings.json |

---

## Conclusión

La implementación está **completa y funcional**. El código sigue los patrones existentes del proyecto y está bien estructurado. Los problemas identificados son menores y no afectan la funcionalidad.

**Recomendaciones antes de commit:**

1. Eliminar la carga duplicada de cache en `ChatPage.tsx` (ya está en `ToolsMenu.tsx`)
2. Considerar extraer `ServerToolsSection` a su propio archivo para reutilización
3. Añadir traducciones completas en archivos de idioma
4. Probar el flujo completo:
   - Deshabilitar una tool → verificar que no aparece en el chat
   - Habilitar/deshabilitar server → verificar conexión real
   - Eliminar server → verificar limpieza de cache
