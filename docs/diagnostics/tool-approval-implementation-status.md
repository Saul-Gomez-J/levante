# Tool Approval Implementation - Status Report

**Fecha:** 2026-01-12
**Estado:** En progreso - Error con role 'tool'

---

## Resumen del Problema Original

Las tools MCP con `needsApproval: true` se ejecutaban **inmediatamente** sin esperar la aprobación del usuario.

### Causa Raíz Identificada

Según la documentación del AI SDK Core:

> "When a tool requires approval, `generateText` and `streamText` **don't pause execution**. Instead, they complete and return `tool-approval-request` parts in the result content."

El método `addToolApprovalResponse()` **NO existe** en el objeto `result` de `streamText()`. Es una función del hook `useChat` (cliente React), no del servidor.

### Solución Correcta (según documentación)

El AI SDK Core requiere **dos llamadas** al modelo:

1. **Primera llamada**: El modelo genera un `tool_use`, el SDK emite `tool-approval-request`
2. **Esperar aprobación** del usuario
3. **Construir mensaje de aprobación** con `role: 'tool'` y `content: [ToolApprovalResponse]`
4. **Segunda llamada**: Con los mensajes actualizados, el SDK ejecuta la tool

---

## Cambios Implementados

### 1. `src/main/services/ai/toolApprovalManager.ts` (NUEVO)

Manager para pausar/reanudar streams usando Promises:

```typescript
export function waitForApproval(approvalId, toolName, input): Promise<ApprovalResponse>
export function resolveApproval(approvalId, approved, reason): boolean
export function cancelAllPendingApprovals(): void
```

### 2. `src/main/services/aiService.ts`

#### Import añadido:
```typescript
import { type ToolApprovalResponse } from "ai";
import { waitForApproval, cancelAllPendingApprovals } from "./ai/toolApprovalManager";
```

#### Case `tool-approval-request` modificado:

```typescript
case "tool-approval-request":
  // 1. Enviar solicitud al frontend
  yield { toolApproval: {...} };

  // 2. PAUSAR esperando respuesta del usuario
  const userResponse = await waitForApproval(approvalId, toolName, toolInput);

  // 3. Si aprobado, construir mensaje y hacer segunda llamada
  if (userResponse.approved) {
    const approvalResponse: ToolApprovalResponse = {
      type: 'tool-approval-response',
      approvalId: approvalId,
      approved: true,
      reason: 'User approved the tool execution',
    };

    const approvalMessage = {
      id: `approval-${approvalId}`,
      role: 'tool' as const,
      content: [approvalResponse],
    };

    // Segunda llamada recursiva
    const updatedMessages = [...messages, approvalMessage as any];
    for await (const secondChunk of this.streamChat({...request, messages: updatedMessages})) {
      yield secondChunk;
    }
    return;
  }
  break;
```

### 3. `src/main/ipc/chatHandlers.ts`

Nuevo handler IPC:
```typescript
ipcMain.handle("levante/chat/tool-approval-response", handleToolApprovalResponse);
```

### 4. `src/preload/api/chat.ts`

Nuevo método expuesto:
```typescript
sendToolApprovalResponse: (approvalId, approved, reason) =>
  ipcRenderer.invoke('levante/chat/tool-approval-response', {...})
```

### 5. `src/renderer/hooks/useToolApproval.ts`

Handlers modificados para llamar al IPC:
```typescript
const handleApprove = async () => {
  await window.levante.sendToolApprovalResponse(approvalId, true);
  addToolApprovalResponse({...});
};
```

---

## Error Actual

### Mensaje de Error

```
Error: Unsupported role: tool
```

### Causa Probable

El proveedor (Anthropic/OpenRouter) **no soporta** el role `'tool'` en el formato que estamos enviando.

### Análisis

Según la documentación del AI SDK, el mensaje de aprobación debería ser:

```typescript
messages.push({ role: 'tool', content: [ToolApprovalResponse] });
```

Pero los proveedores tienen formatos diferentes:

| Proveedor | Formato de Tool Result |
|-----------|------------------------|
| **OpenAI** | `role: 'tool'` con `tool_call_id` |
| **Anthropic** | `role: 'user'` con `type: 'tool_result'` |
| **AI SDK** | Abstrae con `convertToModelMessages()` |

### Hipótesis

1. El AI SDK espera que `convertToModelMessages()` convierta el mensaje, pero no está manejando `ToolApprovalResponse`
2. El role `'tool'` no es válido para el formato `UIMessage` que usamos
3. Necesitamos usar un formato diferente o pasar el mensaje de otra forma

---

## Próximos Pasos

### Opción A: Investigar formato correcto

1. Buscar en la documentación del AI SDK cómo se debe construir el mensaje de aprobación para `convertToModelMessages()`
2. Verificar si `UIMessage` soporta role `'tool'` o si necesita otro formato

### Opción B: Usar CoreMessage directamente

1. En lugar de añadir a `messages` (UIMessage[]), pasar directamente a `streamText()` como mensajes de modelo
2. Saltear `convertToModelMessages()` para el mensaje de aprobación

### Opción C: Simular la aprobación de otra forma

1. En lugar de hacer una segunda llamada, modificar cómo el AI SDK maneja las tools
2. Ejecutar la tool manualmente después de la aprobación y construir el resultado

---

## Logs de Debug Añadidos

Para entender mejor la API del objeto `result`:

```typescript
this.logger.aiSdk.debug("Result object inspection", {
  resultKeys: Object.keys(result),
  hasAddToolApprovalResponse: typeof (result as any).addToolApprovalResponse === 'function',
  methods: Object.getOwnPropertyNames(Object.getPrototypeOf(result)),
});
```

---

## Archivos Modificados

| Archivo | Estado |
|---------|--------|
| `src/main/services/ai/toolApprovalManager.ts` | ✅ Nuevo |
| `src/main/services/aiService.ts` | ✅ Modificado |
| `src/main/ipc/chatHandlers.ts` | ✅ Modificado |
| `src/preload/api/chat.ts` | ✅ Modificado |
| `src/preload/preload.ts` | ✅ Modificado |
| `src/preload/types/index.ts` | ✅ Modificado |
| `src/renderer/hooks/useToolApproval.ts` | ✅ Modificado |

---

## Referencias

- [AI SDK Core - Tool Approval](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [AI SDK - ToolApprovalResponse type](https://github.com/vercel/ai)
- [Anthropic API - Tool Use](https://docs.anthropic.com/en/docs/tool-use)
