# Sistema de Aprobación y Denegación de Tools en Levante

## Resumen Ejecutivo

El sistema de aprobación de tools permite a los usuarios controlar la ejecución de herramientas MCP antes de que se ejecuten. Soporta aprobación individual, denegación y auto-aprobación por sesión.

---

## 1. Arquitectura General

El sistema está distribuido en 3 capas principales:

```
┌────────────────────────────────────────────────────────────┐
│                    FRONTEND (React)                         │
│  • ChatPage.tsx - Orquestación principal                   │
│  • useToolAutoApproval - Hook para auto-aprobación         │
│  • ToolApprovalInline - Componente UI                      │
│  • ChatMessageItem - Renderiza UI de aprobación            │
│  • ElectronChatTransport - Adaptador IPC/AI SDK           │
└────────────────────────────────────────────────────────────┘
                           ↑↓ IPC (levante/*)
┌────────────────────────────────────────────────────────────┐
│                   BACKEND (Node.js)                         │
│  • aiService.ts - Procesa chunks del AI SDK               │
│  • mcpToolsAdapter.ts - Configura herramientas MCP        │
└────────────────────────────────────────────────────────────┘
                           ↑↓ HTTP/HTTPS
┌────────────────────────────────────────────────────────────┐
│              AI SDK (Vercel) + Proveedores                 │
│  • Streamtext/generateText con needsApproval: true        │
│  • OpenRouter, Anthropic, Google, etc.                    │
└────────────────────────────────────────────────────────────┘
```

---

## 2. Flujo de Aprobación (Paso a Paso)

### Paso 1: Configuración de Herramientas

**Archivo:** `src/main/services/ai/mcpToolsAdapter.ts` (líneas 226-233)

```typescript
const aiTool = tool({
  description: mcpTool.description || `Tool from MCP server ${serverId}`,
  inputSchema: inputSchema,

  // CLAVE: Todas las herramientas MCP requieren aprobación
  needsApproval: true,  // ← Activa el mecanismo de aprobación

  execute: async (args: any) => {
    // Ejecuta solo después de aprobación
  }
});
```

### Paso 2: Generación de Chunks por AI SDK

Cuando el modelo decide usar una herramienta con `needsApproval: true`, el AI SDK genera:

```
Chunk 1: { type: "tool-call", toolCallId: "abc123", toolName: "supabase_list", input: {} }
Chunk 2: { type: "tool-approval-request", approvalId: "xyz789", toolCall: { toolCallId, toolName, input } }
```

### Paso 3: Procesamiento en aiService.ts

**Archivo:** `src/main/services/aiService.ts` (líneas 1298-1342 para approval, 1344-1389 para tool-call)

```typescript
case "tool-approval-request":
  const approvalChunk = chunk as {
    type: string;
    approvalId: string;
    toolCall?: {
      toolCallId: string;
      toolName: string;
      input?: Record<string, unknown>;
    };
  };

  // Garantizar que input NUNCA sea undefined
  const toolInput = approvalChunk.toolCall?.input ?? {};

  yield {
    toolApproval: {
      approvalId: approvalChunk.approvalId,
      toolCallId: approvalChunk.toolCall?.toolCallId ?? '',
      toolName: approvalChunk.toolCall?.toolName ?? '',
      input: toolInput,
    },
  };
  break;

case "tool-call":
  const toolCallArguments = (chunk as any).input || (chunk as any).arguments || {};

  yield {
    toolCall: {
      id: chunk.toolCallId,
      name: chunk.toolName,
      arguments: toolCallArguments,
    }
  };
  break;
```

### Paso 4: Conversión en ElectronChatTransport

**Archivo:** `src/renderer/transports/ElectronChatTransport.ts` (líneas 284-307)

```typescript
if (chunk.toolApproval) {
  const safeInput = chunk.toolApproval.input ?? {};

  // CRÍTICO: NO emitir tool-input-start aquí
  // El part ya fue creado por el chunk toolCall anterior
  // Si emitimos tool-input-start de nuevo, resetea el part a 'input-streaming'

  yield {
    type: "tool-approval-request",
    toolCallId: chunk.toolApproval.toolCallId,
    toolName: chunk.toolApproval.toolName,
    approvalId: chunk.toolApproval.approvalId,
    input: safeInput,
    toolCall: {
      toolCallId: chunk.toolApproval.toolCallId,
      toolName: chunk.toolApproval.toolName,
      input: safeInput,  // Input dentro de toolCall para el AI SDK
    },
  } as any;
}
```

### Paso 5: Actualización de Estado en useChat

El hook `useChat` del AI SDK procesa el chunk y actualiza:

```typescript
message.parts = [
  { type: "text", text: "Voy a listar tus proyectos..." },
  {
    type: "tool-supabase_list_projects",
    toolCallId: "abc123",
    state: "approval-requested",  // ← Estado especial
    input: {},
    approval: { id: "xyz789" }
  }
];
```

### Paso 6: Renderización de UI

**Archivo:** `src/renderer/components/chat/ChatMessageItem.tsx` (líneas 282-318)

```typescript
if (part.state === 'approval-requested' && addToolApprovalResponse) {
  const toolName = part.toolName || part.type.replace(/^tool-/, '');

  // Extraer serverId para verificar auto-aprobación
  const serverId = toolName.includes('_') ? toolName.split('_')[0] : 'unknown';

  // Si el servidor está auto-aprobado, aprobar automáticamente
  if (isServerAutoApproved?.(serverId)) {
    queueMicrotask(() => {
      addToolApprovalResponse({
        id: part.approval?.id || part.toolCallId,
        approved: true,
      });
    });

    // Mostrar indicador de auto-aprobación
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Check className="w-4 h-4 text-green-500" />
        <span>Auto-approved: {toolName.split('_').slice(1).join('_')}</span>
      </div>
    );
  }

  // Mostrar UI de aprobación normal
  return (
    <ToolApprovalInline
      toolName={toolName}
      input={part.input || {}}
      approvalId={part.approval?.id || part.toolCallId}
      onApprove={() => {
        addToolApprovalResponse({
          id: part.approval?.id || part.toolCallId,
          approved: true,
        });
      }}
      onDeny={() => {
        addToolApprovalResponse({
          id: part.approval?.id || part.toolCallId,
          approved: false,
        });
      }}
      onApproveForSession={onApproveServerForSession}
    />
  );
}
```

### Paso 7: Respuesta del Usuario

**Archivo:** `src/renderer/components/ai-elements/tool-approval.tsx` (líneas 44-153)

El componente `ToolApprovalInline` proporciona 3 botones:
- **Deny**: Rechaza la herramienta
- **Approve**: Aprueba una sola ejecución
- **Approve for Session**: Aprueba todas las herramientas del servidor para la sesión actual

```typescript
const handleApproveForSession = () => {
  onApprove();  // Primero aprobar esta herramienta
  onApproveForSession?.(serverId);  // Luego registrar servidor
};
```

### Paso 8: Auto-Aprobación (Solo si usuario aprobó para sesión)

**Archivo:** `src/renderer/hooks/useToolAutoApproval.ts`

```typescript
interface UseToolAutoApprovalReturn {
  autoApprovedServers: Set<string>;
  approveServerForSession: (serverId: string) => void;
  isServerAutoApproved: (serverId: string) => boolean;
  clearAutoApprovals: () => void;
}

export function useToolAutoApproval(): UseToolAutoApprovalReturn {
  const [autoApprovedServers, setAutoApprovedServers] = useState<Set<string>>(new Set());

  const approveServerForSession = useCallback((serverId: string) => {
    setAutoApprovedServers(prev => {
      const newSet = new Set(prev);
      newSet.add(serverId);
      return newSet;
    });
  }, []);

  const isServerAutoApproved = useCallback((serverId: string) => {
    return autoApprovedServers.has(serverId);
  }, [autoApprovedServers]);

  const clearAutoApprovals = useCallback(() => {
    setAutoApprovedServers(new Set());
  }, []);

  return {
    autoApprovedServers,
    approveServerForSession,
    isServerAutoApproved,
    clearAutoApprovals,
  };
}
```

### Paso 9: Control de Ejecución Automática en sendAutomaticallyWhen

**Archivo:** `src/renderer/pages/ChatPage.tsx` (líneas 215-251)

```typescript
sendAutomaticallyWhen: ({ messages }) => {
  const lastAssistantMessage = messages
    .slice()
    .reverse()
    .find((m) => m.role === 'assistant');

  if (!lastAssistantMessage) return false;

  const toolParts = lastAssistantMessage.parts?.filter(
    (p: any) => p.type?.startsWith('tool-')
  ) || [];

  const partsWithApprovalResponse = toolParts.filter(
    (p: any) => p.state === 'approval-responded' && p.approval
  );

  if (partsWithApprovalResponse.length === 0) return false;

  // Solo continuar si TODAS las respuestas son aprobaciones (ninguna denegación)
  const allApproved = partsWithApprovalResponse.every(
    (p: any) => p.approval.approved === true
  );

  return allApproved;  // false para denials → NO dispara nueva llamada
}
```

---

## 3. Almacenamiento y Configuración

### Estado de Auto-Aprobación (En Memoria)

**Archivo:** `src/renderer/hooks/useToolAutoApproval.ts`

- **Tipo:** `Set<string>` en estado React local
- **Alcance:** Sesión actual únicamente
- **Persistencia:** No persiste (se limpia al cambiar de sesión)
- **Limpieza:** `clearAutoApprovals()` se llama en ChatPage cuando:
  - El usuario cambia de sesión
  - Se crea una nueva sesión

**Archivo:** `src/renderer/pages/ChatPage.tsx` (línea 528)

```typescript
useEffect(() => {
  // ... sesión cambió ...
  clearAttachments();
  clearResources();
  clearAutoApprovals();  // ← Se limpia aquí
  // ...
}, [currentSession?.id, ...]);
```

### Configuración de Herramientas

**Ubicación:** `src/main/services/ai/mcpToolsAdapter.ts`

Todas las herramientas MCP tienen configuradas:

```typescript
needsApproval: true,  // Requiere aprobación antes de ejecutarse
```

---

## 4. IPC (Inter-Process Communication)

### Handlers de Aprobación

No hay handlers específicos de IPC para aprobaciones de tools en `/src/main/ipc/`. La comunicación se realiza a través del hook `addToolApprovalResponse` del AI SDK, que es interno al flujo de `useChat` y no requiere handlers IPC explícitos.

### Tipos Enviados por IPC

**Archivo:** `src/preload/types/index.ts` (líneas 32-38)

```typescript
export interface ChatStreamChunk {
  // ... otros campos ...
  // Información de aprobación de herramienta (para needsApproval: true)
  toolApproval?: {
    approvalId: string;        // ID único de aprobación
    toolCallId: string;        // ID del call de la herramienta
    toolName: string;          // Nombre de la herramienta
    input: Record<string, any>; // Argumentos
  };
  // ... otros campos ...
}
```

---

## 5. Componentes de React

### 5.1 ToolApprovalInline

**Archivo:** `src/renderer/components/ai-elements/tool-approval.tsx`

```typescript
interface ToolApprovalInlineProps {
  toolName: string;                                    // serverId_toolName
  input: Record<string, unknown>;                      // Argumentos
  approvalId: string;                                  // ID del AI SDK
  onApprove: () => void;                              // Usuario aprueba
  onDeny: () => void;                                 // Usuario rechaza
  onApproveForSession?: (serverId: string) => void;  // Auto-aprobación para sesión
  className?: string;
}
```

**Funcionalidades:**
- Muestra nombre de herramienta con badge de serverId
- Botón para expandir/contraer parámetros JSON
- Tres botones de acción: Deny, Approve, Approve for Session
- Interfaz limpia con Lucide icons

### 5.2 ChatMessageItem

**Archivo:** `src/renderer/components/chat/ChatMessageItem.tsx`

Recibe props:

```typescript
addToolApprovalResponse?: (response: { id: string; approved: boolean }) => void;
onApproveServerForSession?: (serverId: string) => void;
isServerAutoApproved?: (serverId: string) => boolean;
```

**Lógica de renderización:**

```typescript
if (part.state === 'approval-requested' && addToolApprovalResponse) {
  // 1. Verificar si servidor está auto-aprobado
  const serverId = toolName.split('_')[0];
  if (isServerAutoApproved?.(serverId)) {
    // Auto-aprobar con queueMicrotask
  } else {
    // Mostrar ToolApprovalInline con callbacks
  }
}
```

### 5.3 ChatPage

**Archivo:** `src/renderer/pages/ChatPage.tsx`

**Integración del hook:**

```typescript
const {
  approveServerForSession,    // Función para registrar servidor
  isServerAutoApproved,       // Función para verificar
  clearAutoApprovals,         // Limpiador
} = useToolAutoApproval();

// Pasar a ChatMessageItem
<ChatMessageItem
  onApproveServerForSession={approveServerForSession}
  isServerAutoApproved={isServerAutoApproved}
  addToolApprovalResponse={addToolApprovalResponse}
/>

// Limpiar cuando sesión cambia
useEffect(() => {
  clearAutoApprovals();
}, [currentSession?.id, ...]);
```

---

## 6. Stores Zustand

**No hay store específico de Zustand para aprobaciones de tools.**

El estado se gestiona a través de:
- Hook local `useToolAutoApproval()` en React
- Estado interno del hook `useChat` del AI SDK (para `addToolApprovalResponse`)

**Stores existentes** en `/src/renderer/stores/`:
- `modelStore.ts` - Gestión de modelos
- `chatStore.ts` - Gestión de chats
- `mcpStore.ts` - Gestión de MCP
- `oauthStore.ts` - Gestión de OAuth

---

## 7. Servicios del Main Process

### 7.1 aiService.ts

**Archivo:** `src/main/services/aiService.ts`

**Responsabilidades clave:**

1. **Procesamiento de tool-approval-request** (líneas 1298-1342)
   - Extrae `approvalId`, `toolCallId`, `toolName`, `input`
   - Garantiza que `input` nunca sea undefined
   - Envía al frontend vía IPC

2. **Procesamiento de tool-call** (líneas 1344-1389)
   - Extrae argumentos (busca `input` primero, luego `arguments`)
   - Envía al frontend para mostrar en UI

3. **Manejo de denials** (líneas 140-169)
   - En `sanitizeMessagesForModel()`
   - Si `part.state === 'approval-responded'` y `part.approval?.approved === false`
   - Convierte a `output-available` con mensaje de denial
   - Esto genera un `tool_result` válido para Anthropic

### 7.2 mcpToolsAdapter.ts

**Archivo:** `src/main/services/ai/mcpToolsAdapter.ts`

```typescript
const aiTool = tool({
  description: mcpTool.description,
  inputSchema: inputSchema,
  needsApproval: true,  // ← CLAVE: Activa aprobación

  execute: async (args: any) => {
    // Se ejecuta SOLO si el usuario aprueba
    const result = await mcpService.callTool(serverId, {
      name: mcpTool.name,
      arguments: args,
    });
    return result;
  }
});
```

---

## 8. Configuración

### 8.1 Variables de Entorno

No hay configuración específica para aprobaciones en `.env`.

### 8.2 Configuración de MCP

**Archivo:** `~/levante/ui-preferences.json`

Contiene configuración de servidores MCP, pero NO guarda decisiones de aprobación de tools (solo en memoria).

### 8.3 Logs Disponibles

**Categoría:** `ai-sdk`

Cuando se habilita con `DEBUG_AI_SDK=true`:
- `[FLOW-3]` RAW tool-approval-request chunk
- `[FLOW-4]` Yielding toolApproval to frontend
- `[FLOW-8]` Emitting tool-approval-request (Transport)
- `[FLOW-13]` Showing approval UI

---

## 9. Auto-Aprobación por Sesión

### 9.1 Mecanismo

1. Usuario hace click en "Approve for Session"
2. Se llama `onApproveServerForSession(serverId)`
3. Hook `useToolAutoApproval` añade `serverId` al Set
4. En siguiente herramienta del mismo servidor:
   - `ChatMessageItem` verifica con `isServerAutoApproved(serverId)`
   - Si está registrado, llama automáticamente `addToolApprovalResponse({ approved: true })`
   - Muestra indicador visual "Auto-approved"

### 9.2 Almacenamiento

- **Tipo:** `Set<string>` en memoria
- **Persistencia:** NO persiste entre sesiones
- **Limpieza:** Se llama `clearAutoApprovals()` cuando:
  - Usuario cambia a otra sesión
  - Usuario crea una nueva sesión

### 9.3 Parámetros Pasados Entre Componentes

```
ChatPage
  ↓
  useToolAutoApproval()
  ├─ approveServerForSession    → ChatMessageItem
  ├─ isServerAutoApproved       → ChatMessageItem
  └─ clearAutoApprovals         → Efecto de cambio de sesión

ChatMessageItem
  ├─ onApproveServerForSession  → ToolApprovalInline (prop)
  ├─ isServerAutoApproved       → Lógica de auto-aprobación
  └─ addToolApprovalResponse    → Del AI SDK useChat
```

---

## 10. Flujo Completo de Deny

1. **Usuario hace click en "Deny"**
   ```typescript
   addToolApprovalResponse({
     id: part.approval?.id || part.toolCallId,
     approved: false,
   });
   ```

2. **sendAutomaticallyWhen evalúa**
   ```typescript
   const allApproved = partsWithApprovalResponse.every(
     (p: any) => p.approval.approved === true
   );
   return allApproved;  // false si hay denial → NO se dispara nueva llamada
   ```

3. **Si usuario continúa manualmente**
   - `sanitizeMessagesForModel()` detecta `approval-responded` con `approved: false`
   - Convierte a `output-available` con mensaje "Tool execution was denied by the user."
   - `convertToModelMessages` genera `tool_result` válido
   - Anthropic recibe estructura correcta

---

## 11. Resumen de Archivos Clave

| Archivo | Líneas | Propósito | Tipo |
|---------|--------|-----------|------|
| `src/main/services/ai/mcpToolsAdapter.ts` | 226-233 | Configura herramientas con `needsApproval: true` | Servicio |
| `src/main/services/aiService.ts` | 1298-1342 | Procesa `tool-approval-request` | Servicio |
| `src/main/services/aiService.ts` | 1344-1389 | Procesa `tool-call` | Servicio |
| `src/main/services/aiService.ts` | 140-169 | Convierte denials a `output-available` | Servicio |
| `src/renderer/transports/ElectronChatTransport.ts` | 284-307 | Convierte chunks para AI SDK | Transport |
| `src/renderer/hooks/useToolAutoApproval.ts` | - | Hook para auto-aprobación por sesión | Hook |
| `src/renderer/pages/ChatPage.tsx` | 215-251 | `sendAutomaticallyWhen` personalizado | Página |
| `src/renderer/pages/ChatPage.tsx` | 70-75 | Inicializa hook de auto-aprobación | Página |
| `src/renderer/pages/ChatPage.tsx` | 528 | Limpia auto-approvals al cambiar sesión | Página |
| `src/renderer/pages/ChatPage.tsx` | 993-994 | Pasa callbacks a ChatMessageItem | Página |
| `src/renderer/components/chat/ChatMessageItem.tsx` | 304-334 | Lógica de auto-aprobación | Componente |
| `src/renderer/components/chat/ChatMessageItem.tsx` | 337-357 | Renderiza ToolApprovalInline | Componente |
| `src/renderer/components/ai-elements/tool-approval.tsx` | 44-153 | Componente con 3 botones de aprobación | Componente |
| `src/preload/types/index.ts` | 32-38 | Tipo `toolApproval` en `ChatStreamChunk` | Tipo |

---

## 12. Bugfixes Implementados (Referencia Histórica)

El documento `docs/developer/tool-approval-flow-explained.md` documenta 3 bugs que fueron encontrados y resueltos:

1. **Formato incorrecto del chunk** (RESUELTO)
   - Input debe estar tanto en nivel superior como en `toolCall.input`

2. **Duplicación de `tool-input-start`** (RESUELTO)
   - El Transport no debe emitir `tool-input-start` para `toolApproval` chunks
   - Causa reset de estado de `input-available` a `input-streaming`

3. **Loop infinito en denials** (RESUELTO)
   - `sendAutomaticallyWhen` debe retornar `false` si hay denials
   - `sanitizeMessagesForModel` convierte denials a `output-available`

---

## 13. Puntos Clave de Seguridad

1. **Aprobación requerida para MCP:** Todas las herramientas MCP tienen `needsApproval: true`
2. **Sin persistencia de decisiones:** Las aprobaciones por sesión no se guardan (no hay acceso a APIs externas sin consciente del usuario en cada sesión)
3. **Validación de estructura:** Anthropic requiere `tool_result` válido para cada `tool_use`
4. **Manejo de denials:** El sistema respeta cuando el usuario rechaza una herramienta

---

## 14. Diagrama de Flujo Visual

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FLUJO DE APROBACIÓN                            │
└─────────────────────────────────────────────────────────────────────────┘

Usuario envía mensaje
        │
        ▼
┌───────────────────┐
│   AI Provider     │ ──────► Decide usar herramienta MCP
└───────────────────┘
        │
        ▼
┌───────────────────┐
│    AI SDK         │ ──────► Genera tool-call + tool-approval-request
└───────────────────┘         (porque needsApproval: true)
        │
        ▼
┌───────────────────┐
│   aiService.ts    │ ──────► Procesa chunks y envía vía IPC
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ ElectronTransport │ ──────► Convierte a formato useChat
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ ChatMessageItem   │ ──────► ¿Servidor auto-aprobado?
└───────────────────┘
        │
   ┌────┴────┐
   │         │
   ▼         ▼
  SÍ        NO
   │         │
   ▼         ▼
┌──────┐  ┌──────────────────┐
│Auto  │  │ToolApprovalInline│
│Approve│  └──────────────────┘
└──────┘         │
   │        ┌────┼────┐
   │        │    │    │
   │        ▼    ▼    ▼
   │     Deny  Approve  Approve
   │               │    for Session
   │               │        │
   │               │        ▼
   │               │   ┌─────────────────┐
   │               │   │Registrar servidor│
   │               │   │en Set<string>   │
   │               │   └─────────────────┘
   │               │        │
   │               ▼        ▼
   │       ┌────────────────────────┐
   │       │addToolApprovalResponse │
   │       │({ approved: true/false})│
   │       └────────────────────────┘
   │                    │
   ▼                    ▼
┌──────────────────────────────────────┐
│        sendAutomaticallyWhen         │
│  ¿Todas las herramientas aprobadas?  │
└──────────────────────────────────────┘
        │
   ┌────┴────┐
   │         │
   ▼         ▼
  SÍ        NO (denial)
   │         │
   ▼         ▼
Ejecutar   Parar
herramienta (no ejecutar)
```

---

*Documento generado: 2026-02-17*
*Versión del sistema analizado: feat/approval-tool-execution2*
