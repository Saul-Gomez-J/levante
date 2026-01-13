# Tool Approval Flow Documentation

Este documento describe la arquitectura e implementación del flujo de aprobación de herramientas MCP en Levante.

## Resumen

Levante implementa un sistema de aprobación de herramientas MCP siguiendo el patrón de **Human-in-the-Loop** del Vercel AI SDK v6. Todas las herramientas MCP requieren aprobación explícita del usuario antes de ejecutarse.

**Versión del AI SDK**: `ai@6.0.3` con `@ai-sdk/react@3.0.3`

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              RENDERER                                    │
│                                                                          │
│  ┌──────────────┐    ┌───────────────────┐    ┌─────────────────────┐  │
│  │  ChatPage    │    │  useToolApproval  │    │ ToolApprovalDialog  │  │
│  │              │◄───│                   │───►│                     │  │
│  │ useChat()    │    │ - Detect pending  │    │ - Approve once      │  │
│  │              │    │ - Auto-approve    │    │ - Approve session   │  │
│  │ shouldAuto-  │    │ - Handle deny     │    │ - Deny + feedback   │  │
│  │ SendAfter-   │    │                   │    │                     │  │
│  │ Approval()   │    └───────────────────┘    └─────────────────────┘  │
│  └──────┬───────┘                                                       │
│         │                                                                │
└─────────┼────────────────────────────────────────────────────────────────┘
          │ IPC (levante/chat/stream)
          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              MAIN PROCESS                                │
│                                                                          │
│  ┌──────────────────┐         ┌─────────────────────────────────────┐  │
│  │   aiService      │         │         mcpToolsAdapter             │  │
│  │                  │◄────────│                                     │  │
│  │ streamChat()     │         │ createAITools()                     │  │
│  │ - streamText()   │         │ - needsApproval: true (always)      │  │
│  │ - Handle chunks  │         │                                     │  │
│  └──────────────────┘         └─────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Alineación con AI SDK v6

### Características del AI SDK utilizadas

| Característica | Uso en Levante | Documentación AI SDK |
|----------------|----------------|----------------------|
| `needsApproval: true` | Todas las tools MCP | [Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) |
| `addToolApprovalResponse()` | Enviar respuesta de aprobación/denegación | [Chatbot Tool Usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage) |
| `sendAutomaticallyWhen` | Custom function para control de auto-envío | [useChat Options](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat) |
| Tool part states | `approval-requested`, `approval-responded`, `output-available`, `output-denied` | AI SDK internals |

### Desviaciones de la documentación estándar

1. **`sendAutomaticallyWhen` personalizado**: En lugar de usar `lastAssistantMessageIsCompleteWithApprovalResponses` del AI SDK, usamos una función personalizada `shouldAutoSendAfterApproval` que controla cuándo auto-continuar.

   **Razones**:
   - La función estándar del AI SDK no diferencia entre `approved: true` y `approved: false`, causando bucles infinitos cuando se denegaba una tool.
   - La función estándar tampoco diferencia entre tools "aprobadas pendientes de ejecución" y tools "ya ejecutadas", causando bucles infinitos después de la ejecución exitosa.

2. **No usamos `stop()`**: El diagnóstico inicial intentaba usar `stop()` para detener el stream al denegar, pero `stop()` tiene limitaciones conocidas ([Issue #10719](https://github.com/vercel/ai/issues/10719)).

## Flujo Detallado

### 1. Tool Approval Request

```
AI Model requests tool execution
          ↓
AI SDK emits 'tool-approval-request' chunk
          ↓
aiService.ts yields toolApproval chunk
          ↓
ElectronChatTransport converts to UIMessageChunk
          ↓
useChat() updates messages with part.state = 'approval-requested'
          ↓
useToolApproval detects pending approval
          ↓
ToolApprovalDialog shown to user
```

### 2. User Approves

```
User clicks "Approve" or "Approve for session"
          ↓
addToolApprovalResponse({ id, approved: true })
          ↓
AI SDK updates part.state = 'approval-responded'
          ↓
shouldAutoSendAfterApproval() returns TRUE  ← Tool aprobada pero NO ejecutada aún
          ↓
AI SDK auto-sends next request
          ↓
Tool executes → part.state = 'output-available'
          ↓
shouldAutoSendAfterApproval() returns FALSE  ← Tool YA ejecutada, no continuar
          ↓
AI finishes response with tool result
          ↓
Chat stays in 'ready' state (no infinite loop)
```

### 3. User Denies

```
User clicks "Deny"
          ↓
addToolApprovalResponse({ id, approved: false, reason })
          ↓
AI SDK updates part.state = 'approval-responded' (approved: false)
          ↓
shouldAutoSendAfterApproval() returns FALSE  ← KEY DIFFERENCE
          ↓
NO auto-send triggered
          ↓
Chat stays in 'ready' state
          ↓
User can send new message normally
```

## Componentes Clave

### 1. `shouldAutoSendAfterApproval` (ChatPage.tsx)

```typescript
function shouldAutoSendAfterApproval({ messages }: { messages: UIMessage[] }): boolean {
  const lastAssistant = messages.filter(m => m.role === 'assistant').pop();
  if (!lastAssistant || !lastAssistant.parts) return false;

  const toolParts = lastAssistant.parts.filter((p: any) =>
    p.type === 'tool-invocation' ||
    p.type?.startsWith('tool-') ||
    p.type === 'dynamic-tool'
  );

  if (toolParts.length === 0) return false;

  // Si TODAS las tools ya se ejecutaron, NO continuar (nada pendiente)
  const allToolsExecuted = toolParts.every((p: any) => p.state === 'output-available');
  if (allToolsExecuted) return false;

  // Si hay tools bloqueadas (esperando aprobación, denegadas), no continuar
  const hasBlockingTools = toolParts.some((p: any) =>
    p.state === 'approval-requested' ||
    p.state === 'output-denied' ||
    (p.state === 'approval-responded' && p.approval?.approved === false)
  );
  if (hasBlockingTools) return false;

  // Solo continuar si hay tools aprobadas esperando ejecución
  const hasApprovedToolsWaiting = toolParts.some((p: any) =>
    p.state === 'approval-responded' && p.approval?.approved === true
  );

  return hasApprovedToolsWaiting;
}
```

**Propósito**: Controlar cuándo el AI SDK debe auto-enviar el siguiente request.

**Lógica de decisión**:
| Condición | Retorna | Razón |
|-----------|---------|-------|
| Todas las tools en `output-available` | `false` | Ya se ejecutaron, nada pendiente |
| Alguna tool en `approval-requested` | `false` | Esperando decisión del usuario |
| Alguna tool denegada | `false` | No continuar si hay denegaciones |
| Tools aprobadas sin ejecutar | `true` | Hay trabajo pendiente |

### 2. `useToolApproval` Hook

```typescript
// Ubicación: src/renderer/hooks/useToolApproval.ts

interface UseToolApprovalOptions {
  sessionId: string | null;
  messages: UIMessage[];
  addToolApprovalResponse: (params: { id: string; approved: boolean; reason?: string }) => void;
  onToolDenied?: (info: { toolName: string; serverId: string; feedback?: string }) => void;
}
```

**Responsabilidades**:
- Detectar `approval-requested` en los mensajes
- Gestionar auto-aprobación por sesión
- Exponer handlers: `handleApprove`, `handleApproveForSession`, `handleDeny`, `handleClose`

### 3. `mcpToolsAdapter.ts`

```typescript
const aiTool = tool({
  description: mcpTool.description,
  inputSchema: inputSchema,
  needsApproval: true,  // SIEMPRE requiere aprobación
  execute: async (args) => {
    // Ejecución de la tool MCP
  },
});
```

**Nota**: Todas las tools MCP tienen `needsApproval: true` hardcodeado. La lógica de auto-aprobación está en el renderer, no en el adapter.

### 4. `toolApprovalStore` (Zustand)

```typescript
// Ubicación: src/renderer/stores/toolApprovalStore.ts

interface ToolApprovalState {
  sessionApprovals: Map<string, Set<string>>;  // sessionId → Set<serverId>
  isServerApprovedForSession: (sessionId: string, serverId: string) => boolean;
  approveServerForSession: (sessionId: string, serverId: string) => void;
  clearSessionApprovals: (sessionId: string) => void;
}
```

**Propósito**: Almacenar aprobaciones a nivel de sesión para permitir auto-aprobación de tools del mismo servidor.

## Estados de Tool Parts

| Estado | Significado | Acción del SDK |
|--------|-------------|----------------|
| `approval-requested` | Esperando decisión del usuario | Mostrar diálogo |
| `approval-responded` | Usuario respondió | Verificar `approval.approved` |
| `output-available` | Tool ejecutada exitosamente | Continuar con resultado |
| `output-denied` | Tool denegada | No continuar |

## Historial de Problemas Resueltos

### Problema 1: Error 500 de OpenRouter

**Síntoma**: Al denegar una tool, se producía un error 500.

**Causa raíz**: `lastAssistantMessageIsCompleteWithApprovalResponses` del AI SDK dispara auto-envío para CUALQUIER `approval-responded`, sin importar si `approved: true` o `false`.

**Solución**: Reemplazar con `shouldAutoSendAfterApproval` que solo auto-continúa si `approved: true`.

### Problema 2: Bucle infinito

**Síntoma**: Después de denegar, aparecía el mensaje de denegación repetido infinitamente.

**Causa raíz**: Se implementó un short-circuit en el servidor que detectaba tools denegadas y respondía inmediatamente, pero el AI SDK seguía disparando requests.

**Solución**: Eliminar el short-circuit del servidor. La solución correcta es prevenir el auto-envío en el cliente.

### Problema 3: Short-circuit interferencia

**Síntoma**: Después de denegar una tool, el siguiente mensaje del usuario recibía una respuesta inmediata del short-circuit.

**Causa raíz**: El método `detectDeniedTool()` buscaba en todo el historial sin distinguir si el usuario ya había enviado un nuevo mensaje.

**Solución**: Eliminar completamente `detectDeniedTool()` y el short-circuit. No son necesarios con `shouldAutoSendAfterApproval`.

### Problema 4: Bucle infinito después de ejecución exitosa

**Síntoma**: Después de aprobar y ejecutar una tool exitosamente, el chat se quedaba en estado de "cargando" con logs continuos cada ~2 segundos:
- "About to persist message" repetidamente
- "File attachment support check" continuamente
- AI SDK warnings sobre specificationVersion

**Causa raíz**: La función `shouldAutoSendAfterApproval` retornaba `true` para tools en estado `output-available`:

```typescript
// PROBLEMA: Esto causaba bucle infinito
if (p.state === 'output-available') return true;
```

El AI SDK evaluaba continuamente `sendAutomaticallyWhen`. Como la función retornaba `true` para tools ya ejecutadas, el SDK seguía enviando requests automáticamente en un bucle infinito.

**Solución**: Modificar la lógica para que:
1. `output-available` → retorne `false` (tool ya ejecutada, nada pendiente)
2. Solo retorne `true` cuando hay tools en `approval-responded` (aprobadas) que AÚN NO se han ejecutado

```typescript
// SOLUCIÓN: Verificar si todas las tools ya se ejecutaron
const allToolsExecuted = toolParts.every((p: any) => p.state === 'output-available');
if (allToolsExecuted) return false;  // ← Detener el bucle
```

## Testing Checklist

- [ ] **Aprobar tool**: AI pide tool → Aprobar → Tool se ejecuta → AI continúa → **Chat queda en 'ready' (sin bucle infinito)**
- [ ] **Aprobar para sesión**: AI pide tool → Aprobar para sesión → Futuras tools del mismo servidor se auto-aprueban
- [ ] **Denegar tool**: AI pide tool → Denegar → Chat queda listo → Enviar nuevo mensaje funciona normalmente
- [ ] **Múltiples tools**: AI pide 2+ tools → Aprobar todas → Todas se ejecutan → **Chat queda en 'ready'**
- [ ] **Mix aprobación/denegación**: AI pide 2 tools → Aprobar una, denegar otra → Flujo correcto
- [ ] **Denegación consecutiva**: Denegar → Nuevo mensaje → AI pide otra tool → Denegar → Funciona
- [ ] **No hay logs continuos**: Después de ejecutar tool, verificar que NO hay logs repetitivos cada 2 segundos

## Referencias

- [AI SDK Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [AI SDK Chatbot Tool Usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage)
- [AI SDK useChat Hook](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat)
- [Issue #10169: onFinish breaks Tool needsApproval](https://github.com/vercel/ai/issues/10169)
- [Issue #10719: stop() does not cancel streaming](https://github.com/vercel/ai/issues/10719)

## Archivos Relevantes

| Archivo | Responsabilidad |
|---------|-----------------|
| `src/renderer/pages/ChatPage.tsx` | `shouldAutoSendAfterApproval`, configuración de `useChat` |
| `src/renderer/hooks/useToolApproval.ts` | Hook principal de aprobación |
| `src/renderer/stores/toolApprovalStore.ts` | Estado de aprobaciones por sesión |
| `src/renderer/components/chat/ToolApprovalDialog.tsx` | UI del diálogo de aprobación |
| `src/main/services/ai/mcpToolsAdapter.ts` | Creación de tools con `needsApproval: true` |
| `src/main/services/aiService.ts` | Streaming de chat (sin short-circuit) |
| `src/renderer/transports/ElectronChatTransport.ts` | Conversión de chunks IPC → AI SDK |
