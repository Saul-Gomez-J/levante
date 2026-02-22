# Análisis Detallado: Renderización de Herramientas (Tools) en Levante

## 1. COMPONENTES INVOLUCRADOS EN LA VISUALIZACIÓN DE TOOLS

### Componentes Principales

#### A. `ToolCall.tsx` - Componente de Visualización Principal
- **Ubicación**: `src/renderer/components/ai-elements/tool-call.tsx`
- **Responsabilidades**:
  - Renderiza el título clickeable de la herramienta
  - Muestra el icono y estado de la tool (pending, running, success, error)
  - Abre un Drawer lateral con detalles completos
  - Gestiona la visualización de argumentos, resultados y metadata

**Estructura del componente**:
```typescript
interface ToolCallData {
  id: string;
  name: string;
  arguments: Record<string, any>;
  result?: {
    success: boolean;
    content?: any;
    error?: string;
  };
  status: 'pending' | 'running' | 'success' | 'error';
  serverId?: string;
  timestamp?: number;
}
```

#### B. `Tool.tsx` - Componente Base de Herramientas
- **Ubicación**: `src/renderer/components/ai-elements/tool.tsx`
- **Componentes sub-exportados**:
  - `Tool`: Wrapper Collapsible base
  - `ToolHeader`: Encabezado con icono, nombre y estado badge
  - `ToolContent`: Contenedor con animaciones
  - `ToolInput`: Sección de parámetros (arguments)
  - `ToolOutput`: Sección de resultado con CodeMirror

**Estados visuales**:
```typescript
const statusConfig = {
  'input-streaming': CircleIcon (pendiente),
  'input-available': ClockIcon animate-pulse (ejecutando),
  'output-available': CheckCircleIcon green (completado),
  'output-error': XCircleIcon red (error),
  'approval-requested': ClockIcon yellow (esperando aprobación),
  'approval-responded': CheckCircleIcon blue (aprobado)
}
```

#### C. `ChatMessageItem.tsx` - Contenedor de Mensajes
- **Ubicación**: `src/renderer/components/chat/ChatMessageItem.tsx`
- **Responsabilidades**:
  - Renderiza mensajes completos del chat
  - Detecta y procesa partes de tool calls
  - Renderiza tool calls como componentes ToolCall

#### D. `Message.tsx` y `MessageContent.tsx` - Contenedores Base
- **Ubicación**: `src/renderer/components/ai-elements/message.tsx`
- Proporciona el layout base para mensajes de usuario y asistente

#### E. `Conversation.tsx` - Contenedor del Historial
- **Ubicación**: `src/renderer/components/ai-elements/conversation.tsx`
- Usa `StickToBottom` para scroll automático
- Contenedor para todos los mensajes

#### F. `Response.tsx` - Renderizador de Markdown
- **Ubicación**: `src/renderer/components/ai-elements/response.tsx`
- Renderiza contenido de texto del asistente
- Soporta markdown, code blocks, mermaid, LaTeX

---

## 2. ESTRUCTURA DE MENSAJES CON TOOL CALLS

### Formato UIMessage (AI SDK v5)

Cuando llega una respuesta con tool calls, el mensaje tiene esta estructura:

```typescript
interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: Array<{
    type: 'text' | 'tool-{toolName}' | 'data-reasoning' | 'file' | ...;

    // Para text
    text?: string;

    // Para tool calls
    toolCallId?: string;
    toolName?: string;
    input?: Record<string, any>;
    output?: any;
    state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
    errorText?: string;

    // Para reasoning
    data?: {
      text: string;
      duration?: number;
    };
  }>;
  attachments?: Attachment[];
}
```

### Flujo de Procesamiento en ChatMessageItem

```
ChatMessageItem recibe UIMessage
  ↓
message.parts.map(part => {
  if (part.type === 'text') → Renderiza con <Response>
  if (part.type?.startsWith('tool-')) → Renderiza con <ToolCall>
  if (part.type === 'data-reasoning') → Renderiza con <Reasoning>
  if (part.value?.type === 'ui-resource') → Renderiza con <UIResourceMessage>
})
```

---

## 3. ESTADOS DE LAS HERRAMIENTAS Y SU VISUALIZACIÓN

### Estados del Ciclo de Vida

| Estado | Icono | Color | Animación | Significado |
|--------|-------|-------|-----------|------------|
| **pending** | Clock | muted-foreground | ninguna | Tool call creada, esperando ejecutar |
| **running** | Clock | muted-foreground | animate-pulse | Ejecutando actualmente |
| **success** | CheckCircle2 | muted-foreground | ninguna | Completada con éxito |
| **error** | XCircle | muted-foreground | ninguna | Error durante ejecución |

### Mapeo de Estados AI SDK a ToolCall Status

En `ChatMessageItem.tsx`, `ToolCallPart` convierte los estados:

```typescript
let status: 'pending' | 'running' | 'success' | 'error' = 'pending';
if (part.state === 'input-start') {
  status = 'pending';
} else if (part.state === 'input-available') {
  status = 'running';
} else if (part.state === 'output-available') {
  status = 'success';
} else if (part.state === 'output-error') {
  status = 'error';
}
```

---

## 4. VISUALIZACIÓN INTERACTIVA DEL DRAWER

### Componente Drawer Lateral

Cuando el usuario hace click en el título de la tool, se abre un `Sheet` (Drawer) con:

**A. Encabezado**
```
[Wrench Icon] Tool Name
```

**B. Secciones Internas**

**1. Sección de Argumentos**
```
ARGUMENTOS [Copy Button]
├─ key1
│  └─ [Editor JSON/Text]
├─ key2
│  └─ [Editor JSON/Text]
...
```
- Muestra cada argumento en un campo separado
- Botón Copy para copiar al portapapeles
- Autodetección de JSON con syntax highlighting

**2. Sección de Resultado**
```
RESULTADO [Wrap Button] [Fullscreen Button] [Copy Button]
├─ CodeMirror Editor
   ├─ Syntax highlighting (JSON/Text)
   ├─ Line numbers
   ├─ Fold gutter
   ├─ Bracket matching
   └─ Line wrapping (toggleable)
```

**3. Sección de Metadata**
```
Status: [Icon] [Label]
Server: [ID]
Executed: [Timestamp]
ID: [First 8 chars]
```

### Características del Editor de Resultado

```typescript
const editorConfig = {
  extensions: isJSON
    ? [json(), wrapEnabled ? lineWrapping : null]
    : [wrapEnabled ? lineWrapping : null],
  theme: isDark ? oneDark : 'light',
  editable: false,
  basicSetup: {
    lineNumbers: true,
    highlightActiveLineGutter: false,
    highlightActiveLine: false,
    foldGutter: true,
    bracketMatching: true,
    autocompletion: false,
  },
  height: `${adaptiveHeight}px`, // Math.min(Math.max(lineCount * 20, 300), 600)
};
```

---

## 5. FLUJO DE DATOS: DESDE GENERACIÓN HASTA RENDERIZACIÓN

### Paso 1: Generación en el Backend (AIService)

**Ubicación**: `src/main/services/aiService.ts`

```typescript
// El servicio streamText de AI SDK emite chunks
for await (const chunk of streamText(...)) {
  switch (chunk.type) {
    case 'tool-call':
      yield {
        toolCall: {
          id: chunk.toolCallId,
          name: chunk.toolName,
          arguments: chunk.arguments || {},
          status: "running",
          timestamp: Date.now(),
        },
      };
      break;

    case 'tool-result':
      yield {
        toolResult: {
          id: chunk.toolCallId,
          result: chunk.output || {},
          status: "success",
          timestamp: Date.now(),
        },
      };
      break;

    case 'tool-error':
      yield {
        toolResult: {
          id: chunk.toolCallId,
          result: { error: chunk.error },
          status: "error",
          timestamp: Date.now(),
        },
      };
      break;
  }
}
```

### Paso 2: Transmisión vía IPC (ChatHandlers)

**Ubicación**: `src/main/ipc/chatHandlers.ts`

```typescript
async function handleChatStream(
  event: IpcMainInvokeEvent,
  request: ChatRequest
): Promise<{ streamId: string }> {
  const streamId = `stream_${Date.now()}_${random()}`;

  setImmediate(async () => {
    for await (const chunk of aiService.streamChat(request)) {
      if (isCancelled) break;

      // Envía cada chunk al renderer vía IPC
      event.sender.send(`levante/chat/stream/${streamId}`, chunk);

      if (chunk.done) break;
    }
  });

  return { streamId };
}
```

**Estructura de Chunk enviada**:
```typescript
interface ChatStreamChunk {
  delta?: string;                  // Texto incremental
  done?: boolean;                  // Marca fin de stream
  error?: string;                  // Errores
  toolCall?: {                     // NEW tool call
    id: string;
    name: string;
    arguments: Record<string, any>;
    status: 'running' | 'success' | 'error';
    timestamp: number;
  };
  toolResult?: {                   // Resultado de tool
    id: string;
    result: any;
    status: 'success' | 'error';
    timestamp: number;
  };
  sources?: Array<{ url; title }>;
  reasoningText?: string;
  generatedAttachment?: { type; mime; dataUrl; filename };
}
```

### Paso 3: Conversión de Chunks a UIMessageChunk (Transport)

**Ubicación**: `src/renderer/transports/ElectronChatTransport.ts`

```typescript
private *convertChunkToUIMessageChunks(chunk: ChatStreamChunk): Generator<UIMessageChunk> {
  // Tool calls
  if (chunk.toolCall) {
    yield {
      type: "tool-input-start",
      toolCallId: chunk.toolCall.id,
      toolName: chunk.toolCall.name,
    };

    yield {
      type: "tool-input-available",
      toolCallId: chunk.toolCall.id,
      toolName: chunk.toolCall.name,
      input: chunk.toolCall.arguments,
    };
  }

  // Tool results
  if (chunk.toolResult) {
    const isError = chunk.toolResult.status === "error";

    if (isError) {
      yield {
        type: "tool-output-error",
        toolCallId: chunk.toolResult.id,
        errorText: chunk.toolResult.result.error,
      };
    } else {
      yield {
        type: "tool-output-available",
        toolCallId: chunk.toolResult.id,
        output: chunk.toolResult.result,
      };
    }
  }
}
```

### Paso 4: Conversión a UIMessage (useChat Hook)

El hook `useChat` de AI SDK convierte los chunks en partes de mensaje:

```typescript
message.parts = [
  {
    type: 'tool-get_weather',      // Format: tool-{toolName}
    toolCallId: 'call_123',
    toolName: 'get_weather',
    input: { location: 'Madrid' },
    output: { temp: 25, condition: 'sunny' },
    state: 'output-available',
  }
]
```

### Paso 5: Renderización en React

```
ChatPage.tsx (useChat hook)
  ↓
messages.map(msg => <ChatMessageItem message={msg} />)
  ↓
ChatMessageItem.tsx
  ↓
message.parts.map(part => {
  if (part.type?.startsWith('tool-')) {
    return <ToolCallPart part={part} />
  }
})
  ↓
ToolCallPart.tsx
  ↓
Extrae datos → <ToolCall toolCall={toolCall} />
  ↓
ToolCall.tsx (Drawer + Editor)
```

---

## 6. FLUJO DE PERSISTENCIA EN BASE DE DATOS

**Ubicación**: `src/renderer/stores/chatStore.ts`

Cuando se finaliza el streaming, `ChatPage` persiste el mensaje:

```typescript
onFinish: async ({ message }) => {
  // Extrae tool calls de las partes
  const toolCallParts = message.parts.filter((p) =>
    p.type.startsWith('tool-')
  );

  let toolCallsData = null;
  if (toolCallParts.length > 0) {
    toolCallsData = toolCallParts.map((part: any) => ({
      id: part.toolCallId || `tool-${Date.now()}`,
      name: part.type.replace('tool-', ''),
      arguments: part.input || {},
      result: part.output,
      status: part.state === 'output-available' ? 'success' : part.state,
    }));
  }

  // Persiste a BD
  const input: CreateMessageInput = {
    id: message.id,
    session_id: currentSession.id,
    role: message.role,
    content: content || '',
    tool_calls: toolCallsData,  // ← JSON string
    attachments: attachments,
    reasoningText: reasoningData,
  };

  await window.levante.db.messages.create(input);
}
```

**Estructura almacenada en BD**:
```json
{
  "id": "msg_123",
  "session_id": "sess_456",
  "role": "assistant",
  "content": "Text response...",
  "tool_calls": [
    {
      "id": "call_001",
      "name": "get_weather",
      "arguments": {"location": "Madrid"},
      "result": {"temp": 25},
      "status": "success"
    }
  ]
}
```

---

## 7. CARGA DE MENSAJES HISTÓRICOS

**Ubicación**: `src/renderer/stores/chatStore.ts`

Cuando se carga una sesión anterior:

```typescript
loadHistoricalMessages: async (sessionId: string): Promise<UIMessage[]> => {
  const result = await window.levante.db.messages.list({
    session_id: sessionId,
  });

  const uiMessages: UIMessage[] = result.data.items.map((dbMsg: Message) => {
    const parts: any[] = [];

    // Reconvierte tool calls a partes
    if (dbMsg.tool_calls) {
      const toolCalls = JSON.parse(dbMsg.tool_calls);
      toolCalls.forEach((tc) => {
        parts.push({
          type: `tool-${tc.name}`,
          toolCallId: tc.id,
          toolName: tc.name,
          input: tc.arguments,
          output: tc.result,
          state: 'output-available',  // ← Estado fijo al cargar
        });
      });
    }

    return {
      id: dbMsg.id,
      role: dbMsg.role,
      parts,
    } as UIMessage;
  });

  return uiMessages;
}
```

---

## 8. ESTILOS Y COMPONENTES UI

### Colores y Temas

```typescript
// Colores por estado
const statusConfig = {
  pending: {
    className: 'text-muted-foreground'
  },
  running: {
    className: 'text-muted-foreground animate-pulse'
  },
  success: {
    className: 'text-muted-foreground'
  },
  error: {
    className: 'text-muted-foreground'
  }
};

// Resultados exitosos (verde)
<CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />

// Errores (rojo)
<XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
```

### Componentes Shadcn/UI Utilizados

1. **Sheet**: Drawer lateral
2. **Dialog**: Fullscreen view
3. **Button**: Acciones (Copy, Wrap, Fullscreen)
4. **Badge**: Indicador de estado
5. **Collapsible**: Expandir/Contraer tools

### Editor de Código

- **Librería**: CodeMirror 6 (`@uiw/react-codemirror`)
- **Tema**: One Dark (dark), GitHub Light (light)
- **Plugins**: JSON syntax, line wrapping, folding, bracket matching
- **Readonly**: Sí (no editable)

---

## 9. INTERACTIVIDAD Y EVENTOS

### Eventos en ToolCall Component

```typescript
// Click en título abre drawer
<button onClick={() => setIsDrawerOpen(true)}>
  {toolCall.name}
</button>

// Botones de acción
<Button onClick={copyToClipboard}>Copy Arguments</Button>
<Button onClick={() => setWrapEnabled(!wrapEnabled)}>Wrap</Button>
<Button onClick={() => setFullscreenOpen(true)}>Fullscreen</Button>
```

### Acciones de Usuario

1. **Click en Tool Name**: Abre/cierra drawer
2. **Copy Arguments**: Copia JSON al portapapeles
3. **Copy Result**: Copia resultado al portapapeles
4. **Wrap Toggle**: Activa/desactiva ajuste de líneas
5. **Fullscreen**: Abre diálogo con vista expandida

---

## 10. DETECCIÓN INTELIGENTE DE CONTENIDO

### Auto-detección de JSON

```typescript
let isJSON = false;
if (typeof content === 'object' && content !== null) {
  isJSON = true;
  contentString = JSON.stringify(content, null, 2);
} else if (typeof content === 'string') {
  const trimmed = content.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      isJSON = true;
      contentString = JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      isJSON = false;
      contentString = content;
    }
  }
}
```

### Altura Adaptativa de Editor

```typescript
const lineCount = contentString.split('\n').length;
const adaptiveHeight = Math.min(
  Math.max(lineCount * 20, 300),  // Min 300px, max 600px
  600
);
const fullscreenHeight = Math.min(
  Math.max(lineCount * 20, 600),  // Min 600px, max 2000px
  2000
);
```

---

## 11. MANEJO DE ERRORES Y ESTADOS ESPECIALES

### Estados Especiales de Herramientas

Basado en `src/renderer/components/ai-elements/tool.tsx`:

```typescript
const labels = {
  'input-streaming': 'Pending',
  'input-available': 'Running',
  'output-available': 'Completed',
  'output-error': 'Error',
  'output-denied': 'Denied',           // Nueva: Tool rechazada
  'approval-requested': 'Approval Requested',  // Nueva: Esperando aprobación
  'approval-responded': 'Approved',    // Nueva: Aprobada
};

const icons = {
  'approval-requested': <ClockIcon className="size-4 text-yellow-500" />,
  'approval-responded': <CheckCircleIcon className="size-4 text-blue-500" />,
};
```

### Manejo de Herramientas con Recursos UI

En `ChatMessageItem`, después de renderizar ToolCall:

```typescript
// Extrae UI resources del output de la tool
const uiResources = part.state === 'output-available'
  ? extractUIResources(part.output)
  : [];

// Renderiza widgets
{uiResources.length > 0 && (
  <div className="my-4">
    {uiResources.map((resource, resourceIdx) => (
      <UIResourceMessage key={...} resource={resource} />
    ))}
  </div>
)}
```

---

## 12. FLUJO COMPLETO DE EJEMPLO

### Ejemplo: Llamada a Tool de Clima

**1. Usuario envía mensaje**: "¿Cuál es el clima en Madrid?"

**2. Backend genera chunks**:
```
Chunk 1: { delta: "Let me check..." }
Chunk 2: {
  toolCall: {
    id: "call_001",
    name: "get_weather",
    arguments: { location: "Madrid" },
    status: "running"
  }
}
Chunk 3: { delta: "Looking at" }
Chunk 4: {
  toolResult: {
    id: "call_001",
    result: { temp: 25, condition: "sunny" },
    status: "success"
  }
}
Chunk 5: { delta: "The weather in Madrid is..." }
Chunk 6: { done: true }
```

**3. Transport convierte chunks**:
```
text-start → text-delta → text-end
tool-input-start → tool-input-available
tool-output-available
text-start → text-delta → text-end
```

**4. useChat construye mensaje**:
```typescript
parts: [
  { type: 'text', text: 'Let me check...' },
  {
    type: 'tool-get_weather',
    toolCallId: 'call_001',
    toolName: 'get_weather',
    input: { location: 'Madrid' },
    output: { temp: 25, condition: 'sunny' },
    state: 'output-available'
  },
  { type: 'text', text: 'The weather in Madrid is...' }
]
```

**5. Renderer dibuja**:
```
┌─────────────────────────────────┐
│ Let me check...                 │
├─────────────────────────────────┤
│ [Wrench] get_weather [✓]        │ ← Clickable title
│ Looking at...                   │
│ The weather in Madrid is...     │
└─────────────────────────────────┘

[Click on get_weather] → Opens Drawer with:
┌────────────────────────────────────┐
│ [Wrench] get_weather           [X] │
├────────────────────────────────────┤
│ ARGUMENTOS              [Copy]     │
│ location                           │
│ ┌──────────────────────────────┐  │
│ │ "Madrid"                     │  │
│ └──────────────────────────────┘  │
│                                    │
│ RESULTADO       [W] [[]  [Copy]    │
│ ┌──────────────────────────────┐  │
│ │ {                            │  │
│ │   "temp": 25,               │  │
│ │   "condition": "sunny"      │  │
│ │ }                            │  │
│ └──────────────────────────────┘  │
│                                    │
│ Status: ✓ Completado               │
│ Server: mcp-1                      │
│ Executed: 14:30:45                 │
│ ID: call_0001                      │
└────────────────────────────────────┘
```

---

## 13. PERSISTENCIA VISUAL

Cuando el usuario recarga la página o cierra/abre la aplicación:

1. **Carga histórica**: Los tool calls se cargan como partes con `state: 'output-available'`
2. **Re-renderización**: Se renderizan exactamente como durante streaming
3. **Estado persistente**: El drawer muestra los mismos datos que cuando se ejecutó
4. **Timestamp**: Se conserva para auditoría

---

## RESUMEN DE ARQUITECTURA

```
┌─────────────────────────────────────────────────────────┐
│                    ChatPage.tsx                          │
│  (useChat Hook - AI SDK v5)                             │
└────────────────┬──────────────────────────────────────┘
                 │
         ┌───────┴────────┐
         │                │
    Text Parts        Tool Parts
         │                │
         ▼                ▼
    <Response>       <ToolCallPart>
  (Markdown)         │
                     ▼
              <ToolCall>
              │
         ┌────┴─────┐
         │           │
    Title+Icon    Drawer
    (Clickable)   │
                  ├─ ArgumentsSection
                  ├─ ResultSection
                  │  └─ CodeMirror
                  │  └─ Fullscreen Dialog
                  └─ MetadataSection

Database ← Tool calls guardados como JSON
```

---

## ARCHIVOS CLAVE

| Archivo | Propósito |
|---------|-----------|
| `src/renderer/components/ai-elements/tool-call.tsx` | Componente principal de visualización |
| `src/renderer/components/ai-elements/tool.tsx` | Componentes base reutilizables |
| `src/renderer/components/chat/ChatMessageItem.tsx` | Contenedor de mensajes con tool parts |
| `src/renderer/transports/ElectronChatTransport.ts` | Conversión de chunks a UIMessageChunk |
| `src/main/services/aiService.ts` | Generación de tool calls en backend |
| `src/main/ipc/chatHandlers.ts` | Transmisión IPC de chunks |
| `src/renderer/stores/chatStore.ts` | Persistencia y carga de mensajes |
