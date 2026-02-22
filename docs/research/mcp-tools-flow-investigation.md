# Investigación: Flujo de Tools de MCP en Levante

> **Fecha:** 2026-01-11
> **Objetivo:** Entender el flujo completo de cómo se recogen las tools de los MCPs para poder implementar una feature de selección de tools disponibles en el agente.

---

## Resumen Ejecutivo

El sistema de tools MCP en Levante sigue un flujo **bajo demanda**: las tools NO se almacenan de forma persistente, sino que se obtienen de cada servidor MCP conectado en el momento en que se inicia un chat. El punto crítico del sistema es `mcpToolsAdapter.ts`, que coordina la obtención y conversión de tools al formato del AI SDK.

**Hallazgo clave:** Actualmente solo existe un toggle global `enableMCP` (on/off). No hay mecanismo para seleccionar tools individuales.

---

## 1. Arquitectura de Conexión MCP

### 1.1 Archivos Principales

| Archivo | Propósito |
|---------|-----------|
| `src/main/services/mcp/IMCPService.ts` | Interface base que define el contrato |
| `src/main/services/mcp/mcpUseService.ts` | Implementación principal (mcp-use) |
| `src/main/services/mcp/mcpLegacyService.ts` | Implementación legacy (official SDK) |
| `src/main/ipc/mcpHandlers/connection.ts` | Handlers IPC para conexión |
| `src/main/services/mcpConfigManager.ts` | Gestión de configuración de servidores |

### 1.2 Interface IMCPService

```typescript
// src/main/services/mcp/IMCPService.ts
export interface IMCPService {
  connectServer(config: MCPServerConfig): Promise<MCPConnectionResult>;
  disconnectServer(serverId: string): Promise<void>;
  listTools(serverId: string): Promise<Tool[]>;
  callTool(serverId: string, toolCall: ToolCall): Promise<ToolResult>;
  // ... más métodos
}
```

### 1.3 Flujo de Conexión

```
Renderer (ChatPage.tsx)
  → window.levante.mcp.connectServer(config)
    → IPC: levante/mcp/connect-server
      → mcpService.connectServer(config)
        → MCPUseService.connectServer()
          → Crea MCPClient y session
          → Almacena en Map<serverId, session>
```

---

## 2. Obtención de Tools - El Corazón del Sistema

### 2.1 Punto Crítico: `mcpToolsAdapter.ts`

**Archivo:** `src/main/services/ai/mcpToolsAdapter.ts`

Este es el archivo más importante del sistema. La función `getMCPTools()` coordina todo el proceso:

```typescript
// Línea 29
export async function getMCPTools(): Promise<Record<string, any>>
```

### 2.2 Fases de Ejecución

#### FASE 1: Conexión de Servidores (Líneas 47-79)
```typescript
// Obtiene configuración de servidores
const serversConfig = await mcpConfigManager.listServers();

// Conecta servidores en paralelo
const connectionResults = await Promise.allSettled(
  serversToConnect.map(server => mcpService.connectServer(server))
);
```

#### FASE 2: Obtención de Tools (Líneas 81-100)
```typescript
// Para cada servidor conectado
const tools = await mcpService.listTools(serverId);
```

#### FASE 3: Conversión a AI SDK Format (Líneas 107-172)
```typescript
const aiTool = tool({
  description: mcpTool.description,
  inputSchema: jsonSchema(sanitizedSchema),
  execute: async (args: any) => {
    const result = await mcpService.callTool(serverId, {
      name: mcpTool.name,
      arguments: args,
    });
    return result;
  }
});

// Key format: serverId_toolName
allTools[`${serverId}_${toolName}`] = aiTool;
```

### 2.3 Handler IPC para Listar Tools

```typescript
// src/main/ipc/mcpHandlers/tools.ts (Líneas 6-13)
ipcMain.handle("levante/mcp/list-tools", async (_, serverId: string) => {
  const tools = await mcpService.listTools(serverId);
  return { success: true, data: tools };
});
```

---

## 3. Almacenamiento

### 3.1 Estado Actual: SIN Almacenamiento Persistente de Tools

**Las tools NO se almacenan de forma persistente.** Se obtienen bajo demanda en cada request de chat.

#### Almacenamiento en Runtime (Memory)

```typescript
// MCPUseService - Líneas 37-38
private clients: Map<string, any> = new Map();  // MCPClient instances
private sessions: Map<string, MCPSession> = new Map();
```

#### Configuración Persistente (Solo Servidores)

```
~/.levante/ui-preferences.json
└── mcp.servers: MCPServerConfig[]  // Solo configuración de servidores, NO tools
```

---

## 4. Flujo al Agente/Modelo de IA

### 4.1 AIService.streamChat()

**Archivo:** `src/main/services/aiService.ts` (Líneas 839-1088)

```typescript
// Línea 842: Recibe enableMCP en request
const { messages, model, webSearch, enableMCP = false } = request;

// Líneas 943-1014: Carga tools si enableMCP=true
if (enableMCP) {
  const mcpTools = await getMCPTools();  // ← OBTENCIÓN DE TOOLS
  tools = { ...builtInTools, ...mcpTools };
}

// Línea 1026-1088: Pasa tools al modelo
const result = streamText({
  model: modelProvider,
  messages,
  tools,  // ← TOOLS PASADAS AQUÍ
  system: buildSystemPrompt(...),
  // ...
});
```

### 4.2 Validación de Capacidades

```typescript
// Líneas 884-913: Verifica si el modelo soporta tools
if (enableMCP && !isLocalProvider && !modelInfo.capabilities.supportsTools) {
  request.enableMCP = false;  // Deshabilita si no soporta
}
```

---

## 5. Interfaces y Tipos TypeScript

### 5.1 Tool (MCP)

```typescript
// src/main/types/mcp.ts (Líneas 55-67)
export interface Tool {
  name: string;
  description: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
  _meta?: Record<string, any>;
  annotations?: ToolAnnotations;
}
```

### 5.2 ToolCall

```typescript
// Líneas 69-72
export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}
```

### 5.3 ToolResult

```typescript
// Líneas 74-104
export interface ToolResult {
  content: Array<{
    type: string;
    text?: string;
    data?: any;
    resource?: { uri: string; ... };
  }>;
  isError?: boolean;
  _meta?: { 'mcp-use/widget'?: { ... } };
  structuredContent?: Record<string, any>;
}
```

### 5.4 ChatRequest

```typescript
// src/main/services/aiService.ts (Líneas 34-39)
export interface ChatRequest {
  messages: UIMessage[];
  model: string;
  webSearch: boolean;
  enableMCP?: boolean;  // ← CONTROL PRINCIPAL (solo on/off)
}
```

---

## 6. Gestión en Frontend (Zustand Stores)

### 6.1 MCPStore

**Archivo:** `src/renderer/stores/mcpStore.ts`

El store actual **NO gestiona tools específicas**. Solo gestiona:

```typescript
interface MCPState {
  activeServers: MCPServerConfig[];
  connectionStatus: Record<string, MCPConnectionStatus>;
  // ...
}
```

**NO existe:**
- `availableTools: Record<string, Tool[]>`
- `enabledTools: string[]`
- `selectedTools: Record<string, boolean>`

### 6.2 ToolsMenu Component

**Archivo:** `src/renderer/components/chat/ToolsMenu.tsx` (Líneas 21-47)

```typescript
const tools = [
  {
    id: 'mcp-tools',
    label: t('tools_menu.mcp_tools.label'),
    enabled: enableMCP,
    onChange: onMCPChange,
  }
];
```

**Limitación:** Solo muestra un toggle global on/off. No permite seleccionar tools individuales.

### 6.3 ChatPage Integration

```typescript
// src/renderer/pages/ChatPage.tsx - Línea 47
const [enableMCP, setEnableMCP] = usePreference('enableMCP');
```

---

## 7. Diagrama de Flujo Completo

```
┌─────────────────────────────────────────────────────────────┐
│              FLUJO COMPLETO DE TOOLS DE MCP                 │
└─────────────────────────────────────────────────────────────┘

RENDERER (Frontend)
  │
  ├─ ChatPage.tsx
  │  ├─ usePreference('enableMCP') → [enableMCP, setEnableMCP]
  │  ├─ ToolsMenu: enableMCP toggle (solo on/off global)
  │  └─ ChatPromptInput: Pasa enableMCP al chat
  │
  └─ ElectronChatTransport
     └─ sendMessages(): Crea ChatRequest { enableMCP, model, messages }
        └─ IPC: levante/chat/stream → MAIN PROCESS

MAIN PROCESS
  │
  ├─ chatHandlers.ts: levante/chat/stream
  │  └─ aiService.streamChat(request)
  │
  └─ AIService.streamChat()
     │
     ├─ Verifica: enableMCP && modelSupportsTools
     │
     └─ SI enableMCP=true:
        │
        └─ getMCPTools() ← PUNTO CRÍTICO
           │
           ├─ FASE 1: Conecta servidores en paralelo
           │  └─ mcpService.connectServer() para cada servidor
           │
           ├─ FASE 2: Obtiene tools de cada servidor
           │  └─ mcpService.listTools(serverId)
           │     └─ MCPUseService.listTools()
           │        └─ client.createSession().listTools()
           │
           └─ FASE 3: Convierte tools a AI SDK format
              ├─ Para cada tool MCP:
              │  ├─ sanitizeSchema(inputSchema)
              │  ├─ Crea: tool({
              │  │    description,
              │  │    inputSchema: jsonSchema(sanitizedSchema),
              │  │    execute: async (args) => {
              │  │      mcpService.callTool(serverId, toolCall)
              │  │    }
              │  │  })
              │  └─ Key: `${serverId}_${toolName}`
              │
              └─ Retorna: Record<string, AISDKTool>
                 │
                 └─ streamText({ tools, messages, model, ... })

EJECUCIÓN DE TOOL
  │
  ├─ Modelo genera tool_call: { toolName, arguments }
  │
  ├─ AI SDK ejecuta: tools[toolName].execute(arguments)
  │  └─ mcpService.callTool(serverId, { name, arguments })
  │
  └─ MCPUseService.callTool()
     └─ client.tool(toolName, arguments)
        └─ MCP Server responde con ToolResult
```

---

## 8. Localización de Archivos Clave

| Función | Archivo | Línea |
|---------|---------|-------|
| Interface MCP | `src/main/services/mcp/IMCPService.ts` | 45, 54 |
| Implementación (mcp-use) | `src/main/services/mcp/mcpUseService.ts` | 85, 178 |
| Handler: list-tools | `src/main/ipc/mcpHandlers/tools.ts` | 6-13 |
| **getMCPTools (CRÍTICO)** | **`src/main/services/ai/mcpToolsAdapter.ts`** | **29-173** |
| Conversión a AI SDK | `src/main/services/ai/mcpToolsAdapter.ts` | 178-250 |
| StreamChat (uso de tools) | `src/main/services/aiService.ts` | 839, 943-1014 |
| Chat IPC handler | `src/main/ipc/chatHandlers.ts` | 42-45 |
| Transport (enableMCP) | `src/renderer/transports/ElectronChatTransport.ts` | 57-58, 111 |
| ToolsMenu UI | `src/renderer/components/chat/ToolsMenu.tsx` | 21-47 |
| MCPStore | `src/renderer/stores/mcpStore.ts` | completo |
| ChatPage (enableMCP hook) | `src/renderer/pages/ChatPage.tsx` | 47 |
| Preload API | `src/preload/api/mcp.ts` | 17-18 |

---

## 9. Propuesta de Implementación: Selección de Tools

### 9.1 Cambios Necesarios

#### A. Estado en Frontend (mcpStore.ts)

```typescript
interface MCPState {
  // ... existente ...

  // NUEVO: Tools por servidor
  availableTools: Record<string, Tool[]>;  // serverId → Tool[]

  // NUEVO: Tools seleccionadas (habilitadas)
  selectedTools: Record<string, string[]>; // serverId → toolNames[]

  // NUEVO: Acciones
  setAvailableTools: (serverId: string, tools: Tool[]) => void;
  toggleTool: (serverId: string, toolName: string) => void;
  setSelectedTools: (serverId: string, toolNames: string[]) => void;
}
```

#### B. Persistencia en Preferencias

```typescript
// ui-preferences.json
{
  "mcp": {
    "servers": [...],
    "selectedTools": {
      "filesystem": ["read_file", "write_file"],
      "github": ["create_issue", "list_repos"]
    }
  }
}
```

#### C. Modificar getMCPTools()

```typescript
// src/main/services/ai/mcpToolsAdapter.ts
export async function getMCPTools(
  selectedTools?: Record<string, string[]>  // NUEVO PARÁMETRO
): Promise<Record<string, any>> {
  // ... fases existentes ...

  // FASE 3 modificada: Filtrar tools
  for (const mcpTool of tools) {
    // NUEVO: Verificar si la tool está seleccionada
    if (selectedTools && selectedTools[serverId]) {
      if (!selectedTools[serverId].includes(mcpTool.name)) {
        continue;  // Saltar tool no seleccionada
      }
    }

    // ... conversión existente ...
  }
}
```

#### D. Modificar ChatRequest

```typescript
export interface ChatRequest {
  messages: UIMessage[];
  model: string;
  webSearch: boolean;
  enableMCP?: boolean;
  selectedTools?: Record<string, string[]>;  // NUEVO
}
```

#### E. Componente UI (ToolsMenu o nuevo componente)

```typescript
// Mostrar lista de tools por servidor con checkboxes
function ToolSelector({ serverId, tools, selectedTools, onToggle }) {
  return (
    <div>
      {tools.map(tool => (
        <Checkbox
          key={tool.name}
          checked={selectedTools.includes(tool.name)}
          onChange={() => onToggle(tool.name)}
          label={tool.name}
          description={tool.description}
        />
      ))}
    </div>
  );
}
```

### 9.2 Flujo Propuesto

```
1. Usuario abre Settings/ToolsMenu
2. Sistema llama listTools() para cada servidor conectado
3. Muestra lista de tools con checkboxes
4. Usuario selecciona/deselecciona tools
5. Selección se persiste en preferencias
6. Al enviar mensaje:
   a. ChatRequest incluye selectedTools
   b. getMCPTools() filtra según selección
   c. Solo tools seleccionadas van al modelo
```

---

## 10. Conclusiones

### Estado Actual
- Solo existe toggle global `enableMCP` (on/off)
- Tools se obtienen bajo demanda, no se cachean
- No hay mecanismo de selección individual

### Puntos de Modificación
1. **mcpToolsAdapter.ts**: Añadir filtrado por selección
2. **mcpStore.ts**: Añadir estado de tools disponibles y seleccionadas
3. **Preferencias**: Persistir selección de tools
4. **UI**: Nuevo componente o expandir ToolsMenu
5. **ChatRequest/Transport**: Pasar selección al backend

### Complejidad Estimada
- **Baja-Media**: Los puntos de modificación están bien identificados
- **Riesgo bajo**: No afecta la arquitectura existente, solo extiende
