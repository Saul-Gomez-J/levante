# Análisis: Ejecución de Comandos del Sistema por el Agente de IA de Levante

**Fecha:** 2026-02-04
**Autor:** Análisis técnico automatizado
**Versión:** 1.0

---

## Resumen Ejecutivo

**Pregunta:** ¿Puede el agente de IA de Levante ejecutar comandos del sistema?

**Respuesta corta:** **SÍ, es técnicamente viable** y existen múltiples caminos para implementarlo:

| Opción | Complejidad | Seguridad | Recomendación |
|--------|-------------|-----------|---------------|
| 1. Servidor MCP de Shell | Baja | Alta (configurable) | ✅ **Recomendada** |
| 2. Built-in Tool nativa | Media | Media | 🟡 Viable |
| 3. Code Mode (mcp-use) | Baja | Alta | ✅ Ya disponible parcialmente |
| 4. Tool personalizada | Media | Configurable | 🟡 Viable |

---

## 1. Arquitectura Actual del Sistema

### 1.1 Flujo de Chat con Herramientas

```
┌─────────────────────────────────────────────────────────────────┐
│  Usuario envía mensaje                                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Renderer Process (React)                                       │
│  └─ ChatStore → IPC: levante/chat/stream                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Main Process (Node.js)                                         │
│  └─ ChatHandlers → AIService.streamChat()                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  AIService prepara herramientas:                                │
│  ├─ Built-in Tools (mermaid, mcp_discovery)                    │
│  └─ MCP Tools (si enableMCP=true)                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Vercel AI SDK: streamText()                                    │
│  └─ Envía tools al modelo LLM                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Modelo decide usar tool → tool-call chunk                     │
│  └─ AI SDK ejecuta tool.execute()                              │
│  └─ Resultado → tool-result chunk                              │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Sistema de Herramientas Existente

**Levante ya tiene soporte COMPLETO para function calling:**

```typescript
// src/main/services/aiService.ts
const result = streamText({
  model: modelProvider,
  messages: [...],
  tools: {
    // Built-in tools
    builtin_validate_mermaid: tool({...}),
    mcp_discovery: tool({...}),

    // MCP tools (dinámicas)
    "serverId_toolName": aiToolInstance,
    // ...
  },
  // Multi-step tool calling
  stopWhen: stepCountIs(maxSteps),
});
```

### 1.3 Sistema MCP Actual

Los servidores MCP **ya pueden ejecutar comandos** mediante el transporte `stdio`:

```typescript
// Configuración actual de servidor MCP
{
  id: "filesystem",
  transport: "stdio",
  command: "npx",
  args: ["@modelcontextprotocol/server-filesystem"],
  env: { "ALLOWED_DIRS": "/home/user" }
}
```

---

## 2. Opciones de Implementación

### 2.1 Opción 1: Servidor MCP de Shell (RECOMENDADA)

**Descripción:** Usar un servidor MCP especializado en ejecución de comandos shell.

**Servidores MCP existentes:**
- `@anthropic/mcp-server-shell` - Oficial de Anthropic
- `@modelcontextprotocol/server-shell` - Comunidad
- Crear uno personalizado

**Configuración:**

```json
{
  "mcpServers": {
    "shell": {
      "transport": "stdio",
      "command": "npx",
      "args": ["@anthropic/mcp-server-shell"],
      "env": {
        "ALLOWED_COMMANDS": "ls,cat,grep,find,git",
        "WORKING_DIR": "/home/user/projects",
        "TIMEOUT_MS": "30000"
      }
    }
  }
}
```

**Ventajas:**
- ✅ Mínimo código nuevo en Levante
- ✅ Configuración flexible por usuario
- ✅ Sandboxing configurable (allowlist de comandos)
- ✅ Reutiliza toda la infraestructura MCP existente
- ✅ El modelo ya sabe usar tools MCP

**Desventajas:**
- ⚠️ Depende de servidor externo
- ⚠️ Requiere configuración manual del usuario

**Esfuerzo estimado:** 1-2 horas (solo documentación/UI)

---

### 2.2 Opción 2: Built-in Tool Nativa

**Descripción:** Agregar una tool nativa en `builtInTools.ts` para ejecución de comandos.

**Implementación:**

```typescript
// src/main/services/ai/builtInTools.ts

import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function getBuiltInTools(config?: BuiltInToolsConfig) {
  const tools: Record<string, any> = {};

  // ... existing tools ...

  if (config?.shellExecution !== false) {
    tools['builtin_execute_command'] = tool({
      description: 'Execute a shell command on the local system. Use with caution.',
      inputSchema: z.object({
        command: z.string().describe('The shell command to execute'),
        workingDir: z.string().optional().describe('Working directory for command'),
        timeout: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
      }),
      execute: async ({ command, workingDir, timeout = 30000 }) => {
        // Validación de seguridad
        const dangerousPatterns = [
          /rm\s+-rf\s+[\/~]/i,
          />\s*\/dev\//,
          /\|\s*sh/,
          /eval\s/,
          /`.*`/,
        ];

        for (const pattern of dangerousPatterns) {
          if (pattern.test(command)) {
            return {
              success: false,
              error: 'Command blocked: potentially dangerous operation'
            };
          }
        }

        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: workingDir || process.cwd(),
            timeout,
            maxBuffer: 1024 * 1024, // 1MB
          });

          return {
            success: true,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: 0,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            stderr: error.stderr?.trim(),
            exitCode: error.code || 1,
          };
        }
      },
    });
  }

  return tools;
}
```

**Ventajas:**
- ✅ Integración directa en Levante
- ✅ Control total sobre la implementación
- ✅ Sin dependencias externas

**Desventajas:**
- ⚠️ Mayor responsabilidad de seguridad
- ⚠️ Requiere más código y testing
- ⚠️ Necesita UI para configuración

**Esfuerzo estimado:** 4-8 horas

---

### 2.3 Opción 3: Code Mode con mcp-use (YA DISPONIBLE)

**Descripción:** Aprovechar el "Code Mode" de mcp-use para ejecutar JavaScript que puede interactuar con el sistema.

**Estado actual:** Ya implementado en `MCPUseService`

**Configuración:**
```typescript
// ui-preferences.json
{
  "mcp": {
    "sdk": "mcp-use",
    "codeModeDefaults": {
      "enabled": true,
      "executor": "vm",
      "vmTimeout": 30000,
      "vmMemoryLimit": 134217728
    }
  }
}
```

**Capacidades:**
- JavaScript en VM local sandboxed
- Orquestación de múltiples tools
- Lógica compleja

**Limitaciones:**
- No tiene acceso directo a `child_process`
- Sandboxed por diseño
- Para ejecución real de comandos, necesita un servidor MCP de shell

**Ventajas:**
- ✅ Ya está implementado
- ✅ Sandboxed por defecto
- ✅ Puede combinar con servidor MCP de shell

---

### 2.4 Opción 4: Tool Personalizada vía Preferencias

**Descripción:** Permitir al usuario definir custom tools en configuración.

**Configuración:**

```json
{
  "customTools": {
    "run_tests": {
      "description": "Run project tests",
      "command": "npm test",
      "workingDir": "${PROJECT_DIR}",
      "allowedArgs": ["--watch", "--coverage"]
    },
    "git_status": {
      "description": "Get git status",
      "command": "git status --porcelain",
      "workingDir": "${PROJECT_DIR}"
    }
  }
}
```

**Ventajas:**
- ✅ Máxima flexibilidad para el usuario
- ✅ Tools pre-aprobadas (más seguro)
- ✅ Sin ejecución arbitraria

**Desventajas:**
- ⚠️ Requiere implementación de UI
- ⚠️ Complejidad adicional

---

## 3. Consideraciones de Seguridad

### 3.1 Riesgos Identificados

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Ejecución de comandos destructivos | 🔴 Crítica | Allowlist + confirmación |
| Exfiltración de datos | 🔴 Crítica | Sandboxing + network control |
| Privilege escalation | 🔴 Crítica | Ejecutar sin sudo |
| Resource exhaustion | 🟡 Alta | Timeouts + limits |
| Path traversal | 🟡 Alta | Validación de paths |

### 3.2 Medidas de Seguridad Recomendadas

#### A. Allowlist de Comandos

```typescript
const ALLOWED_COMMANDS = [
  'ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc',
  'git', 'npm', 'pnpm', 'yarn', 'node', 'python',
  'echo', 'pwd', 'date', 'which', 'env',
];

function isCommandAllowed(command: string): boolean {
  const baseCommand = command.split(/\s+/)[0];
  return ALLOWED_COMMANDS.includes(baseCommand);
}
```

#### B. Patrón de Confirmación del Usuario

```typescript
// Antes de ejecutar comandos peligrosos
interface CommandConfirmation {
  command: string;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
}

// IPC: levante/shell/request-confirmation
// UI muestra diálogo de confirmación
```

#### C. Sandboxing con Docker/Containers

```typescript
// Para máxima seguridad
const containerConfig = {
  image: 'levante-sandbox:latest',
  readOnlyRootFilesystem: true,
  networkMode: 'none',
  memLimit: '256m',
  cpuLimit: '0.5',
};
```

#### D. Logging y Auditoría

```typescript
// Registrar TODOS los comandos ejecutados
logger.security.info('Command executed', {
  command,
  user: process.env.USER,
  timestamp: Date.now(),
  exitCode,
  duration,
});
```

### 3.3 Modelo de Permisos Propuesto

```typescript
interface ShellPermissions {
  enabled: boolean;
  mode: 'allowlist' | 'confirm-all' | 'unrestricted';
  allowedCommands?: string[];
  blockedCommands?: string[];
  allowedDirectories?: string[];
  requireConfirmation?: boolean;
  maxOutputSize?: number;
  timeout?: number;
}

// Ejemplo de configuración segura
const defaultPermissions: ShellPermissions = {
  enabled: true,
  mode: 'allowlist',
  allowedCommands: ['ls', 'cat', 'git', 'npm'],
  allowedDirectories: ['~/projects'],
  requireConfirmation: true,
  maxOutputSize: 1024 * 1024,
  timeout: 30000,
};
```

---

## 4. Arquitectura Propuesta

### 4.1 Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────────────┐
│  Settings UI                                                    │
│  └─ Shell Execution Configuration                              │
│     ├─ Enable/Disable toggle                                   │
│     ├─ Security mode selector                                  │
│     ├─ Allowed commands editor                                 │
│     └─ Allowed directories picker                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  ShellService (Main Process)                                    │
│  ├─ validateCommand(cmd) → boolean                             │
│  ├─ executeCommand(cmd, opts) → Promise<Result>                │
│  ├─ requestConfirmation(cmd) → Promise<boolean>                │
│  └─ auditLog(cmd, result) → void                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  shell_execute Tool (AI Tool)                                   │
│  └─ Registrada en builtInTools.ts                              │
│  └─ Disponible para el modelo cuando está habilitada           │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Flujo de Ejecución

```
1. Usuario envía: "Lista los archivos en el directorio actual"
2. Modelo recibe tools disponibles incluyendo shell_execute
3. Modelo decide llamar: shell_execute({ command: "ls -la" })
4. Tool valida comando contra allowlist
5. Si requireConfirmation=true:
   a. UI muestra diálogo de confirmación
   b. Usuario aprueba/rechaza
6. Si aprobado, ejecuta comando
7. Retorna resultado al modelo
8. Modelo interpreta y responde al usuario
```

---

## 5. Implementación Recomendada

### Fase 1: Servidor MCP de Shell (Inmediata)

1. Documentar cómo configurar `@anthropic/mcp-server-shell`
2. Agregar template en UI de configuración MCP
3. Incluir presets de seguridad

### Fase 2: Built-in Tool (Corto plazo)

1. Implementar `builtin_execute_command` en `builtInTools.ts`
2. Crear `ShellService` con validaciones
3. Agregar sección en Settings para configuración
4. Implementar confirmación de usuario para comandos

### Fase 3: Mejoras de Seguridad (Mediano plazo)

1. Sandboxing con containers
2. Rate limiting
3. Logging de auditoría
4. Políticas avanzadas de permisos

---

## 6. Conclusión

**El agente de IA de Levante puede ejecutar comandos del sistema** mediante:

1. **Ya disponible:** Configurar un servidor MCP de shell externo
2. **Fácil de implementar:** Agregar una built-in tool nativa
3. **Ya existe parcialmente:** Code Mode de mcp-use (limitado)

**Recomendación principal:**

Comenzar con la **Opción 1 (Servidor MCP de Shell)** porque:
- Requiere mínimo desarrollo
- Aprovecha la infraestructura existente
- Ofrece configuración flexible
- Permite sandboxing por servidor MCP

Posteriormente, considerar la **Opción 2 (Built-in Tool)** para una experiencia más integrada.

---

## 7. Próximos Pasos

1. [ ] Decidir qué opción implementar primero
2. [ ] Definir políticas de seguridad específicas
3. [ ] Diseñar UI de configuración
4. [ ] Implementar logging y auditoría
5. [ ] Crear documentación para usuarios
6. [ ] Testing de seguridad

---

## Apéndice A: Código de Referencia

### A.1 Schema de Configuración

```typescript
// src/types/preferences.ts

interface ShellExecutionConfig {
  enabled: boolean;
  mode: 'mcp-server' | 'builtin' | 'disabled';

  // Para builtin
  builtinConfig?: {
    allowedCommands: string[];
    blockedPatterns: string[];
    allowedDirectories: string[];
    requireConfirmation: boolean;
    timeout: number;
    maxOutputSize: number;
  };

  // Para MCP server
  mcpServerConfig?: {
    serverId: string;
    autoConnect: boolean;
  };
}
```

### A.2 IPC Handlers Necesarios

```typescript
// src/main/ipc/shellHandlers.ts

export function registerShellHandlers() {
  ipcMain.handle('levante/shell/execute', async (_, command, options) => {
    // Implementación
  });

  ipcMain.handle('levante/shell/validate', async (_, command) => {
    // Validación previa
  });

  ipcMain.handle('levante/shell/confirm', async (_, command) => {
    // Mostrar diálogo de confirmación
  });
}
```

---

## Apéndice B: Servidores MCP de Shell Disponibles

| Servidor | Autor | Características |
|----------|-------|-----------------|
| `@anthropic/mcp-server-shell` | Anthropic | Oficial, sandboxed |
| `@modelcontextprotocol/server-shell` | Comunidad | Flexible |
| `mcp-shell-server` | Terceros | Lightweight |

---

*Documento generado como parte del análisis técnico de Levante.*
