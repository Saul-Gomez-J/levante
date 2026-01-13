# Prompt: Investigación de mcp-use para Tool Approval

## Contexto del Problema

Estamos desarrollando **Levante**, una aplicación de chat AI con Electron que usa:
- **Vercel AI SDK v6** para streaming de respuestas
- **mcp-use** como cliente MCP para ejecutar tools de servidores MCP

### Problema Principal

El flujo de aprobación de tools (`needsApproval: true`) NO funciona correctamente:

1. **Las tools se ejecutan inmediatamente** sin esperar aprobación del usuario
2. **El diálogo de aprobación aparece tarde** (después de que la tool ya se ejecutó)
3. **Error con Anthropic**: `tool_use ids were found without tool_result blocks immediately after`

### Evidencia en Logs

```
[21:09:01] Stream chunk received - type: "start"

[21:09:03] Tool result received (mcp-use) - RAW
  serverId: "supabase"
  toolName: "list_tables"
  fullResult: "[{\"schema\":\"public\",\"name\":\"allowed_emails\"..."

[21:09:03] Stream chunk received - type: "tool-result"
  toolCallId: "toolu_01E3cGELHcebJFhuB3p5iGkD"
  toolName: "supabase_list_tables"
  input: { project_id: "...", schemas: ["public"] }

[21:09:03] ERROR: messages.1: `tool_use` ids were found without
           `tool_result` blocks immediately after: toolu_01GJTVfZnnKYHrgaxoKkmh4n
```

**Observación clave**: mcp-use ejecuta la tool ANTES de que el AI SDK emita el chunk `tool-approval-request`.

---

## Arquitectura Actual

```
┌─────────────────────────────────────────────────────────────────┐
│                        FLUJO ACTUAL                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Usuario envía mensaje                                        │
│     ↓                                                            │
│  2. aiService.ts llama a streamText() con tools de mcp-use       │
│     ↓                                                            │
│  3. El modelo decide usar una tool                               │
│     ↓                                                            │
│  4. ??? mcp-use ejecuta la tool INMEDIATAMENTE ???               │
│     ↓                                                            │
│  5. AI SDK emite "tool-result" (tool ya ejecutada)               │
│     ↓                                                            │
│  6. Nunca se emite "tool-approval-request"                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Archivos Relevantes

| Archivo | Responsabilidad |
|---------|-----------------|
| `src/main/services/aiService.ts` | Orquesta streamText() y procesa chunks |
| `src/main/services/ai/mcpToolsAdapter.ts` | Adapta tools MCP al formato AI SDK |
| `src/main/services/mcp/mcpUseService.ts` | Implementación del cliente mcp-use |
| `node_modules/mcp-use/` | Librería mcp-use |

### Cómo se crean las tools actualmente

```typescript
// mcpToolsAdapter.ts
export function createMCPTools(mcpService: IMCPService): Record<string, CoreTool> {
  const tools: Record<string, CoreTool> = {};

  for (const server of mcpService.getConnectedServers()) {
    for (const tool of server.tools) {
      const toolName = `${server.id}_${tool.name}`;

      tools[toolName] = {
        description: tool.description,
        parameters: tool.inputSchema,
        needsApproval: true,  // ← Se marca que necesita aprobación
        execute: async (args) => {
          // ← Pero esta función se ejecuta inmediatamente
          return await mcpService.executeTool(server.id, tool.name, args);
        },
      };
    }
  }

  return tools;
}
```

---

## Preguntas de Investigación

### 1. ¿Cómo ejecuta mcp-use las tools?

- ¿mcp-use tiene su propio loop de ejecución de tools?
- ¿Intercepta los tool calls del modelo antes que el AI SDK?
- ¿O el AI SDK llama a `execute()` directamente sin verificar `needsApproval`?

### 2. ¿mcp-use tiene sistema de aprobación?

- ¿Existe alguna opción de configuración para pausar antes de ejecutar?
- ¿Hay callbacks o hooks que se puedan usar?
- ¿Hay algún middleware o interceptor disponible?

### 3. ¿Cómo se integra mcp-use con AI SDK?

Buscar en la documentación y código de mcp-use:
- ¿Cómo se supone que debe integrarse con Vercel AI SDK?
- ¿Hay ejemplos de uso con tool approval?
- ¿Cuál es el flujo correcto de ejecución?

### 4. ¿Por qué falla el historial de mensajes?

El error de Anthropic indica que falta `tool_result` después de `tool_use`:
- ¿mcp-use maneja el historial de mensajes?
- ¿O debería hacerlo el AI SDK?
- ¿Cómo se deben sincronizar los resultados de tools con el historial?

---

## Lo que Necesitamos Resolver

### Opción A: Configurar mcp-use para soportar approval

Si mcp-use tiene soporte nativo:
1. ¿Qué configuración usar?
2. ¿Cómo pausar la ejecución hasta que el usuario apruebe?
3. ¿Cómo comunicar la aprobación/denegación?

### Opción B: Interceptar antes de mcp-use

Si mcp-use NO tiene soporte:
1. ¿Cómo interceptar el tool call ANTES de que mcp-use ejecute?
2. ¿Cómo pausar el stream hasta que el usuario responda?
3. ¿Cómo reanudar la ejecución después de la aprobación?

### Opción C: Usar AI SDK sin mcp-use para ejecución

Si es necesario:
1. ¿Se puede usar mcp-use solo para obtener la lista de tools?
2. ¿Y luego ejecutar las tools manualmente desde el callback `execute()` del AI SDK?
3. ¿Esto permitiría que `needsApproval` funcione correctamente?

---

## Recursos para Investigar

1. **Repositorio mcp-use**: https://github.com/mcp-use/mcp-use
2. **Documentación AI SDK v6 Tool Approval**: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
3. **Código fuente de mcp-use** en `node_modules/mcp-use/`

---

## Resultado Esperado

Necesitamos un análisis detallado con:

1. **Explicación** de cómo mcp-use ejecuta las tools actualmente
2. **Opciones de solución** ordenadas por viabilidad
3. **Código de ejemplo** de la implementación recomendada
4. **Consideraciones** sobre el historial de mensajes para Anthropic

---

## Contexto Adicional

### Dependencias actuales

```json
{
  "@ai-sdk/anthropic": "^1.2.12",
  "@openrouter/ai-sdk-provider": "^0.6.0",
  "ai": "^4.3.16",
  "mcp-use": "^0.3.0"
}
```

### Configuración de mcp-use en el proyecto

```typescript
// mcpUseService.ts (simplificado)
import { MCPClient } from 'mcp-use';

export class MCPUseService implements IMCPService {
  private client: MCPClient;

  async connect(serverConfig: MCPServerConfig) {
    this.client = new MCPClient({
      // ... configuración
    });
    await this.client.connect();
  }

  async executeTool(serverId: string, toolName: string, args: any) {
    return await this.client.callTool(toolName, args);
  }
}
```

### El flujo que DEBERÍA funcionar

```
1. Usuario envía mensaje
2. streamText() inicia
3. Modelo emite tool_call
4. AI SDK detecta needsApproval: true
5. AI SDK emite "tool-approval-request" ← PAUSA AQUÍ
6. Frontend muestra diálogo
7. Usuario aprueba
8. Frontend envía respuesta de aprobación
9. AI SDK ejecuta la tool
10. Tool result se añade al historial correctamente
```

Pero actualmente el paso 4 nunca ocurre porque mcp-use ejecuta en el paso 3.
