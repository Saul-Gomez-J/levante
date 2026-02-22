# Plan de Implementación: Aprobación de Tools Configurable por Proveedor

## Resumen del Problema

El sistema actual de aprobación de herramientas MCP (`needsApproval: true`) está hardcoded para todos los proveedores. Esto causa errores con algunos proveedores que no soportan correctamente el flujo de aprobación del AI SDK.

**Objetivo:** Permitir configurar qué proveedores soportan el flujo de aprobación, y deshabilitarlo automáticamente para los que no lo soporten.

**Alcance:** Este plan aplica al flujo de chat por streaming (`streamChat`). La ruta no streaming (`sendSingleMessage`) queda fuera de alcance por decisión de producto actual.

---

## Análisis de la Arquitectura Actual

### Punto Clave: Dónde se Configura `needsApproval`

**Archivo:** `src/main/services/ai/mcpToolsAdapter.ts` (línea 233)

```typescript
const aiTool = tool({
  description: mcpTool.description || `Tool from MCP server ${serverId}`,
  inputSchema: inputSchema,
  needsApproval: true,  // ← HARDCODED para TODAS las herramientas
  execute: async (args: any) => { /* ... */ }
});
```

### Flujo Actual

```
aiService.streamChat()
       │
       ├─► providerType = await this.getProviderType(model)  // ✓ Ya disponible
       │
       └─► mcpTools = await getMCPTools()  // ← No recibe contexto del proveedor
                    │
                    └─► createAISDKTool(serverId, mcpTool)
                                │
                                └─► needsApproval: true  // ← SIEMPRE true
```

### Problema Identificado

1. `getMCPTools()` se llama sin parámetros
2. No hay forma de pasar el contexto del proveedor
3. `createAISDKTool()` no puede decidir si usar approval o no

---

## Plan de Implementación

### Paso 1: Extender la Configuración de Preferencias

**Archivo a modificar:** `src/types/preferences.ts`

**Cambio:** Agregar configuración para proveedores que NO soportan approval.

```typescript
// ANTES (líneas 50-58)
ai: {
  baseSteps: number;
  maxSteps: number;
  mermaidValidation: boolean;
  mcpDiscovery: boolean;
  reasoningText?: ReasoningConfig;
};

// DESPUÉS
ai: {
  baseSteps: number;
  maxSteps: number;
  mermaidValidation: boolean;
  mcpDiscovery: boolean;
  reasoningText?: ReasoningConfig;
  /**
   * Lista de tipos de proveedor que NO soportan el flujo de aprobación de tools.
   * Para estos proveedores, needsApproval será false y las herramientas se ejecutarán
   * automáticamente sin solicitar aprobación del usuario.
   */
  providersWithoutToolApproval?: ProviderType[];
};
```

**Código completo del cambio:**

```typescript
// En src/types/preferences.ts
import type { ProviderConfig, ProviderType } from "./models";

export interface UIPreferences {
  theme: "light" | "dark" | "system";
  language: string;
  timezone: string;
  windowBounds: {
    width: number;
    height: number;
    x?: number;
    y?: number;
  };
  sidebarCollapsed: boolean;
  lastUsedModel: string;
  chatInputHeight: number;
  fontSize: "small" | "medium" | "large";
  codeTheme: "light" | "dark" | "auto";
  showLineNumbers: boolean;
  wordWrap: boolean;
  autoSave: boolean;
  notifications: {
    showDesktop: boolean;
    showInApp: boolean;
    soundEnabled: boolean;
  };
  shortcuts: {
    newChat: string;
    toggleSidebar: string;
    search: string;
  };
  providers: ProviderConfig[];
  activeProvider: string | null;
  ai: {
    baseSteps: number;
    maxSteps: number;
    mermaidValidation: boolean;
    mcpDiscovery: boolean;
    reasoningText?: ReasoningConfig;
    /**
     * Lista de tipos de proveedor que NO soportan el flujo de aprobación de tools.
     * Para estos proveedores, needsApproval será false y las herramientas se ejecutarán
     * automáticamente sin solicitar aprobación del usuario.
     */
    providersWithoutToolApproval?: ProviderType[];
  };
  hasAcceptedFreeModelWarning?: boolean;
  developerMode: boolean;
  security: {
    encryptApiKeys: boolean;
  };
  runtime: {
    preferSystemRuntimes: boolean;
  };
  mcp?: MCPPreferences;
  enableMCP: boolean;
}

// Actualizar DEFAULT_PREFERENCES (líneas 93-138)
export const DEFAULT_PREFERENCES: UIPreferences = {
  // ... resto sin cambios ...
  ai: {
    baseSteps: 5,
    maxSteps: 20,
    mermaidValidation: true,
    mcpDiscovery: true,
    reasoningText: DEFAULT_REASONING_CONFIG,
    providersWithoutToolApproval: [],
  },
  // ... resto sin cambios ...
};
```

---

### Paso 1.1: Actualizar el Schema de `preferencesService`

**Archivo a modificar:** `src/main/services/preferencesService.ts`

**Cambio:** Agregar `providersWithoutToolApproval` al schema de `ai` con validación explícita por enum de proveedores.

```typescript
// Dentro de schema.ai.properties
ai: {
  type: 'object',
  properties: {
    baseSteps: { type: 'number', minimum: 1, default: 5 },
    maxSteps: { type: 'number', minimum: 1, default: 20 },
    mermaidValidation: { type: 'boolean', default: true },
    mcpDiscovery: { type: 'boolean', default: true },
    providersWithoutToolApproval: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          'openrouter',
          'vercel-gateway',
          'local',
          'openai',
          'anthropic',
          'google',
          'groq',
          'xai',
          'huggingface',
        ],
      },
      default: [],
    },
  },
  required: ['baseSteps', 'maxSteps', 'mermaidValidation', 'mcpDiscovery'],
  default: {
    baseSteps: 5,
    maxSteps: 20,
    mermaidValidation: true,
    mcpDiscovery: true,
    providersWithoutToolApproval: [],
  },
}
```

---

### Paso 2: Modificar `getMCPTools()` para Aceptar Opciones

**Archivo a modificar:** `src/main/services/ai/mcpToolsAdapter.ts`

**Cambio:** La función `getMCPTools()` debe aceptar un parámetro opcional para controlar `needsApproval`.

```typescript
// ANTES (línea 29)
export async function getMCPTools(): Promise<Record<string, any>> {

// DESPUÉS
export interface GetMCPToolsOptions {
  /**
   * Si true, las herramientas NO requerirán aprobación del usuario.
   * Útil para proveedores que no soportan el flujo de aprobación del AI SDK.
   */
  skipApproval?: boolean;
}

export async function getMCPTools(options: GetMCPToolsOptions = {}): Promise<Record<string, any>> {
```

**Código completo del cambio en `getMCPTools`:**

```typescript
// src/main/services/ai/mcpToolsAdapter.ts

/**
 * Options for getMCPTools
 */
export interface GetMCPToolsOptions {
  /**
   * Si true, las herramientas NO requerirán aprobación del usuario.
   * Útil para proveedores que no soportan el flujo de aprobación del AI SDK.
   * Default: false (las herramientas requieren aprobación)
   */
  skipApproval?: boolean;
}

/**
 * Get all MCP tools from connected servers and convert them to AI SDK format
 * Optimized: Connects to servers in parallel for faster initialization
 *
 * @param options - Configuration options
 * @param options.skipApproval - If true, tools won't require user approval
 */
export async function getMCPTools(options: GetMCPToolsOptions = {}): Promise<Record<string, any>> {
  const { skipApproval = false } = options;
  const startTime = Date.now();

  try {
    const config = await configManager.loadConfiguration();
    const allTools: Record<string, any> = {};
    const serverEntries = Object.entries(config.mcpServers);

    if (serverEntries.length === 0) {
      logger.aiSdk.debug("No active MCP servers configured");
      return allTools;
    }

    logger.aiSdk.info("Loading MCP tools (parallel)", {
      serverCount: serverEntries.length,
      serverIds: serverEntries.map(([id]) => id),
      skipApproval,  // ← Log del nuevo parámetro
    });

    // PHASE 1: Connect all servers in parallel
    // ... (sin cambios) ...

    // PHASE 2: Get tools from all connected servers in parallel
    // ... (sin cambios) ...

    // PHASE 3: Convert tools to AI SDK format
    for (const result of toolsResults) {
      if (result.status !== "fulfilled" || !result.value.success) continue;

      const { serverId, tools: serverTools } = result.value;

      for (const mcpTool of serverTools) {
        if (!mcpTool.name || mcpTool.name.trim() === "") {
          logger.aiSdk.error("Invalid tool name from server", {
            serverId,
            tool: mcpTool,
          });
          continue;
        }

        const toolId = `${serverId}_${mcpTool.name}`;

        if (
          !toolId ||
          toolId.includes("undefined") ||
          toolId.includes("null")
        ) {
          logger.aiSdk.error("Invalid toolId detected", {
            toolId,
            tool: mcpTool,
          });
          continue;
        }

        // ═══════════════════════════════════════════════════════
        // CAMBIO: Pasar skipApproval a createAISDKTool
        // ═══════════════════════════════════════════════════════
        const aiTool = createAISDKTool(serverId, mcpTool, { skipApproval });
        if (!aiTool) {
          logger.aiSdk.error("Failed to create AI SDK tool", { toolId });
          continue;
        }

        allTools[toolId] = aiTool;
      }

      if (serverTools.length > 0) {
        logger.aiSdk.info("Loaded tools from MCP server", {
          toolCount: serverTools.length,
          serverId,
          skipApproval,  // ← Log informativo
        });
      }
    }

    // Log summary
    const disabledCount = Object.keys(config.disabled || {}).length;
    const totalDuration = Date.now() - startTime;

    logger.aiSdk.info("MCP tools loading complete", {
      totalCount: Object.keys(allTools).length,
      activeServers: serverEntries.length,
      disabledServers: disabledCount,
      durationMs: totalDuration,
      toolNames: Object.keys(allTools),
      needsApproval: !skipApproval,  // ← Log del estado final
    });

    return allTools;
  } catch (error) {
    logger.aiSdk.error("Error loading MCP tools", {
      error: error instanceof Error ? error.message : error,
      durationMs: Date.now() - startTime,
    });
    return {};
  }
}
```

---

### Paso 3: Modificar `createAISDKTool()` para Usar la Opción

**Archivo a modificar:** `src/main/services/ai/mcpToolsAdapter.ts`

**Cambio:** La función `createAISDKTool()` debe aceptar opciones y usar `skipApproval`.

```typescript
// ANTES (línea 178)
function createAISDKTool(serverId: string, mcpTool: Tool) {

// DESPUÉS
interface CreateAISDKToolOptions {
  skipApproval?: boolean;
}

function createAISDKTool(
  serverId: string,
  mcpTool: Tool,
  options: CreateAISDKToolOptions = {}
) {
```

**Código completo del cambio en `createAISDKTool`:**

```typescript
// src/main/services/ai/mcpToolsAdapter.ts

/**
 * Options for createAISDKTool
 */
interface CreateAISDKToolOptions {
  /**
   * Si true, la herramienta NO requerirá aprobación del usuario.
   */
  skipApproval?: boolean;
}

/**
 * Convert an MCP tool to AI SDK format
 *
 * @param serverId - MCP server ID
 * @param mcpTool - MCP tool definition
 * @param options - Tool creation options
 */
function createAISDKTool(
  serverId: string,
  mcpTool: Tool,
  options: CreateAISDKToolOptions = {}
) {
  const { skipApproval = false } = options;

  logger.aiSdk.debug("Creating AI SDK tool", {
    serverId,
    toolName: mcpTool.name,
    needsApproval: !skipApproval,  // ← Log del estado
  });

  // Validate tool name
  if (!mcpTool.name || mcpTool.name.trim() === "") {
    throw new Error(
      `Invalid tool name for server ${serverId}: ${JSON.stringify(mcpTool)}`
    );
  }

  // Sanitize MCP JSON Schema for provider compatibility
  let inputSchema: ReturnType<typeof jsonSchema>;

  try {
    if (mcpTool.inputSchema) {
      const sanitizedSchema = sanitizeSchema(
        mcpTool.inputSchema,
        undefined,
        mcpTool.name
      );

      logger.aiSdk.debug("Sanitized MCP schema", {
        toolName: mcpTool.name,
        serverId,
        originalType: mcpTool.inputSchema.type,
        sanitizedType: sanitizedSchema.type,
        hasProperties: !!sanitizedSchema.properties,
      });

      inputSchema = jsonSchema(sanitizedSchema);
    } else {
      inputSchema = jsonSchema({ type: "object", properties: {} });
    }
  } catch (error) {
    logger.aiSdk.warn("Failed to sanitize schema for tool, using fallback", {
      toolName: mcpTool.name,
      error,
    });
    inputSchema = jsonSchema({ type: "object", properties: {} });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMBIO PRINCIPAL: needsApproval es configurable basado en skipApproval
  // ═══════════════════════════════════════════════════════════════════════════
  const needsApproval = !skipApproval;

  const aiTool = tool({
    description: mcpTool.description || `Tool from MCP server ${serverId}`,
    inputSchema: inputSchema,

    // ═══════════════════════════════════════════════════════
    // Aprobación de herramientas: configurable por proveedor
    // Si skipApproval=true, needsApproval=false (sin aprobación)
    // Si skipApproval=false, needsApproval=true (requiere aprobación)
    // ═══════════════════════════════════════════════════════
    needsApproval: needsApproval,

    execute: async (args: any) => {
      // ... resto del execute sin cambios ...
    },
  });

  // LOG DIAGNÓSTICO: Confirmar configuración de aprobación
  logger.aiSdk.info("🔧 Created AI SDK tool", {
    serverId,
    toolName: mcpTool.name,
    needsApproval: needsApproval,
    skipApproval: skipApproval,
    toolKeys: Object.keys(aiTool),
  });

  return aiTool;
}
```

---

### Paso 4: Modificar `aiService.streamChat()` para Pasar la Configuración

**Archivo a modificar:** `src/main/services/aiService.ts`

**Ubicación:** Líneas 1003-1014 (donde se llama a `getMCPTools()`)

**Cambio:** Verificar si el proveedor actual está en la lista de proveedores sin approval.

```typescript
// ANTES (líneas 1003-1014)
// Get MCP tools if enabled
let tools = {};

// Get built-in tools (always available, independent of MCP)
const { getBuiltInTools } = await import('./ai/builtInTools');
const builtInToolsConfig = await this.getBuiltInToolsConfig();
const builtInTools = await getBuiltInTools(builtInToolsConfig);

if (enableMCP) {
  const mcpTools = await getMCPTools();
  tools = { ...builtInTools, ...mcpTools };
  // ...
}

// DESPUÉS
// Get MCP tools if enabled
let tools = {};

// Get built-in tools (always available, independent of MCP)
const { getBuiltInTools } = await import('./ai/builtInTools');
const builtInToolsConfig = await this.getBuiltInToolsConfig();
const builtInTools = await getBuiltInTools(builtInToolsConfig);

if (enableMCP) {
  // ═══════════════════════════════════════════════════════════════════════════
  // CAMBIO: Verificar si el proveedor soporta aprobación de tools
  // ═══════════════════════════════════════════════════════════════════════════
  const shouldSkipApproval = await this.shouldSkipToolApproval(providerType);

  if (shouldSkipApproval) {
    this.logger.aiSdk.info("Skipping tool approval for provider", {
      providerType,
      reason: "Provider configured in providersWithoutToolApproval",
    });
  }

  const mcpTools = await getMCPTools({ skipApproval: shouldSkipApproval });
  tools = { ...builtInTools, ...mcpTools };
  // ...
}
```

**Nuevo método a agregar en la clase `AIService`:**

```typescript
// Agregar después de getProviderType() (alrededor de línea 892)

/**
 * Verifica si se debe saltar la aprobación de tools para el proveedor dado
 *
 * @param providerType - Tipo de proveedor (openrouter, anthropic, etc.)
 * @returns true si el proveedor está configurado para NO usar aprobación
 */
private async shouldSkipToolApproval(providerType: ProviderType | undefined): Promise<boolean> {
  if (!providerType) {
    // Si no hay proveedor, usar comportamiento por defecto (con aprobación)
    return false;
  }

  try {
    const aiPrefs = preferencesService.get("ai") as UIPreferences["ai"] | undefined;
    const rawProviders = aiPrefs?.providersWithoutToolApproval ?? [];
    const validProviders = rawProviders.filter(this.isProviderType);

    if (validProviders.length !== rawProviders.length) {
      this.logger.aiSdk.warn("Invalid provider types in providersWithoutToolApproval", {
        rawProviders,
        validProviders,
      });
    }

    const shouldSkip = validProviders.includes(providerType);

    this.logger.aiSdk.debug("Tool approval check", {
      providerType,
      providersWithoutApproval: validProviders,
      shouldSkip,
    });

    return shouldSkip;
  } catch (error) {
    this.logger.aiSdk.warn("Error checking tool approval config, using default", {
      error: error instanceof Error ? error.message : error,
    });
    return false;
  }
}

private isProviderType(value: unknown): value is ProviderType {
  return [
    "openrouter",
    "vercel-gateway",
    "local",
    "openai",
    "anthropic",
    "google",
    "groq",
    "xai",
    "huggingface",
  ].includes(value as ProviderType);
}
```

---

### Paso 5: Código Completo de Cambios

#### 5.1 `src/types/preferences.ts`

**Diff de cambios:**

```diff
 import type { ProviderConfig, ProviderType } from "./models";
  ai: {
    baseSteps: number;
    maxSteps: number;
    mermaidValidation: boolean;
    mcpDiscovery: boolean;
    reasoningText?: ReasoningConfig;
+   /**
+    * Lista de tipos de proveedor que NO soportan el flujo de aprobación de tools.
+    * Para estos proveedores, needsApproval será false y las herramientas se ejecutarán
+    * automáticamente sin solicitar aprobación del usuario.
+    */
+   providersWithoutToolApproval?: ProviderType[];
  };
```

**En DEFAULT_PREFERENCES:**

```diff
  ai: {
    baseSteps: 5,
    maxSteps: 20,
    mermaidValidation: true,
    mcpDiscovery: true,
    reasoningText: DEFAULT_REASONING_CONFIG,
+   providersWithoutToolApproval: [],
  },
```

---

#### 5.2 `src/main/services/preferencesService.ts`

**Actualizar schema de `ai`:**

```diff
 ai: {
   type: 'object',
   properties: {
     baseSteps: { type: 'number', minimum: 1, default: 5 },
     maxSteps: { type: 'number', minimum: 1, default: 20 },
     mermaidValidation: { type: 'boolean', default: true },
+    mcpDiscovery: { type: 'boolean', default: true },
+    providersWithoutToolApproval: {
+      type: 'array',
+      items: {
+        type: 'string',
+        enum: ['openrouter', 'vercel-gateway', 'local', 'openai', 'anthropic', 'google', 'groq', 'xai', 'huggingface'],
+      },
+      default: [],
+    },
   },
-  required: ['baseSteps', 'maxSteps', 'mermaidValidation'],
-  default: { baseSteps: 5, maxSteps: 20, mermaidValidation: true }
+  required: ['baseSteps', 'maxSteps', 'mermaidValidation', 'mcpDiscovery'],
+  default: {
+    baseSteps: 5,
+    maxSteps: 20,
+    mermaidValidation: true,
+    mcpDiscovery: true,
+    providersWithoutToolApproval: [],
+  }
 }
```

---

#### 5.3 `src/main/services/ai/mcpToolsAdapter.ts`

**Agregar interfaz y modificar firma de `getMCPTools`:**

```typescript
// Agregar después de los imports (alrededor de línea 23)

/**
 * Options for getMCPTools
 */
export interface GetMCPToolsOptions {
  /**
   * Si true, las herramientas NO requerirán aprobación del usuario.
   * Útil para proveedores que no soportan el flujo de aprobación del AI SDK.
   * Default: false (las herramientas requieren aprobación)
   */
  skipApproval?: boolean;
}

/**
 * Options for createAISDKTool (internal)
 */
interface CreateAISDKToolOptions {
  /**
   * Si true, la herramienta NO requerirá aprobación del usuario.
   */
  skipApproval?: boolean;
}
```

**Modificar `getMCPTools`:**

```typescript
// Cambiar línea 29
export async function getMCPTools(options: GetMCPToolsOptions = {}): Promise<Record<string, any>> {
  const { skipApproval = false } = options;
  const startTime = Date.now();
```

**Modificar la llamada a `createAISDKTool` dentro de `getMCPTools` (línea 136):**

```typescript
// Cambiar línea 136
const aiTool = createAISDKTool(serverId, mcpTool, { skipApproval });
```

**Agregar logs informativos en `getMCPTools`:**

```typescript
// En línea 42-45, agregar skipApproval al log
logger.aiSdk.info("Loading MCP tools (parallel)", {
  serverCount: serverEntries.length,
  serverIds: serverEntries.map(([id]) => id),
  skipApproval,
});

// En línea 157-163, agregar needsApproval al log
logger.aiSdk.info("MCP tools loading complete", {
  totalCount: Object.keys(allTools).length,
  activeServers: serverEntries.length,
  disabledServers: disabledCount,
  durationMs: totalDuration,
  toolNames: Object.keys(allTools),
  needsApproval: !skipApproval,
});
```

**Modificar `createAISDKTool`:**

```typescript
// Cambiar línea 178
function createAISDKTool(
  serverId: string,
  mcpTool: Tool,
  options: CreateAISDKToolOptions = {}
) {
  const { skipApproval = false } = options;

  logger.aiSdk.debug("Creating AI SDK tool", {
    serverId,
    toolName: mcpTool.name,
    needsApproval: !skipApproval,
  });
```

**Cambiar `needsApproval` hardcoded a dinámico (línea 233):**

```typescript
// Cambiar línea 233
needsApproval: !skipApproval,
```

**Actualizar log de confirmación (línea 398-403):**

```typescript
logger.aiSdk.info("🔧 Created AI SDK tool", {
  serverId,
  toolName: mcpTool.name,
  needsApproval: !skipApproval,
  skipApproval: skipApproval,
  toolKeys: Object.keys(aiTool),
});
```

---

#### 5.4 `src/main/services/aiService.ts`

**Agregar nuevo método después de `getProviderType()` (después de línea 892):**

```typescript
/**
 * Verifica si se debe saltar la aprobación de tools para el proveedor dado
 *
 * @param providerType - Tipo de proveedor (openrouter, anthropic, etc.)
 * @returns true si el proveedor está configurado para NO usar aprobación
 */
private async shouldSkipToolApproval(providerType: ProviderType | undefined): Promise<boolean> {
  if (!providerType) {
    return false;
  }

  try {
    const aiPrefs = preferencesService.get("ai") as UIPreferences["ai"] | undefined;
    const rawProviders = aiPrefs?.providersWithoutToolApproval ?? [];
    const providersWithoutApproval = rawProviders.filter(this.isProviderType);

    const shouldSkip = providersWithoutApproval.includes(providerType);

    this.logger.aiSdk.debug("Tool approval check", {
      providerType,
      providersWithoutApproval,
      shouldSkip,
    });

    return shouldSkip;
  } catch (error) {
    this.logger.aiSdk.warn("Error checking tool approval config, using default", {
      error: error instanceof Error ? error.message : error,
    });
    return false;
  }
}

private isProviderType(value: unknown): value is ProviderType {
  return [
    "openrouter",
    "vercel-gateway",
    "local",
    "openai",
    "anthropic",
    "google",
    "groq",
    "xai",
    "huggingface",
  ].includes(value as ProviderType);
}
```

**Modificar bloque de MCP tools (líneas 1012-1018):**

```typescript
if (enableMCP) {
  // Verificar si el proveedor soporta aprobación de tools
  const shouldSkipApproval = await this.shouldSkipToolApproval(providerType);

  if (shouldSkipApproval) {
    this.logger.aiSdk.info("Skipping tool approval for provider", {
      providerType,
      reason: "Provider configured in providersWithoutToolApproval",
    });
  }

  const mcpTools = await getMCPTools({ skipApproval: shouldSkipApproval });
  tools = { ...builtInTools, ...mcpTools };

  this.logger.aiSdk.debug("Passing tools to streamText", {
    toolCount: Object.keys(tools).length,
    toolNames: Object.keys(tools),
    needsApproval: !shouldSkipApproval,
  });
  // ... resto sin cambios ...
}
```

---

### Paso 6: Ejemplo de Configuración

Una vez implementado, el usuario puede configurar los proveedores sin aprobación editando `~/levante/ui-preferences.json`:

```json
{
  "ai": {
    "baseSteps": 5,
    "maxSteps": 20,
    "mermaidValidation": true,
    "mcpDiscovery": true,
    "providersWithoutToolApproval": [
      "groq",
      "xai",
      "local"
    ]
  }
}
```

**Valores posibles para `providersWithoutToolApproval`:**
- `"openrouter"` - OpenRouter
- `"vercel-gateway"` - Vercel AI Gateway
- `"local"` - Ollama y modelos locales
- `"openai"` - OpenAI directo
- `"anthropic"` - Anthropic directo
- `"google"` - Google AI (Gemini)
- `"groq"` - Groq
- `"xai"` - xAI (Grok)
- `"huggingface"` - HuggingFace Inference API

---

### Paso 7: Sin UI para esta Configuración

Esta configuración **no debe exponerse en Settings UI**. Solo se gestiona por archivo de preferencias (`~/levante/ui-preferences.json`) para evitar cambios accidentales y mantener control explícito.

---

## Resumen de Archivos a Modificar

| Archivo | Tipo de Cambio | Líneas Afectadas |
|---------|----------------|------------------|
| `src/types/preferences.ts` | Agregar tipo y default | ~50-60, ~120-130 |
| `src/main/services/preferencesService.ts` | Extender schema de `ai` con enum + default | ~120-130 |
| `src/main/services/ai/mcpToolsAdapter.ts` | Agregar interfaces, modificar funciones | ~23-30, ~136, ~178-233, ~398-403 |
| `src/main/services/aiService.ts` | Agregar método, modificar streamChat | ~892 (nuevo método), ~1012-1018 |

---

## Flujo Final

```
Usuario envía mensaje
        │
        ▼
aiService.streamChat()
        │
        ├─► providerType = await this.getProviderType(model)
        │
        ├─► shouldSkipApproval = await this.shouldSkipToolApproval(providerType)
        │         │
        │         └─► Lee providersWithoutToolApproval de ui-preferences.json
        │             Retorna true si providerType está en la lista
        │
        └─► mcpTools = await getMCPTools({ skipApproval: shouldSkipApproval })
                    │
                    └─► createAISDKTool(serverId, mcpTool, { skipApproval })
                                │
                                └─► needsApproval: !skipApproval
                                    │
                           ┌────────┴────────┐
                           │                 │
                    skipApproval=false    skipApproval=true
                           │                 │
                           ▼                 ▼
                    needsApproval=true   needsApproval=false
                           │                 │
                           ▼                 ▼
                    UI de aprobación     Ejecución directa
                    (Approve/Deny)       (sin interrumpir stream)
```

---

## Verificación

Después de implementar los cambios:

1. **Configurar un proveedor sin aprobación:**
   ```json
   "ai": {
     "providersWithoutToolApproval": ["groq"]
   }
   ```

2. **Usar un modelo de Groq con MCP habilitado**

3. **Verificar en logs:**
   - `"Skipping tool approval for provider"` con `providerType: "groq"`
   - `"needsApproval: false"` en los logs de creación de tools

4. **Verificar en UI:**
   - Las herramientas se ejecutan automáticamente sin mostrar botones de Approve/Deny
   - El stream NO se corta esperando aprobación

---

*Documento generado: 2026-02-17*
*Branch: feat/approval-tool-execution2*
