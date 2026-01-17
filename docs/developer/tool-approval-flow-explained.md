# Guía Completa: Flujo de Tool Approval en Levante

> **Última actualización**: Enero 2026
>
> Este documento describe el flujo completo de aprobación de herramientas (Tool Approval) en Levante, incluyendo los problemas que se encontraron durante el desarrollo y sus soluciones.

## Índice
1. [Introducción](#introducción)
2. [Arquitectura General](#arquitectura-general)
3. [El Flujo Paso a Paso](#el-flujo-paso-a-paso)
4. [El Problema Original (YA RESUELTO)](#el-problema-original-ya-resuelto-)
5. [Análisis de los Logs](#análisis-de-los-logs)
6. [Glosario de Términos](#glosario-de-términos)
7. [Solución: Formato de Chunks](#solución-encontrada-)
8. [Solución: Reset de State](#segundo-bug-encontrado-)
9. [Solución: Manejo de Tool Denial](#tercer-bug-resuelto-manejo-de-tool-denial-)
10. [Archivos Clave](#archivos-clave-del-flujo-de-tool-approval)
11. [Resumen de Cambios](#resumen-de-cambios-implementados)

---

## Introducción

### ¿Qué es Tool Approval?

Cuando una IA usa herramientas (tools) para hacer cosas como ejecutar comandos, modificar archivos, o acceder a APIs externas, a veces queremos **pedir permiso al usuario antes de ejecutar** esas herramientas.

Por ejemplo:
- El usuario dice: "Lista mis proyectos de Supabase"
- La IA quiere usar la herramienta `supabase_list_projects`
- En lugar de ejecutarla automáticamente, mostramos un botón "Aprobar" al usuario
- Solo después de que el usuario apruebe, la herramienta se ejecuta

### ¿Por qué es necesario?

Algunas herramientas son "peligrosas":
- Ejecutar comandos en terminal
- Modificar bases de datos
- Enviar emails
- Hacer pagos

Queremos que el usuario tenga control sobre estas acciones.

---

## Arquitectura General

Levante tiene 3 capas principales que participan en este flujo:

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                          │
│   ChatMessageItem.tsx - Muestra la UI de aprobación              │
│   ChatPage.tsx - Maneja el estado del chat                       │
│   ElectronChatTransport.ts - Convierte chunks para el AI SDK     │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ IPC (Inter-Process Communication)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        BACKEND (Node.js)                         │
│   aiService.ts - Procesa el stream del AI SDK                    │
│   mcpToolsAdapter.ts - Conecta herramientas MCP con AI SDK       │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTP/HTTPS
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     AI SDK + Proveedor de IA                     │
│   Vercel AI SDK - Librería que maneja la comunicación            │
│   OpenRouter/Anthropic - El servicio de IA real                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## El Flujo Paso a Paso

### Paso 1: El Usuario Envía un Mensaje

```
Usuario: "Lista mis proyectos de Supabase"
```

Este mensaje viaja:
1. ChatPage.tsx → ElectronChatTransport.ts → IPC → aiService.ts

### Paso 2: mcpToolsAdapter.ts Configura las Herramientas

En `mcpToolsAdapter.ts` (líneas 226-233), configuramos las herramientas MCP con `needsApproval: true`:

```typescript
// Archivo: src/main/services/ai/mcpToolsAdapter.ts (líneas 226-233)
const aiTool = tool({
  description: mcpTool.description || `Tool from MCP server ${serverId}`,
  inputSchema: inputSchema,

  // ═══════════════════════════════════════════════════════
  // Todas las herramientas MCP requieren aprobación del usuario
  // ═══════════════════════════════════════════════════════
  needsApproval: true,  // ← ESTO ES CLAVE

  execute: async (args: any) => {
    // Código que ejecuta la herramienta
  }
});
```

### Paso 3: El AI SDK Genera Chunks

Cuando el modelo decide usar una herramienta con `needsApproval: true`, el AI SDK genera estos chunks en secuencia:

```
Chunk 1: { type: "tool-call", toolCallId: "abc123", toolName: "supabase_list_projects", input: {} }
Chunk 2: { type: "tool-approval-request", approvalId: "xyz789", toolCall: { toolCallId: "abc123", ... } }
```

**¿Qué significa cada chunk?**

- `tool-call`: "El modelo quiere usar esta herramienta con estos argumentos"
- `tool-approval-request`: "Esta herramienta necesita aprobación antes de ejecutarse"

### Paso 4: aiService.ts Procesa los Chunks

```typescript
// Archivo: src/main/services/aiService.ts

case "tool-call":  // Líneas 1344-1389
  // [FLOW-1]: Recibimos el chunk del AI SDK
  // AI SDK v5 usa 'input', pero también verificamos 'arguments' por compatibilidad
  const toolCallArguments = (chunk as any).input || (chunk as any).arguments || {};

  // [FLOW-2]: Enviamos al frontend
  yield {
    toolCall: {
      id: chunk.toolCallId,
      name: chunk.toolName,
      arguments: toolCallArguments,
    }
  };
  break;

case "tool-approval-request":  // Líneas 1298-1342
  // [FLOW-3]: Recibimos el chunk de aprobación
  // Type the chunk para mejor extracción
  const approvalChunk = chunk as {
    type: string;
    approvalId: string;
    toolCall?: {
      toolCallId: string;
      toolName: string;
      input?: Record<string, unknown>;
    };
  };

  // Garantizar que input NUNCA sea undefined - Anthropic requiere este campo
  const toolInput = approvalChunk.toolCall?.input ?? {};

  // [FLOW-4]: Enviamos al frontend
  yield {
    toolApproval: {
      approvalId: approvalChunk.approvalId,
      toolCallId: approvalChunk.toolCall?.toolCallId ?? '',
      toolName: approvalChunk.toolCall?.toolName ?? '',
      input: toolInput,  // Garantizado objeto, nunca undefined
    },
  };
  break;
```

### Paso 5: ElectronChatTransport.ts Convierte para el AI SDK React

El frontend usa el hook `useChat` del AI SDK, que espera un formato específico de chunks llamados `UIMessageChunk`.

```typescript
// Archivo: src/renderer/transports/ElectronChatTransport.ts (líneas 284-307)

// Cuando recibimos toolApproval del backend:
if (chunk.toolApproval) {
  // Garantizar que input sea siempre un objeto - Anthropic requiere este campo
  const safeInput = chunk.toolApproval.input ?? {};

  // CRÍTICO: NO emitir tool-input-start aquí
  // El part ya fue creado por el chunk toolCall anterior
  // Si emitimos tool-input-start de nuevo, resetea el part a 'input-streaming'
  // y tool-approval-request nunca puede transicionar a 'approval-requested'

  // [FLOW-8]: Emitimos tool-approval-request
  // IMPORTANTE: toolCallId debe estar tanto en el nivel superior como dentro de toolCall
  yield {
    type: "tool-approval-request",
    toolCallId: chunk.toolApproval.toolCallId,
    toolName: chunk.toolApproval.toolName,
    approvalId: chunk.toolApproval.approvalId,
    input: safeInput,
    toolCall: {
      toolCallId: chunk.toolApproval.toolCallId,
      toolName: chunk.toolApproval.toolName,
      input: safeInput,  // ← Input dentro de toolCall para el AI SDK
    },
  } as any;
}
```

### Paso 6: useChat Actualiza el Estado

El hook `useChat` del AI SDK procesa los chunks y actualiza el estado del mensaje:

```typescript
// Internamente en el AI SDK (simplificado):
message.parts = [
  { type: "text", text: "Voy a listar tus proyectos..." },
  {
    type: "tool-supabase_list_projects",  // El tipo incluye el nombre
    toolCallId: "abc123",
    state: "approval-requested",          // ← Estado especial
    input: ???,                            // ← AQUÍ ESTÁ EL PROBLEMA
    approval: { id: "xyz789" }
  }
];
```

### Paso 7: ChatMessageItem.tsx Renderiza la UI

```typescript
// Archivo: src/renderer/components/chat/ChatMessageItem.tsx (líneas 282-318)

// Iteramos sobre las partes del mensaje
{message.parts?.map((part: any, i: number) => {
  // Tool calls (MCP)
  if (part?.type?.startsWith('tool-')) {
    // Log diagnóstico del estado del part
    logger.aiSdk.debug('🔧 Tool part detected', {
      messageId: message.id,
      partType: part.type,
      partState: part.state,  // ← VALOR CLAVE
      hasApproval: !!part.approval,
      approvalId: part.approval?.id,
      toolName: part.toolName,
    });

    // Si está esperando aprobación, mostrar UI de aprobación
    if (part.state === 'approval-requested' && addToolApprovalResponse) {
      const toolName = part.toolName || part.type.replace(/^tool-/, '');
      return (
        <ToolApprovalInline
          key={`${message.id}-${i}`}
          toolName={toolName}
          input={part.input || {}}  // ← Usamos part.input con fallback
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
        />
      );
    }
    // Otros estados: input-streaming, output-available, etc.
    return <ToolCallPart key={...} part={part} ... />;
  }
})}
```

---

## El Problema Original (YA RESUELTO ✅)

> **Nota**: Esta sección documenta los problemas que existían antes de implementar las soluciones. Se mantiene como referencia histórica para entender el contexto de los fixes.

### ¿Qué estaba pasando?

Los logs muestran:

```
[FLOW-8] Transport: Yielding tool-approval-request
  input: {}                    ← Enviamos input correctamente
  inputKeys: Array(0)          ← Está vacío pero es un objeto válido

[FLOW-13] ChatMessageItem: Showing approval UI
  partInput: undefined         ← ¡El input se perdió!
  partInputType: 'undefined'   ← No llegó al componente
```

### ¿Dónde se perdía el input?

El flujo de datos era:
```
Backend (input: {}) → Transport (input: {}) → AI SDK useChat → part.input = undefined
```

El problema estaba entre el Transport y el hook `useChat`. El AI SDK no mapeaba el campo `input` del chunk `tool-approval-request` al `part.input` porque el input estaba en el nivel incorrecto.

### Transiciones de Estado (Problema)

Los logs mostraban las transiciones de estado del part:

```
partState: "input-streaming"      ← Empezó a recibir input
partState: "input-available"      ← Input disponible ✓
partState: "input-streaming"      ← ¡Se reseteaba!
partState: "approval-requested"   ← Estado final
```

El estado pasaba de `input-available` (donde el input está disponible) a `input-streaming` otra vez, lo que reseteaba el input.

### ¿Por qué pasaba esto?

Había **dos chunks separados** llegando del backend:

1. `chunk.toolCall` → Emitía `tool-input-start` + `tool-input-available`
2. `chunk.toolApproval` → Emitía `tool-input-start` + `tool-approval-request`

El segundo `tool-input-start` "reiniciaba" el part y perdía el input que ya se había establecido.

**Solución**: Ver secciones [SOLUCIÓN ENCONTRADA](#solución-encontrada-) y [SEGUNDO BUG ENCONTRADO](#segundo-bug-encontrado-).

---

## Análisis de los Logs

### Diagrama del Flujo con Logs (Estado Actual - Funcionando ✅)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ AI SDK (Vercel)                                                         │
│                                                                         │
│ Genera chunk: tool-call { input: {} }                                   │
│ Genera chunk: tool-approval-request { toolCall: { input: {} } }         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ aiService.ts (Backend) - Líneas 1298-1389                               │
│                                                                         │
│ [FLOW-1] tool-call chunk received                                       │
│   hasInput: true, inputValue: {}    ← ✓ Input existe                    │
│                                                                         │
│ [FLOW-2] Yielding toolCall to frontend                                  │
│   arguments: {}, sourceUsed: "input"  ← ✓ Usamos input                  │
│                                                                         │
│ [FLOW-3] RAW tool-approval-request chunk                                │
│   toolCall.input: {}                  ← ✓ Input en el chunk             │
│                                                                         │
│ [FLOW-4] Yielding toolApproval to frontend                              │
│   input: {}                           ← ✓ Enviamos input                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ElectronChatTransport.ts (Frontend) - Líneas 284-325                    │
│                                                                         │
│ [FLOW-5] toolCall chunk received                                        │
│   → yield tool-input-start           ← Inicia el part                   │
│   → yield tool-input-available       ← Input disponible                 │
│   arguments: {}                       ← ✓ Recibimos                     │
│                                                                         │
│ [FLOW-7] toolApproval chunk received                                    │
│   inputValue: {}                      ← ✓ Recibimos                     │
│   → NO yield tool-input-start        ← CRÍTICO: No resetear             │
│                                                                         │
│ [FLOW-8] Yielding tool-approval-request                                 │
│   input: {} (en nivel superior Y en toolCall)  ← ✓ Enviamos al AI SDK   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ useChat Hook (AI SDK React)                                             │
│                                                                         │
│ Procesa: tool-input-start     → part.state = "input-streaming"          │
│ Procesa: tool-input-available → part.state = "input-available"          │
│                                  part.input = {}  ← ✓ Input establecido │
│                                                                         │
│ Procesa: tool-approval-request → part.state = "approval-requested"      │
│                                  part.approval = { id: "..." }          │
│                                  part.input = {}  ← ✓ INPUT PRESERVADO  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ChatMessageItem.tsx (React Component) - Líneas 282-318                  │
│                                                                         │
│ [FLOW-13] Showing approval UI                                           │
│   partInput: {}                       ← ✓ INPUT DISPONIBLE              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Glosario de Términos

### Chunk
Un "pedazo" de datos que se envía durante el streaming. En lugar de esperar a que toda la respuesta esté lista, el AI SDK envía pequeños chunks conforme se van generando.

### Part
Una "parte" de un mensaje. Un mensaje de IA puede tener múltiples parts:
- Texto
- Herramientas (tool calls)
- Razonamiento
- etc.

### Tool Call
Cuando el modelo de IA decide usar una herramienta. Incluye:
- `toolCallId`: ID único de esta llamada
- `toolName`: Nombre de la herramienta
- `input`: Los argumentos/parámetros para la herramienta

### Tool Approval Request
Un chunk especial que indica que una herramienta necesita aprobación antes de ejecutarse.

### State (de un tool part)
El estado actual de una herramienta:
- `input-streaming`: Recibiendo argumentos
- `input-available`: Argumentos listos
- `approval-requested`: Esperando aprobación del usuario
- `running`: Ejecutándose
- `complete`: Terminada

### UIMessageChunk
El formato de chunk que el hook `useChat` del AI SDK espera recibir. El Transport convierte los chunks de nuestro backend a este formato.

### Transport
Una clase que "transporta" los mensajes entre nuestro backend y el AI SDK. Actúa como un adaptador/traductor.

---

## SOLUCIÓN ENCONTRADA ✅

### El Bug

El problema era el **formato incorrecto** del chunk `tool-approval-request`.

**Formato incorrecto (lo que teníamos):**
```typescript
yield {
  type: "tool-approval-request",
  toolCallId: "...",      // ← En el nivel superior
  toolName: "...",        // ← En el nivel superior
  input: {},              // ← En el nivel superior
  approvalId: "..."
};
```

**Formato correcto (según el AI SDK Stream Protocol):**
```typescript
yield {
  type: "tool-approval-request",
  approvalId: "...",
  toolCall: {
    toolCallId: "...",
    toolName: "...",
    input: {}             // ← DENTRO de toolCall
  }
};
```

### Por qué fallaba

El AI SDK busca el input en `chunk.toolCall.input`, no en `chunk.input`. Como poníamos el input en el nivel superior, el AI SDK no lo encontraba y `part.input` quedaba como `undefined`.

### El Fix

En `ElectronChatTransport.ts` (líneas 284-307), la solución final incluye los campos tanto en el nivel superior como dentro de `toolCall` para máxima compatibilidad:

```typescript
// ANTES (incorrecto - solo nivel superior):
yield {
  type: "tool-approval-request",
  toolCallId: chunk.toolApproval.toolCallId,
  toolName: chunk.toolApproval.toolName,
  input: safeInput,
  approvalId: chunk.toolApproval.approvalId,
} as any;

// DESPUÉS (correcto - ambos niveles):
yield {
  type: "tool-approval-request",
  toolCallId: chunk.toolApproval.toolCallId,     // ← También en nivel superior
  toolName: chunk.toolApproval.toolName,         // ← También en nivel superior
  approvalId: chunk.toolApproval.approvalId,
  input: safeInput,                              // ← También en nivel superior
  toolCall: {
    toolCallId: chunk.toolApproval.toolCallId,
    toolName: chunk.toolApproval.toolName,
    input: safeInput,                            // ← Dentro de toolCall
  },
} as any;
```

**Nota:** El AI SDK busca `chunk.toolCall.input` para establecer `part.input`, pero tener los campos en ambos niveles asegura compatibilidad con diferentes versiones del SDK.

### Verificación

Después del fix, los logs deberían mostrar:
- `[FLOW-8]`: `toolCall: { toolCallId: "...", toolName: "...", input: {} }`
- `[FLOW-13]`: `partInput: {}` (ya no `undefined`)

---

## SEGUNDO BUG ENCONTRADO ✅

### El Problema

El primer fix corrigió el formato, pero el part nunca llegaba a `approval-requested` porque:

1. `chunk.toolCall` → emit `tool-input-start` + `tool-input-available` → state = `input-available` ✅
2. `chunk.toolApproval` → emit `tool-input-start` + `tool-approval-request` → **state se RESETEA a `input-streaming`** ❌

El segundo `tool-input-start` reseteaba el part y se perdía el input.

### El Fix

En `ElectronChatTransport.ts` (líneas 289-291), eliminamos el `tool-input-start` para `toolApproval` ya que el part ya existe:

```typescript
// ANTES (incorrecto):
if (chunk.toolApproval) {
  yield { type: "tool-input-start", ... };  // ← CAUSABA EL RESET
  yield { type: "tool-approval-request", ... };
}

// DESPUÉS (correcto):
if (chunk.toolApproval) {
  // CRÍTICO: NO emitir tool-input-start aquí
  // El part ya fue creado por el chunk toolCall anterior
  // Si emitimos tool-input-start de nuevo, resetea el part a 'input-streaming'
  // y tool-approval-request nunca puede transicionar a 'approval-requested'
  yield { type: "tool-approval-request", ... };
}
```

### Flujo de Estados Correcto

```
toolCall chunk:
  → tool-input-start      → state = "input-streaming"
  → tool-input-available  → state = "input-available", input = {}

toolApproval chunk (sin tool-input-start):
  → tool-approval-request → state = "approval-requested", input se MANTIENE ✅
```

---

## TERCER BUG RESUELTO: Manejo de Tool Denial ✅

### El Problema Original

Cuando el usuario denegaba (deny) una herramienta, ocurrían dos problemas:

1. **Error 500 de OpenRouter/Anthropic**: Anthropic requiere que cada `tool_use` tenga un `tool_result` correspondiente. Cuando se denegaba una herramienta, no se generaba ningún `tool_result`, causando un error de estructura inválida.

2. **Loop infinito**: Después de corregir el primer problema, el sistema entraba en un loop infinito porque `sendAutomaticallyWhen` disparaba nuevas llamadas incluso para denials.

### Estructura Requerida por Anthropic

```
Mensaje 2 (assistant): { tool_use: { id: "toolu_ABC" } }
Mensaje 3 (user): { tool_result: { tool_use_id: "toolu_ABC", content: "..." } }  ← OBLIGATORIO
```

**Regla**: Cada `tool_use` DEBE tener un `tool_result`, incluso si la herramienta fue denegada.

### Solución Implementada

#### Fix 1: Generar `tool_result` para denials (`aiService.ts`)

En `sanitizeMessagesForModel`, detectamos herramientas denegadas y las convertimos a un estado que genere `tool_result`:

```typescript
// src/main/services/aiService.ts (líneas 140-169)
if (part.state === 'approval-responded') {
  const wasDenied = part.approval?.approved === false;

  if (wasDenied) {
    // Convertir a output-available con mensaje de denial
    // Esto genera un tool_result válido para Anthropic
    part = {
      ...part,
      state: 'output-available',
      output: 'Tool execution was denied by the user.',
    };
  }
}
```

#### Fix 2: Detener el loop en denials (`ChatPage.tsx`)

Reemplazamos `lastAssistantMessageIsCompleteWithApprovalResponses` por una función personalizada que solo dispara para aprobaciones:

```typescript
// src/renderer/pages/ChatPage.tsx (líneas 215-251)
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
},
```

### Flujo Completo de Deny

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. Usuario hace click en "Deny"                                          │
│    → addToolApprovalResponse({ approved: false })                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. sendAutomaticallyWhen evalúa                                          │
│    → allApproved = false (hay denial)                                    │
│    → return false → NO se dispara nueva llamada                          │
│    → Loop DETENIDO ✅                                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. Si el usuario continúa la conversación manualmente:                   │
│    → sanitizeMessagesForModel detecta approval-responded + denied        │
│    → Convierte a output-available con mensaje de denial                  │
│    → convertToModelMessages genera tool_result válido                    │
│    → Anthropic recibe estructura correcta ✅                             │
└─────────────────────────────────────────────────────────────────────────┘
```

### Diferencia entre Approve y Deny

| Acción | sendAutomaticallyWhen | Estado resultante | Genera tool_result |
|--------|----------------------|-------------------|-------------------|
| **APPROVE** | `return true` → dispara nueva llamada | Herramienta se ejecuta → `output-available` | Sí (con resultado) |
| **DENY** | `return false` → NO dispara | `approval-responded` → convertido a `output-available` | Sí (con mensaje de denial) |

### Archivos Clave del Flujo de Tool Approval

| Archivo | Líneas | Propósito |
|---------|--------|-----------|
| `src/main/services/ai/mcpToolsAdapter.ts` | 226-233 | Configura herramientas MCP con `needsApproval: true` |
| `src/main/services/aiService.ts` | 1298-1342 | Procesa chunk `tool-approval-request` del AI SDK |
| `src/main/services/aiService.ts` | 1344-1389 | Procesa chunk `tool-call` del AI SDK |
| `src/main/services/aiService.ts` | 140-169 | Convierte denials a `output-available` en `sanitizeMessagesForModel` |
| `src/renderer/transports/ElectronChatTransport.ts` | 284-307 | Convierte chunks para el AI SDK React (sin duplicar `tool-input-start`) |
| `src/renderer/transports/ElectronChatTransport.ts` | 309-325 | Maneja `toolCall` chunks para herramientas sin aprobación |
| `src/renderer/pages/ChatPage.tsx` | 215-251 | `sendAutomaticallyWhen` personalizado que no dispara para denials |
| `src/renderer/components/chat/ChatMessageItem.tsx` | 282-318 | Renderiza UI de aprobación cuando `state === 'approval-requested'` |
| `src/renderer/components/ai-elements/tool-approval.tsx` | 42-130 | Componente `ToolApprovalInline` con botones Approve/Deny |

---

## Resumen de Cambios Implementados

1. **Formato correcto del chunk** (`ElectronChatTransport.ts`): Input en ambos niveles (superior y dentro de `toolCall`)
2. **Sin duplicar tool-input-start** (`ElectronChatTransport.ts`): No emitir para evitar reset de estado
3. **sendAutomaticallyWhen personalizado** (`ChatPage.tsx`): Solo dispara para aprobaciones, no denials
4. **Sanitización de denials** (`aiService.ts`): Convierte a `output-available` para generar `tool_result` válido
