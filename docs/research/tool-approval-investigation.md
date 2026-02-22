# Tool Approval Investigation - AI SDK v6

**Fecha:** 2026-01-13
**Estado:** En progreso - Problema no resuelto
**AI SDK Version:** 6.0.3
**OpenRouter Provider:** 6.0.0-alpha.1

---

## Resumen Ejecutivo

La implementación de human-in-the-loop tool approval con el AI SDK v6 presenta desafíos significativos cuando se usa directamente `streamText()` en lugar del hook `useChat()` de React. Este documento detalla los hallazgos de la investigación.

---

## 1. El Problema Original

### Síntoma
Las tools MCP configuradas con `needsApproval: true` se ejecutaban **inmediatamente** sin esperar la aprobación del usuario.

### Comportamiento Esperado
1. El modelo solicita ejecutar una tool
2. La UI muestra un diálogo de aprobación
3. El usuario aprueba o rechaza
4. Solo si aprueba, la tool se ejecuta

### Comportamiento Real
Las tools se ejecutaban automáticamente ignorando `needsApproval: true`.

---

## 2. Arquitectura del AI SDK para Tool Approval

### 2.1 Flujo Documentado

Según la documentación oficial del AI SDK:

> "When a tool requires approval, `generateText` and `streamText` **don't pause execution**. Instead, they complete and return `tool-approval-request` parts in the result content."

Esto significa que el SDK **NO** pausa la ejecución esperando aprobación. En su lugar:

1. **Primera llamada a `streamText()`**: El modelo genera un `tool_use`, el SDK emite un evento `tool-approval-request` en el stream
2. **El stream termina**: Sin ejecutar la tool
3. **El cliente procesa la aprobación**: El usuario decide
4. **Segunda llamada a `streamText()`**: Con un mensaje `tool-approval-response` añadido
5. **El SDK ejecuta la tool**: Automáticamente si encuentra la correlación

### 2.2 Tipos de Mensajes Relevantes

```typescript
// Parte emitida cuando una tool requiere aprobación
interface ToolApprovalRequestPart {
  type: 'tool-approval-request';
  approvalId: string;      // ID único para correlacionar
  toolCallId: string;      // ID del tool call
  toolName: string;        // Nombre de la tool
  input: unknown;          // Argumentos de la tool
}

// Respuesta del usuario (debe añadirse al historial)
interface ToolApprovalResponsePart {
  type: 'tool-approval-response';
  approvalId: string;      // Debe coincidir con el request
  approved: boolean;       // true si aprobado
  reason?: string;         // Razón opcional
}

// Resultado de una tool ejecutada
interface ToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output: ToolResultOutput; // Formato estructurado requerido
}

// Formato del output (IMPORTANTE)
type ToolResultOutput =
  | { type: 'json'; value: unknown }
  | { type: 'text'; value: string }
  | { type: 'error-json'; value: unknown }
  | { type: 'error-text'; value: string };
```

### 2.3 UIMessage vs ModelMessage

**Diferencia crítica descubierta:**

| Aspecto | UIMessage | ModelMessage |
|---------|-----------|--------------|
| **Uso** | Hook `useChat()` (frontend) | `streamText()` (backend) |
| **Roles soportados** | `user`, `assistant`, `system` | `user`, `assistant`, `system`, `tool` |
| **Formato content** | `UIMessageContent` | `CoreMessageContent` |
| **Conversion** | Requiere `convertToModelMessages()` | Directo |

**El role `'tool'` NO existe en UIMessage**, causando el error:

```
Error: Unsupported role: tool
```

---

## 3. Funcionamiento Interno del SDK

### 3.1 Función `collectToolApprovals()`

Encontrada en `node_modules/ai/dist/index.js`:

```javascript
function collectToolApprovals(messages) {
  const result = new Map();
  for (const message of messages) {
    if (message.role === "tool") {
      for (const part of message.content) {
        if (part.type === "tool-approval-response") {
          result.set(part.approvalId, part);
        }
      }
    }
  }
  return result;
}
```

**Hallazgo clave:** El SDK busca `tool-approval-response` en mensajes con `role: 'tool'`. Esto solo funciona con `ModelMessage[]`, no con `UIMessage[]`.

### 3.2 Correlación de Aprobaciones

El SDK correlaciona automáticamente:

1. Busca `tool-approval-request` en el historial de mensajes
2. Busca `tool-approval-response` con el mismo `approvalId`
3. Si encuentra match y `approved: true`, ejecuta la tool via `executeToolCall()`

### 3.3 Función `executeToolCall()`

```javascript
async function executeToolCall({ toolCall, tools, ... }) {
  const tool = tools[toolCall.toolName];
  if (!tool || !tool.execute) return undefined;

  const result = await tool.execute(toolCall.args, { ... });
  return result;
}
```

---

## 4. Intentos de Solución y Resultados

### 4.1 Intento 1: Añadir mensaje con role 'tool' a UIMessage[]

```typescript
const approvalMessage = {
  role: 'tool' as const,
  content: [{ type: 'tool-approval-response', ... }],
};
messages.push(approvalMessage);
```

**Resultado:** ❌ `Error: Unsupported role: tool`

**Causa:** `UIMessage` no soporta el role `tool`.

### 4.2 Intento 2: Convertir a ModelMessage[] primero

```typescript
const modelMessages = await convertToModelMessages(messages);
modelMessages.push({
  role: 'tool',
  content: [{ type: 'tool-approval-response', ... }],
});

const result = streamText({ messages: modelMessages, ... });
```

**Resultado:** ❌ `Error: Invalid input: expected object, received null`

**Causa:** Bug en `@openrouter/ai-sdk-provider` v6.0.0-alpha.1 con la Responses API.

### 4.3 Intento 3: Ejecutar tool manualmente + tool-result

Cambio de estrategia: ejecutar la tool manualmente después de la aprobación y enviar un `tool-result` estándar.

```typescript
if (userResponse.approved) {
  // 1. Ejecutar tool manualmente
  const toolDef = tools[toolName];
  const toolExecutionResult = await toolDef.execute(toolInput);

  // 2. Convertir mensajes
  const modelMessages = await convertToModelMessages(messages);

  // 3. Añadir assistant message con tool-call
  modelMessages.push({
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId, toolName, input: toolInput }],
  });

  // 4. Añadir tool message con tool-result
  modelMessages.push({
    role: 'tool',
    content: [{ type: 'tool-result', toolCallId, toolName, output: toolExecutionResult }],
  });

  // 5. Segunda llamada
  const secondResult = streamText({ messages: modelMessages, ... });
}
```

**Resultado:** ❌ `Error: Invalid prompt: The messages do not match the ModelMessage[] schema`

**Causa:** El campo `output` requiere formato estructurado.

### 4.4 Intento 4: Formato correcto de output

```typescript
const toolOutput = toolExecutionError
  ? { type: 'error-json' as const, value: toolExecutionResult }
  : { type: 'json' as const, value: toolExecutionResult };

modelMessages.push({
  role: 'tool',
  content: [{ type: 'tool-result', toolCallId, toolName, output: toolOutput }],
});
```

**Resultado:** Compilación exitosa, pero comportamiento aún no verificado funcionalmente.

---

## 5. Problemas con OpenRouter Provider v6

### 5.1 Versión Alpha

El paquete `@openrouter/ai-sdk-provider` versión 6.0.0-alpha.1 tiene varios problemas:

1. **Usa Responses API**: Formato diferente al estándar de chat completions
2. **Validación estricta**: Errores de schema con campos como `response.usage`
3. **Incompatibilidad**: No se puede hacer downgrade a v1.x porque requiere `ai@^5.0.0`

### 5.2 Error Recurrente

```json
{
  "code": "invalid_type",
  "expected": "object",
  "received": "null",
  "path": ["response", "usage"]
}
```

Este error aparece intermitentemente y parece ser un bug del provider alpha.

---

## 6. Diferencias entre useChat y streamText

### 6.1 Hook useChat (Frontend)

```typescript
// El hook maneja automáticamente las aprobaciones
const { addToolApprovalResponse } = useChat();

// Solo hay que llamar este método
addToolApprovalResponse({
  approvalId,
  approved: true,
  reason: 'User approved',
});
// El hook se encarga de todo internamente
```

### 6.2 streamText (Backend)

```typescript
// NO existe addToolApprovalResponse en el resultado
const result = streamText({ ... });

// Hay que manejar manualmente:
// 1. Detectar tool-approval-request
// 2. Pausar y esperar respuesta del usuario
// 3. Construir mensaje con tool-approval-response
// 4. Hacer segunda llamada con mensajes actualizados
```

---

## 7. Solución Propuesta (No Implementada)

Basado en la investigación, la solución correcta sería:

### 7.1 Opción A: Migrar a useChat

Usar el hook `useChat` de React que maneja internamente las aprobaciones. Esto requeriría:

1. Mover lógica de streaming al frontend
2. Usar `useChat` con configuración de tools
3. Implementar `onToolCall` para aprobaciones personalizadas

**Pros:** Manejo automático de aprobaciones
**Cons:** Requiere reestructuración significativa de la arquitectura

### 7.2 Opción B: Ejecución Manual Completa

Implementar todo el flujo manualmente sin depender del mecanismo de `tool-approval-response`:

```typescript
case "tool-approval-request":
  // 1. Notificar al frontend
  yield { toolApproval: { ... } };

  // 2. Esperar respuesta (Promise)
  const response = await waitForApproval(approvalId);

  if (response.approved) {
    // 3. Ejecutar tool manualmente
    const result = await tools[toolName].execute(input);

    // 4. Enviar resultado al frontend
    yield { toolResult: { ... } };

    // 5. Construir historial correcto para segunda llamada
    // PERO: ¿Cómo evitar el problema del provider?
  }
  break;
```

### 7.3 Opción C: Cambiar de Provider

Usar un provider diferente que no tenga los bugs de la versión alpha:

- `@ai-sdk/anthropic` directamente
- `@ai-sdk/openai`
- Provider custom

---

## 8. Archivos Relevantes

| Archivo | Propósito |
|---------|-----------|
| `src/main/services/aiService.ts` | Servicio principal de AI, maneja streaming |
| `src/main/services/ai/toolApprovalManager.ts` | Manager para pausar/reanudar streams |
| `src/main/services/ai/providerResolver.ts` | Configuración de providers |
| `src/main/ipc/chatHandlers.ts` | Handlers IPC para chat |
| `src/renderer/hooks/useToolApproval.ts` | Hook para UI de aprobación |
| `src/renderer/stores/toolApprovalStore.ts` | Estado de aprobaciones pendientes |
| `node_modules/ai/dist/index.js` | Código fuente del AI SDK |

---

## 9. Referencias

- [AI SDK Core - Tools and Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [AI SDK UI - useChat Hook](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot)
- [OpenRouter AI SDK Provider](https://github.com/OpenRouterTeam/ai-sdk-provider)
- [Anthropic Tool Use Documentation](https://docs.anthropic.com/en/docs/tool-use)

---

## 10. Conclusiones

### Lo que funciona
- Detección de `tool-approval-request` en el stream
- Pausa del stream esperando respuesta del usuario
- Comunicación IPC entre frontend y backend
- Ejecución manual de tools

### Lo que NO funciona
- Enviar `tool-approval-response` al provider (formato no reconocido)
- Segunda llamada a `streamText()` con mensajes que incluyen role `tool`
- Compatibilidad con `@openrouter/ai-sdk-provider` v6 alpha

### Recomendación
Investigar más a fondo la Opción A (migrar a `useChat`) o esperar una versión estable del provider de OpenRouter. La arquitectura actual de Levante (streaming desde el main process) dificulta el uso del mecanismo estándar de aprobaciones del AI SDK.
