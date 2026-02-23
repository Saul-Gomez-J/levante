# Diagnóstico: Fallo en Ejecución de MCP Tools

**Fecha:** 2026-02-23
**Estado:** Investigación completa

---

## Resumen Ejecutivo

La ejecución de MCP tools falla porque el flag `needsApproval: true` que se aplica a todas las herramientas MCP activa un flujo del AI SDK que requiere aprobación humana, pero **ninguna parte de la arquitectura actual implementa ese flujo de aprobación**. El resultado es:

- La tool call llega al renderer pero nunca se ejecuta → queda en estado "Ejecutando..." para siempre
- No aparece UI de approve/deny porque el sistema nunca notifica al renderer que hay una aprobación pendiente

---

## Flujo Esperado vs. Flujo Real

### Flujo esperado (con `needsApproval: true`)

```
AI genera tool-call
    ↓
AI SDK emite chunk "tool-approval-request"
    ↓
Main process notifica al renderer "hay una tool pendiente de aprobación"
    ↓
Renderer muestra UI: [Aprobar] [Denegar]
    ↓
Usuario hace click en Aprobar
    ↓
Renderer envía aprobación al main process vía IPC
    ↓
Main process ejecuta la tool y obtiene resultado
    ↓
Stream continúa con el resultado → AI genera respuesta final
```

### Flujo real (lo que ocurre hoy)

```
AI genera tool-call
    ↓
AI SDK emite chunk "tool-approval-request"
    ↓
aiService.ts lo recibe pero NO tiene handler para ese tipo de chunk → lo ignora silenciosamente
    ↓
La tool NO se ejecuta (el AI SDK la filtra de ejecutarse cuando needsApproval=true)
    ↓
Stream se completa con done: true (sin tool result)
    ↓
Renderer recibe "tool-input-available" pero nunca recibe "tool-output-available"
    ↓
Tool queda en estado input-available = "Ejecutando..." para siempre
    ↓
No aparece UI de approve/deny porque el renderer nunca supo que había una aprobación pendiente
```

---

## Análisis Técnico Detallado

### 1. Configuración de `needsApproval` (mcpToolsAdapter.ts:292)

```typescript
// src/main/services/ai/mcpToolsAdapter.ts
const aiTool = tool({
  description: mcpTool.description,
  inputSchema: inputSchema,
  needsApproval: !skipApproval,  // ← true por defecto
  execute: async (args) => {
    // Esta función NUNCA se llama cuando needsApproval=true
    const result = await mcpService.callTool(serverId, { ... });
    return result;
  },
});
```

**Por defecto**, `skipApproval = false`, por lo tanto `needsApproval = true` para todas las tools MCP.

La función `shouldSkipToolApproval()` (`aiService.ts:857`) devuelve `true` sólo si el proveedor está en la lista `providersWithoutToolApproval` en preferencias. Si esa lista está vacía (por defecto), **todas las tools requieren aprobación**.

---

### 2. Comportamiento del AI SDK cuando `needsApproval: true`

Verificado en `node_modules/ai/dist/index.js`:

```javascript
// Dentro del loop de procesamiento de tool calls (streamText)
if (await isApprovalNeeded({ tool, toolCall, messages })) {
  toolResultsStreamController.enqueue({
    type: "tool-approval-request",  // ← emite este chunk especial
    approvalId: generateId(),
    toolCall
  });
  break;  // ← detiene el procesamiento de esta tool
}

// Tools en toolApprovalRequests son EXCLUIDAS de la ejecución:
clientToolCalls.filter(
  (toolCall) => !toolCall.invalid && toolApprovalRequests[toolCall.toolCallId] == null
  //                                 ↑ las tools con aprobación pendiente son filtradas
)
```

**Consecuencia:** cuando `needsApproval: true`, el AI SDK:
1. Emite un chunk de tipo `"tool-approval-request"` al `fullStream`
2. **NO llama a `tool.execute()`** - la tool nunca se ejecuta
3. El stream puede completarse normalmente, pero sin resultado de la tool

---

### 3. El chunk `tool-approval-request` es ignorado (aiService.ts:1287)

El loop que consume `result.fullStream` en `aiService.ts` tiene un switch que maneja:

```typescript
switch (chunk.type) {
  case "text-delta":   ...
  case "reasoning-start": ...
  case "reasoning-delta": ...
  case "reasoning-end": ...
  case "tool-call":    yield { toolCall: { ... } };
  case "tool-result":  yield { toolResult: { ... } };
  case "tool-error":   yield { toolResult: { ..., status: "error" } };
  case "error":        ...
  // ❌ NO HAY CASE PARA "tool-approval-request"
}
```

El chunk `tool-approval-request` cae por defecto → **ignorado completamente**. El renderer nunca se entera de que existe una aprobación pendiente.

---

### 4. El renderer recibe la tool pero no puede aprobarla

El `ElectronChatTransport` convierte el chunk `toolCall` a chunks del AI SDK v5:

```typescript
// src/renderer/transports/ElectronChatTransport.ts:314-328
if (chunk.toolCall) {
  yield { type: "tool-input-start", toolCallId: chunk.toolCall.id, toolName: chunk.toolCall.name };
  yield { type: "tool-input-available", toolCallId: chunk.toolCall.id, ... };
  // ← El renderer sabe que hay una tool call, pero NO sabe que necesita aprobación
  // ← No hay chunk de tipo "approval-needed" ni similar
}
```

La herramienta llega al renderer en estado `input-available`. El componente `ChatMessageItem.tsx:413` traduce esto a `status: 'running'`, que el componente `ToolCall` (`tool-call.tsx:57`) muestra como **"Ejecutando..."**.

---

### 5. No existe UI de approve/deny

Aunque `tool.tsx` tiene estados visuales para `approval-requested` y `approval-responded`:

```typescript
// src/renderer/components/ai-elements/tool.tsx
const labels = {
  'approval-requested': 'Approval Requested',  // ← existe el label
  'approval-responded': 'Approved',             // ← existe el label
  ...
}
```

**Nunca se muestran** porque:
- No hay lógica para transicionar a esos estados
- No hay botones de Aprobar/Denegar en ningún componente
- No existe ninguna llamada a `addToolResult()` en el renderer
- No existe canal IPC `levante/chat/approve-tool` ni similar

---

### 6. El sistema no puede reanudar tras la aprobación

Incluso si se implementara la UI de aprobación, faltaría la infraestructura completa:

| Componente faltante | Descripción |
|---|---|
| IPC `levante/chat/approve-tool` | Canal para enviar aprobación del renderer al main |
| IPC `levante/chat/deny-tool` | Canal para enviar rechazo |
| Mecanismo de reanudación del stream | El stream se completó; hay que relanzarlo con el tool result |
| Almacenamiento de tool-approval-requests | El main process no guarda los `approvalId` activos |
| `addToolResult()` en renderer | Función del AI SDK para inyectar resultados de tools |

---

## Puntos de Fallo Exactos

| Archivo | Línea | Problema |
|---|---|---|
| `src/main/services/ai/mcpToolsAdapter.ts` | 292 | `needsApproval: true` por defecto → desencadena flujo roto |
| `src/main/services/aiService.ts` | ~1287 (switch) | No hay handler para chunk `"tool-approval-request"` |
| `src/main/services/aiService.ts` | ~1199 | `streamText` completa sin tool result → stream se cierra |
| `src/renderer/transports/ElectronChatTransport.ts` | 314-328 | No notifica al renderer que se necesita aprobación |
| `src/preload/types/index.ts` | 35 | `ChatStreamChunk` no tiene campo `needsApproval` |
| `src/renderer/components/chat/ChatMessageItem.tsx` | 413 | `input-available` → `running` → "Ejecutando..." sin resolución |
| Toda la codebase renderer | — | `addToolResult()` no existe en ningún lugar |

---

## Opciones de Solución

### Opción A: Deshabilitar `needsApproval` (solución rápida)

Poner `skipApproval: true` por defecto en `getMCPTools()`:

```typescript
// mcpToolsAdapter.ts
const aiTool = tool({
  needsApproval: false,  // ← tools se ejecutan directamente
  execute: async (args) => { ... }
});
```

**Pros:** Las tools funcionan inmediatamente.
**Contras:** No hay control de usuario sobre qué tools se ejecutan. Las tools destructivas se ejecutarán sin confirmación.

### Opción B: Implementar el flujo completo de aprobación

Requiere cambios en múltiples capas:

1. **Main process:** Capturar chunks `tool-approval-request` y almacenarlos. Emitir nuevo tipo de chunk al renderer con `needsApproval: true`.

2. **Preload types:** Añadir campo `approvalRequest` a `ChatStreamChunk`.

3. **ElectronChatTransport:** Convertir `approvalRequest` chunks en algún mecanismo de UI.

4. **IPC:** Crear canal `levante/chat/resolve-tool-approval` para recibir aprobaciones/rechazos del renderer.

5. **UI renderer:** Crear componente de aprobación con botones Aprobar/Denegar.

6. **Reanudación del stream:** Cuando el usuario aprueba, relanzar el stream con el tool result inyectado (esto es el paso más complejo ya que el stream original ya terminó).

### Opción C: Configuración por proveedor (solución intermedia)

La infraestructura de `providersWithoutToolApproval` ya existe. La solución sería exponer en la UI de Settings la opción de marcar proveedores como "sin aprobación requerida", y dejar `needsApproval: true` para proveedores que sí quieran aprobación cuando se implemente el flujo completo.

---

## Diagnóstico Adicional: Por qué "se corta la ejecución"

Cuando la tool queda sin resultado, el AI SDK no puede continuar al siguiente paso (no hay tool result para incluir en el siguiente turno). El stream completa el paso actual con la tool en estado "pending", pero no genera continuación del asistente.

Resultado: el usuario ve la tool en "Ejecutando..." y el asistente no genera ningún texto adicional. Parece como si la ejecución se hubiera cortado, aunque técnicamente el stream completó correctamente desde el punto de vista del transporte.

---

## Verificación Rápida

Para confirmar este diagnóstico, se puede:

1. **Añadir temporalmente** el proveedor activo a la lista `providersWithoutToolApproval` en Settings → AI → y comprobar que las tools se ejecutan correctamente.

2. **Revisar los logs** del main process buscando chunks de tipo `"tool-approval-request"` que nunca son manejados.

3. **Añadir un log temporal** en el switch de `aiService.ts` para el default case y verificar que recibe `tool-approval-request`.
