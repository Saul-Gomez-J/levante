# Plan de Implementación: Flujo de Aprobación de Tools

**Fecha:** 2026-01-12
**Estado:** Planificado
**Prioridad:** Alta

---

## Resumen del Problema

### Situación Actual

Las tools MCP con `needsApproval: true` se ejecutan **inmediatamente** sin esperar la aprobación del usuario. El diálogo de aprobación aparece tarde (después de que la tool ya se ejecutó).

### Causa Raíz

Según la documentación del AI SDK Core:

> "When a tool requires approval, `generateText` and `streamText` **don't pause execution**. Instead, they complete and return `tool-approval-request` parts in the result content."

El código actual en `aiService.ts` recibe el chunk `tool-approval-request`, lo envía al frontend, pero **no pausa el stream ni llama a `addToolApprovalResponse()`**. El stream continúa y ejecuta la tool automáticamente.

### Flujo Actual (Incorrecto)

```
1. Usuario envía mensaje
2. streamText() inicia
3. Modelo decide usar tool
4. AI SDK emite "tool-approval-request"
5. aiService.ts: yield { toolApproval: {...} }  ← ENVÍA AL FRONTEND
6. Stream CONTINÚA sin pausar                    ← PROBLEMA
7. AI SDK ejecuta la tool (llama a execute())   ← MUY TARDE
8. Diálogo aparece en el frontend               ← INÚTIL
```

### Flujo Correcto (A Implementar)

```
1. Usuario envía mensaje
2. streamText() inicia
3. Modelo decide usar tool
4. AI SDK emite "tool-approval-request"
5. aiService.ts: yield { toolApproval: {...} }  ← ENVÍA AL FRONTEND
6. aiService.ts: PAUSA esperando respuesta IPC   ← NUEVO
7. Usuario ve diálogo y aprueba/deniega
8. Frontend envía respuesta via IPC              ← NUEVO
9. aiService.ts: result.addToolApprovalResponse()← NUEVO
10. Stream CONTINÚA
11. Si aprobado: AI SDK ejecuta la tool
12. Si denegado: AI SDK informa al modelo
```

---

## Archivos a Modificar

| Archivo | Cambios |
|---------|---------|
| `src/main/services/aiService.ts` | Pausar stream y esperar aprobación |
| `src/main/ipc/chatHandlers.ts` | Nuevo handler IPC para respuesta de aprobación |
| `src/preload/index.ts` | Exponer nuevo método IPC |
| `src/preload/types/index.ts` | Tipos para la respuesta de aprobación |
| `src/renderer/pages/ChatPage.tsx` | Enviar respuesta via IPC |

---

## Paso 1: Crear Sistema de Espera de Aprobación

### Archivo: `src/main/services/ai/toolApprovalManager.ts` (NUEVO)

**Razón:** Necesitamos un mecanismo para pausar el stream y esperar la respuesta del usuario. Usamos Promises que se resuelven cuando el usuario responde.

```typescript
/**
 * Tool Approval Manager
 *
 * Gestiona las solicitudes de aprobación pendientes.
 * Permite que el stream de AI SDK pause y espere la respuesta del usuario.
 */

import { getLogger } from "../logging";

const logger = getLogger();

interface PendingApproval {
  approvalId: string;
  toolName: string;
  input: Record<string, any>;
  resolve: (response: ApprovalResponse) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

export interface ApprovalResponse {
  approved: boolean;
  reason?: string;
}

// Mapa de aprobaciones pendientes: approvalId -> Promise resolver
const pendingApprovals = new Map<string, PendingApproval>();

// Timeout para aprobaciones (5 minutos)
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Crea una promesa que se resolverá cuando el usuario responda.
 * El stream de AI SDK llamará a esta función y esperará (await).
 *
 * @param approvalId - ID único de la solicitud de aprobación
 * @param toolName - Nombre de la tool que requiere aprobación
 * @param input - Argumentos de la tool
 * @returns Promise que se resuelve con la respuesta del usuario
 */
export function waitForApproval(
  approvalId: string,
  toolName: string,
  input: Record<string, any>
): Promise<ApprovalResponse> {
  return new Promise((resolve, reject) => {
    logger.aiSdk.info("Waiting for user approval", {
      approvalId,
      toolName,
      inputKeys: Object.keys(input),
    });

    const pending: PendingApproval = {
      approvalId,
      toolName,
      input,
      resolve,
      reject,
      timestamp: Date.now(),
    };

    pendingApprovals.set(approvalId, pending);

    // Timeout de seguridad
    setTimeout(() => {
      if (pendingApprovals.has(approvalId)) {
        logger.aiSdk.warn("Approval request timed out", { approvalId, toolName });
        pendingApprovals.delete(approvalId);
        reject(new Error(`Approval request timed out for tool: ${toolName}`));
      }
    }, APPROVAL_TIMEOUT_MS);
  });
}

/**
 * Resuelve una solicitud de aprobación pendiente.
 * El frontend llama a esta función cuando el usuario responde.
 *
 * @param approvalId - ID de la solicitud
 * @param approved - true si el usuario aprobó
 * @param reason - Razón opcional (principalmente para denegaciones)
 */
export function resolveApproval(
  approvalId: string,
  approved: boolean,
  reason?: string
): boolean {
  const pending = pendingApprovals.get(approvalId);

  if (!pending) {
    logger.aiSdk.warn("No pending approval found", { approvalId });
    return false;
  }

  logger.aiSdk.info("Resolving approval", {
    approvalId,
    toolName: pending.toolName,
    approved,
    reason,
    waitTimeMs: Date.now() - pending.timestamp,
  });

  pendingApprovals.delete(approvalId);
  pending.resolve({ approved, reason });

  return true;
}

/**
 * Cancela todas las aprobaciones pendientes.
 * Útil cuando el usuario cancela el stream o cambia de sesión.
 */
export function cancelAllPendingApprovals(): void {
  const count = pendingApprovals.size;

  if (count > 0) {
    logger.aiSdk.info("Cancelling all pending approvals", { count });

    for (const [approvalId, pending] of pendingApprovals) {
      pending.reject(new Error("Approval cancelled"));
    }

    pendingApprovals.clear();
  }
}

/**
 * Obtiene el número de aprobaciones pendientes.
 */
export function getPendingApprovalsCount(): number {
  return pendingApprovals.size;
}
```

---

## Paso 2: Modificar aiService.ts

### Archivo: `src/main/services/aiService.ts`

**Razón:** Cuando recibimos `tool-approval-request`, debemos:
1. Enviar la solicitud al frontend (yield)
2. PAUSAR esperando la respuesta del usuario
3. Llamar a `result.addToolApprovalResponse()` con la decisión
4. Continuar el stream

#### Cambio 1: Importar el manager

```typescript
// Añadir al inicio del archivo (después de las otras importaciones)
import {
  waitForApproval,
  cancelAllPendingApprovals
} from "./ai/toolApprovalManager";
```

#### Cambio 2: Modificar el case "tool-approval-request"

**Código actual (líneas ~1282-1302):**

```typescript
case "tool-approval-request":
  const approvalChunk = chunk as any;

  this.logger.aiSdk.info("Tool approval requested", {
    approvalId: approvalChunk.approvalId,
    toolCallId: approvalChunk.toolCall?.toolCallId,
    toolName: approvalChunk.toolCall?.toolName,
    input: approvalChunk.toolCall?.input,
  });

  yield {
    toolApproval: {
      id: approvalChunk.approvalId,
      toolCallId: approvalChunk.toolCall?.toolCallId || '',
      toolName: approvalChunk.toolCall?.toolName || '',
      input: approvalChunk.toolCall?.input || {},
    },
  } as any;
  break;
```

**Código nuevo:**

```typescript
case "tool-approval-request":
  const approvalChunk = chunk as any;
  const approvalId = approvalChunk.approvalId;
  const toolCallId = approvalChunk.toolCall?.toolCallId || '';
  const toolName = approvalChunk.toolCall?.toolName || '';
  const toolInput = approvalChunk.toolCall?.input || {};

  this.logger.aiSdk.info("Tool approval requested - PAUSING STREAM", {
    approvalId,
    toolCallId,
    toolName,
    input: toolInput,
  });

  // 1. Enviar solicitud al frontend para mostrar diálogo
  yield {
    toolApproval: {
      id: approvalId,
      toolCallId,
      toolName,
      input: toolInput,
    },
  } as any;

  // 2. PAUSAR el stream esperando la respuesta del usuario
  //    Esta Promise se resuelve cuando el frontend llama a resolveApproval()
  try {
    const userResponse = await waitForApproval(approvalId, toolName, toolInput);

    this.logger.aiSdk.info("User responded to approval request", {
      approvalId,
      toolName,
      approved: userResponse.approved,
      reason: userResponse.reason,
    });

    // 3. Enviar la respuesta al AI SDK para que continúe
    //    addToolApprovalResponse está disponible en el objeto result
    await (result as any).addToolApprovalResponse({
      approvalId,
      approved: userResponse.approved,
      reason: userResponse.reason,
    });

    // 4. Notificar al frontend que la aprobación fue procesada
    yield {
      toolApprovalProcessed: {
        approvalId,
        approved: userResponse.approved,
      },
    } as any;

  } catch (error) {
    // El usuario canceló o hubo timeout
    this.logger.aiSdk.warn("Approval was cancelled or timed out", {
      approvalId,
      toolName,
      error: error instanceof Error ? error.message : error,
    });

    // Informar al AI SDK que se denegó
    await (result as any).addToolApprovalResponse({
      approvalId,
      approved: false,
      reason: error instanceof Error ? error.message : "Approval cancelled",
    });
  }
  break;
```

#### Cambio 3: Cancelar aprobaciones pendientes al terminar

**Añadir al final de streamChat (después de `yield { done: true }`):**

```typescript
// Limpiar aprobaciones pendientes al terminar el stream
cancelAllPendingApprovals();
```

---

## Paso 3: Crear Handler IPC para Respuesta de Aprobación

### Archivo: `src/main/ipc/chatHandlers.ts`

**Razón:** El frontend necesita una forma de enviar la respuesta de aprobación al main process.

#### Añadir nuevo handler:

```typescript
import { resolveApproval } from "../services/ai/toolApprovalManager";

// Añadir después de los otros handlers de chat

/**
 * Handler para recibir la respuesta de aprobación del usuario.
 * Se llama cuando el usuario hace clic en "Aprobar" o "Denegar" en el diálogo.
 */
ipcMain.handle(
  "levante/chat/tool-approval-response",
  async (
    _event,
    { approvalId, approved, reason }: {
      approvalId: string;
      approved: boolean;
      reason?: string;
    }
  ) => {
    try {
      const resolved = resolveApproval(approvalId, approved, reason);

      return {
        success: resolved,
        error: resolved ? undefined : "No pending approval found with that ID",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
);
```

---

## Paso 4: Exponer en Preload

### Archivo: `src/preload/index.ts`

**Razón:** El renderer no puede llamar directamente a IPC. Necesitamos exponerlo via contextBridge.

#### Añadir al objeto `levante`:

```typescript
// Dentro de contextBridge.exposeInMainWorld("levante", { ... })

/**
 * Envía la respuesta de aprobación del usuario al main process.
 * @param approvalId - ID de la solicitud de aprobación
 * @param approved - true si el usuario aprobó, false si denegó
 * @param reason - Razón opcional (principalmente para denegaciones)
 */
sendToolApprovalResponse: (
  approvalId: string,
  approved: boolean,
  reason?: string
): Promise<{ success: boolean; error?: string }> => {
  return ipcRenderer.invoke("levante/chat/tool-approval-response", {
    approvalId,
    approved,
    reason,
  });
},
```

### Archivo: `src/preload/types/index.ts`

**Razón:** TypeScript necesita conocer el tipo del nuevo método.

#### Añadir al interface `LevanteAPI`:

```typescript
sendToolApprovalResponse: (
  approvalId: string,
  approved: boolean,
  reason?: string
) => Promise<{ success: boolean; error?: string }>;
```

---

## Paso 5: Modificar el Frontend para Usar el Nuevo IPC

### Archivo: `src/renderer/hooks/useToolApproval.ts`

**Razón:** Cuando el usuario aprueba o deniega, debemos llamar al nuevo método IPC en lugar de solo `addToolApprovalResponse`.

#### Modificar handleApprove y handleDeny:

```typescript
const handleApprove = useCallback(async () => {
  if (!pendingApproval) return;

  // 1. Enviar respuesta al main process (desbloquea el stream)
  const result = await window.levante.sendToolApprovalResponse(
    pendingApproval.approvalId,
    true
  );

  if (!result.success) {
    console.error("Failed to send approval response:", result.error);
  }

  // 2. También llamar al hook del AI SDK para actualizar el UI
  addToolApprovalResponse({
    id: pendingApproval.approvalId,
    approved: true,
  });

  setPendingApproval(null);
}, [pendingApproval, addToolApprovalResponse]);

const handleDeny = useCallback(async () => {
  if (!pendingApproval) return;

  // 1. Enviar respuesta al main process (desbloquea el stream)
  const result = await window.levante.sendToolApprovalResponse(
    pendingApproval.approvalId,
    false,
    "User denied"
  );

  if (!result.success) {
    console.error("Failed to send denial response:", result.error);
  }

  // 2. También llamar al hook del AI SDK para actualizar el UI
  addToolApprovalResponse({
    id: pendingApproval.approvalId,
    approved: false,
    reason: "User denied",
  });

  setPendingApproval(null);
}, [pendingApproval, addToolApprovalResponse]);
```

---

## Paso 6: Actualizar ChatStreamChunk Type

### Archivo: `src/main/services/aiService.ts` (interface ChatStreamChunk)

**Razón:** Añadir el nuevo tipo de chunk para notificar que la aprobación fue procesada.

```typescript
export interface ChatStreamChunk {
  delta?: string;
  done?: boolean;
  error?: string;
  sources?: Array<{ url: string; title?: string }>;
  reasoningText?: string;
  reasoningId?: string;
  toolCall?: { /* ... */ };
  toolResult?: { /* ... */ };
  toolApproval?: {  // Ya existe
    id: string;
    toolCallId: string;
    toolName: string;
    input: Record<string, any>;
  };
  toolApprovalProcessed?: {  // NUEVO
    approvalId: string;
    approved: boolean;
  };
  generatedAttachment?: { /* ... */ };
}
```

---

## Diagrama del Flujo Completo

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FLUJO DE TOOL APPROVAL                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  RENDERER                              MAIN PROCESS                          │
│  ────────                              ────────────                          │
│                                                                              │
│  Usuario envía mensaje                                                       │
│         │                                                                    │
│         ▼                                                                    │
│  ChatPage.tsx ─────────────────────►  aiService.streamChat()                │
│                  IPC: streamChat        │                                    │
│                                         ▼                                    │
│                                  streamText() con tools                      │
│                                         │                                    │
│                                         ▼                                    │
│                                  Modelo decide usar tool                     │
│                                         │                                    │
│                                         ▼                                    │
│                                  AI SDK emite:                               │
│                                  "tool-approval-request"                     │
│                                         │                                    │
│  ◄──────────────────────────────────────┤                                    │
│  yield { toolApproval }                 │                                    │
│         │                               │                                    │
│         ▼                               ▼                                    │
│  useToolApproval detecta         waitForApproval()                          │
│  state === "approval-requested"  ┌──────────────┐                           │
│         │                        │   PAUSADO    │                           │
│         ▼                        │  esperando   │                           │
│  Muestra ToolApprovalDialog      │  respuesta   │                           │
│         │                        └──────┬───────┘                           │
│         │                               │                                    │
│  Usuario hace clic en                   │                                    │
│  "Aprobar" o "Denegar"                  │                                    │
│         │                               │                                    │
│         ▼                               │                                    │
│  handleApprove/handleDeny()             │                                    │
│         │                               │                                    │
│         ├─► sendToolApprovalResponse ──►│                                    │
│         │   IPC: tool-approval-response │                                    │
│         │                               ▼                                    │
│         │                        resolveApproval()                           │
│         │                               │                                    │
│         │                               ▼                                    │
│         │                        Promise se resuelve                         │
│         │                               │                                    │
│         │                               ▼                                    │
│         │                        result.addToolApprovalResponse()            │
│         │                               │                                    │
│         │                               ▼                                    │
│         │                        Stream CONTINÚA                             │
│         │                               │                                    │
│         │                        ┌──────┴──────┐                             │
│         │                        │  approved?  │                             │
│         │                        └──────┬──────┘                             │
│         │                         /           \                              │
│         │                       YES            NO                            │
│         │                        │              │                            │
│         │                        ▼              ▼                            │
│         │                 execute() se    Modelo recibe                      │
│         │                 llama            denegación                        │
│         │                        │              │                            │
│         │                        ▼              ▼                            │
│  ◄──────┼────────────────────────┤              │                            │
│  yield { toolResult }            │     yield { text }                       │
│         │                        │              │                            │
│         ▼                        ▼              ▼                            │
│  UI muestra resultado     Stream termina  Stream termina                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Resumen de Cambios

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `src/main/services/ai/toolApprovalManager.ts` | **CREAR** | Manager para pausar/reanudar streams |
| `src/main/services/aiService.ts` | MODIFICAR | Pausar en `tool-approval-request` |
| `src/main/ipc/chatHandlers.ts` | MODIFICAR | Nuevo handler IPC |
| `src/preload/index.ts` | MODIFICAR | Exponer `sendToolApprovalResponse` |
| `src/preload/types/index.ts` | MODIFICAR | Añadir tipo |
| `src/renderer/hooks/useToolApproval.ts` | MODIFICAR | Llamar al nuevo IPC |

---

## Orden de Implementación

1. **Crear `toolApprovalManager.ts`** - Sin dependencias
2. **Modificar `aiService.ts`** - Depende de #1
3. **Modificar `chatHandlers.ts`** - Depende de #1
4. **Modificar `preload/index.ts` y `types`** - Depende de #3
5. **Modificar `useToolApproval.ts`** - Depende de #4

---

## Testing

### Caso 1: Usuario Aprueba

1. Conectar servidor MCP (ej: Supabase)
2. Pedir al modelo: "Lista las tablas del proyecto"
3. Verificar:
   - [ ] Diálogo aparece ANTES de que la tool se ejecute
   - [ ] Los argumentos se muestran correctamente en el diálogo
   - [ ] Al aprobar, la tool se ejecuta
   - [ ] El resultado aparece en el chat

### Caso 2: Usuario Deniega

1. Conectar servidor MCP
2. Pedir al modelo que use una tool
3. Hacer clic en "Denegar"
4. Verificar:
   - [ ] La tool NO se ejecuta
   - [ ] El modelo recibe feedback de que fue denegada
   - [ ] El modelo responde apropiadamente

### Caso 3: Timeout

1. Conectar servidor MCP
2. Pedir al modelo que use una tool
3. NO responder al diálogo
4. Esperar 5 minutos
5. Verificar:
   - [ ] Se cancela automáticamente
   - [ ] Error se maneja gracefully

### Caso 4: Múltiples Tools

1. Pedir al modelo una tarea que requiera múltiples tools
2. Verificar:
   - [ ] Cada tool espera aprobación individual
   - [ ] El flujo continúa correctamente después de cada aprobación

---

## Notas Importantes

### Por qué usamos Promise y no callbacks

El bucle `for await` en aiService.ts es síncrono en su iteración. No podemos "pausar" un generador de otra forma que no sea con `await`. Por eso usamos una Promise que se resuelve cuando el usuario responde.

### Por qué no usamos el flujo de dos llamadas

La documentación del AI SDK menciona que se puede hacer con dos llamadas al modelo. Sin embargo:
1. Requiere reconstruir el historial de mensajes
2. Es más propenso a errores con el formato de Anthropic
3. El método `addToolApprovalResponse()` dentro del stream es más limpio

### Compatibilidad con Anthropic

El error `tool_use ids were found without tool_result blocks` se resuelve porque ahora:
1. El stream pausa ANTES de ejecutar la tool
2. La aprobación se procesa correctamente
3. El AI SDK añade el `tool_result` en el lugar correcto del historial
