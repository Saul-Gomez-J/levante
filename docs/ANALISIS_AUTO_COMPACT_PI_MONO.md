# Análisis Detallado del Sistema Auto-Compact de pi-mono

Este documento analiza en profundidad el sistema de auto-compactación de `pi-mono/packages/coding-agent`, que permite gestionar el contexto de conversaciones largas resumiendo automáticamente los mensajes antiguos.

---

## 1. Archivos del Sistema

### Archivos Core

| Archivo | Descripción | Líneas |
|---------|-------------|--------|
| `src/core/compaction/compaction.ts` | Lógica principal de compactación | ~375 |
| `src/core/compaction/branch-summarization.ts` | Resumen de ramas abandonadas | ~350 |
| `src/core/compaction/utils.ts` | Utilidades compartidas | ~150 |
| `src/core/compaction/index.ts` | Exports públicos | - |
| `src/core/agent-session.ts` | Integración con el agent loop | Lines 232-1753 |
| `src/core/session-manager.ts` | Tipos de entrada de sesión | - |
| `src/core/settings-manager.ts` | Configuración | - |

### Estructura de Carpetas

```
packages/coding-agent/src/core/
├── compaction/
│   ├── index.ts
│   ├── compaction.ts          # Algoritmo principal
│   ├── branch-summarization.ts # Resumen de ramas
│   └── utils.ts               # Utilidades
├── agent-session.ts           # Integración
├── session-manager.ts         # Persistencia
└── settings-manager.ts        # Configuración
```

### Tests

- `test/compaction.test.ts` - Tests unitarios (token calc, cut points)
- `test/agent-session-compaction.test.ts` - Tests E2E
- `test/agent-session-auto-compaction-queue.test.ts` - Tests de queue resume
- `test/compaction-extensions.test.ts` - Tests de extensiones

---

## 2. Detección de Cuándo Compactar

### Mecanismos de Trigger

El sistema tiene **tres formas** de activar la compactación:

#### 2.1 Threshold-based (Automático)

Ubicación: `agent-session.ts`, líneas 1602-1609

```typescript
const contextTokens = calculateContextTokens(assistantMessage.usage);
if (shouldCompact(contextTokens, contextWindow, settings)) {
    await this._runAutoCompaction("threshold", false);
}
```

- Se ejecuta después de cada respuesta exitosa del LLM
- Comprueba: `contextTokens > contextWindow - reserveTokens`
- Por defecto: Se activa cuando el contexto excede (context_window - 16384) tokens

#### 2.2 Overflow-based (Auto-Recovery)

Ubicación: `agent-session.ts`, líneas 1590-1598

```typescript
if (sameModel && !errorIsFromBeforeCompaction && isContextOverflow(assistantMessage)) {
    // Remove error message, run compaction with retry
    await this._runAutoCompaction("overflow", true);
}
```

- Se activa cuando el LLM devuelve error de "context overflow"
- Reintenta automáticamente después de compactar
- Filtros inteligentes:
  - Ignora errores de modelos diferentes (cambio de modelo)
  - Ignora errores de mensajes anteriores a la última compactación

#### 2.3 Manual Trigger

```typescript
session.compact(customInstructions?)
```

- El usuario ejecuta `/compact [instrucciones]`
- Las extensiones pueden llamar `ctx.compact()`

### Flujo de Detección

```
Agent completa respuesta
         ↓
message_end event (guardado en sesión)
         ↓
agent_end event triggered
         ↓
_checkCompaction() llamado
         ↓
    ┌────────────────────────────────────────┐
    │   Check si error necesita retry        │
    │   (detección de overflow)              │
    └────────────────────────────────────────┘
              ↓ (error detectado)             ↓ (sin error)
     _runAutoCompaction("overflow", true)    Check threshold
              │                                   │
              │                                   ├─ Obtener context tokens de usage
              │                                   ├─ Comparar: tokens > window - reserve?
              │                                   │
              │                                   └─ _runAutoCompaction("threshold", false)
              └───────────────────┬───────────────┘
                                  ↓
                           Compactación ejecuta
```

---

## 3. Algoritmo de Compactación

El proceso tiene **cinco pasos**:

### Paso 1: Preparar Compactación

Función: `prepareCompaction()` (líneas 597-677)

```typescript
interface CompactionPreparation {
    historyMessages: AgentMessage[];      // Mensajes a resumir
    keptMessages: AgentMessage[];         // Mensajes a conservar
    firstKeptEntryId: string;             // UUID del primer mensaje conservado
    turnPrefixMessages?: AgentMessage[];  // Para split turns
    previousSummary?: string;             // Resumen anterior (si existe)
    tokensBefore: number;                 // Tokens antes de compactar
}
```

Responsabilidades:
- Localiza el límite de compactación anterior (si existe)
- Separa "history" (antes del corte) de "kept" (después del corte)
- Carga mensajes desde las entradas de sesión
- Estima tokens totales de contexto

### Paso 2: Encontrar Punto de Corte

Función: `findCutPoint()` (líneas 376-438)

**Algoritmo de Walk Hacia Atrás:**

```
1. Acumular tokens estimados desde el más nuevo al más viejo
2. Cuando acumulado >= keepRecentTokens, parar
3. Encontrar punto de corte válido en/después de esa posición
4. Puntos válidos: mensajes de usuario, asistente, custom
5. NUNCA cortar en tool results (deben permanecer con tool call)
```

**Ejemplo con keepRecentTokens=20000:**
```
  Mensaje más nuevo: 1500 tokens (total: 1500)
  Anterior:          2000 tokens (total: 3500)
  Anterior:          3000 tokens (total: 6500)
  Anterior:          5000 tokens (total: 11500)
  Anterior:          9500 tokens (total: 21000) ← EXCEDE PRESUPUESTO
  → Cortar en este punto o en límite válido anterior
```

**Caso Especial: Split Turns**

Cuando un único turn excede `keepRecentTokens`, el corte cae a mitad de turn:
- Genera dos resúmenes:
  1. "History summary" de mensajes descartados
  2. "Turn prefix summary" de la parte inicial del turn dividido

### Paso 3: Generar Resumen

Función: `generateSummary()` (líneas 520-573)

**Formato Estructurado:**

```markdown
## Goal
[Qué está intentando lograr el usuario]

## Constraints & Preferences
[Requisitos mencionados]

## Progress
### Done / In Progress / Blocked

## Key Decisions
[Por qué se tomaron decisiones]

## Next Steps
[Lista ordenada]

## Critical Context
[Datos necesarios para continuar]

<read-files>
[lista de archivos solo leídos]
</read-files>

<modified-files>
[lista de archivos modificados]
</modified-files>
```

**Configuración del LLM:**
- Usa `reasoning: "high"` para análisis más profundo
- Para actualizaciones: puede incluir resumen anterior para mejora iterativa
- Max tokens: 80% de reserveTokens
- Serializa mensajes a texto primero (evita que el modelo los trate como conversación a continuar)

### Paso 4: Crear Entrada

Función: `compact()` (líneas 705-771)

```typescript
const result: CompactionResult = {
    summary,              // Resumen generado por LLM
    firstKeptEntryId,     // UUID del primer mensaje a conservar
    tokensBefore,         // Tokens de contexto antes de compactar
    details: {
        readFiles,        // Archivos leídos
        modifiedFiles     // Archivos modificados
    }
};
```

### Paso 5: Recargar Sesión

Función: `_runAutoCompaction()` (líneas 1695-1698)

```typescript
this.sessionManager.appendCompaction(summary, firstKeptEntryId, ...);
const newEntries = this.sessionManager.getEntries();
const sessionContext = this.sessionManager.buildSessionContext();
this.agent.replaceMessages(sessionContext.messages);
```

Reconstruye el contexto del agente con:
- Resumen de compactación como mensaje custom
- Mensajes desde `firstKeptEntryId` en adelante

### Tracking Acumulativo de Archivos

Los archivos se trackean acumulativamente entre compactaciones:

```typescript
// 1. Extraer file ops de mensajes nuevos siendo resumidos
const currentOps = extractFileOperations(newMessages);

// 2. Extraer file ops de details de compactación anterior
const previousOps = previousCompaction.details;

// 3. Merge: previous + current
const mergedOps = {
    readFiles: [...previousOps.readFiles, ...currentOps.readFiles],
    modifiedFiles: [...previousOps.modifiedFiles, ...currentOps.modifiedFiles]
};
```

---

## 4. Integración con el Agent Loop

### Flujo Basado en Eventos

Ubicación: `agent-session.ts`, líneas 317-396 (`_handleAgentEvent`)

```
Usuario envía prompt
     ↓
agent.prompt() llamado
     ↓
Agent genera respuesta (llamada LLM)
     ↓
agent_end event
     ↓
_handleAgentEvent() (líneas 317-396)
     ├─ Persistencia de sesión (guardar mensajes)
     ├─ Eventos de extensión (turn_end, etc)
     └─ Check compactación (trigger auto-compact)
```

### Puntos de Integración Clave

#### 4.1 Después de message_end (línea 344-381)

- Persiste mensajes user/assistant/toolResult
- Trackea último mensaje del asistente para check posterior
- Resetea contador de retry en éxito

#### 4.2 Después de agent_end (línea 384-395)

```typescript
_checkCompaction(lastAssistantMessage)
```

- Primero checkea errores reintentables
- Luego checkea compactación basada en threshold

#### 4.3 Auto-Retry Después de Overflow (líneas 1720-1730)

```typescript
if (willRetry) {
    // Quitar mensaje de error, kickear loop
    this.agent.replaceMessages(messages.slice(0, -1));
    setTimeout(() => {
        this.agent.continue().catch(() => {});
    }, 100);
}
```

#### 4.4 Queue Resume (líneas 1731-1737)

- Después de que compactación completa, checkea mensajes en cola
- Automáticamente llama `agent.continue()` para entregarlos
- Previene que mensajes del usuario queden perdidos

#### 4.5 Hooks de Extensión

```typescript
// Antes de compactar - puede personalizar/cancelar
session_before_compact: (ctx, data) => {
    // return null para cancelar
    // return customSummary para override
}

// Después de compactar
session_compact: (ctx, result) => {
    // Notificaciones, logging, etc.
}
```

### Control de Abort

```typescript
private _autoCompactionAbortController: AbortController | undefined;

// Setear antes de empezar
_autoCompactionAbortController = new AbortController();

// Checkear durante ejecución
if (_autoCompactionAbortController.signal.aborted) {
    return;  // Parar operación
}

// Limpiar cuando termine
finally {
    _autoCompactionAbortController = undefined;
}
```

El usuario puede llamar `session.abortCompaction()` para cancelar compactaciones en vuelo.

---

## 5. Configuración

### Interface de Settings

Ubicación: `settings-manager.ts`, líneas 7-11

```typescript
interface CompactionSettings {
    enabled?: boolean;         // default: true
    reserveTokens?: number;    // default: 16384
    keepRecentTokens?: number; // default: 20000
}
```

### Archivos de Configuración

**Global** (`~/.pi/agent/settings.json`):
```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

**Proyecto** (`<project-dir>/.pi/settings.json`):
- Sobrescribe configuración global
- Permite personalización por proyecto

### Métodos API

```typescript
// Habilitar/deshabilitar
session.setAutoCompactionEnabled(true);
session.autoCompactionEnabled  // getter

// Leer settings
const settings = settingsManager.getCompactionSettings();
// Returns: { enabled: boolean, reserveTokens: number, keepRecentTokens: number }

// Getters individuales
settingsManager.getCompactionEnabled()
settingsManager.getCompactionReserveTokens()
settingsManager.getCompactionKeepRecentTokens()
```

### Descripción de Settings

| Setting | Default | Rango | Descripción |
|---------|---------|-------|-------------|
| `enabled` | `true` | boolean | Habilitar/deshabilitar auto-compactación |
| `reserveTokens` | `16384` | positive int | Tokens reservados para respuesta LLM (no enviar al LLM) |
| `keepRecentTokens` | `20000` | positive int | Tokens recientes aproximados a preservar (no resumir) |

### Valores Prácticos

| Caso de Uso | reserveTokens | keepRecentTokens | Notas |
|-------------|---------------|------------------|-------|
| Context window pequeña (Opus) | 16384 | 5000 | Compactación agresiva |
| Context window grande (Claude 3.5) | 32768 | 50000 | Más contexto preservado |
| Optimización de costos | Alto | Bajo | Compactaciones frecuentes |
| Máxima precisión | Bajo | Alto | Más contexto, menos resúmenes |

---

## 6. Funciones Clave

### Funciones de Cálculo de Tokens

| Función | Ubicación | Responsabilidad |
|---------|-----------|-----------------|
| `calculateContextTokens(usage)` | compaction.ts:128-130 | Obtener tokens totales de objeto Usage |
| `estimateTokens(message)` | compaction.ts:225-283 | Estimar tamaño de mensaje usando heurística chars/4 |
| `estimateContextTokens(messages)` | compaction.ts:179-207 | Estimar contexto de mensajes, usar último usage si disponible |
| `getLastAssistantUsage(entries)` | compaction.ts:149-158 | Encontrar usage del último mensaje asistente no abortado |

### Funciones de Detección

| Función | Ubicación | Responsabilidad |
|---------|-----------|-----------------|
| `shouldCompact(tokens, window, settings)` | compaction.ts:212-215 | Checkear si tokens exceden threshold |
| `_checkCompaction(msg)` | agent-session.ts:1565-1610 | Detectar overflow O threshold |
| `isContextOverflow(msg, window)` | pi-ai library | Checkear si mensaje contiene error overflow |

### Funciones de Punto de Corte

| Función | Ubicación | Responsabilidad |
|---------|-----------|-----------------|
| `findCutPoint(entries, start, end, tokens)` | compaction.ts:376-438 | Encontrar índice que mantiene ~keepRecentTokens |
| `findValidCutPoints(entries, start, end)` | compaction.ts:292-327 | Identificar ubicaciones válidas de corte |
| `findTurnStartIndex(entries, idx, start)` | compaction.ts:334-349 | Encontrar mensaje usuario que inició turn actual |

### Funciones de Preparación

| Función | Ubicación | Responsabilidad |
|---------|-----------|-----------------|
| `prepareCompaction(entries, settings)` | compaction.ts:597-677 | Preparar todos los datos para resumen |
| `getMessageFromEntry(entry)` | compaction.ts:79-93 | Convertir entry a AgentMessage |
| `extractFileOperations(messages, entries, idx)` | compaction.ts:41-69 | Recolectar archivos read/modified |

### Funciones de Resumen

| Función | Ubicación | Responsabilidad |
|---------|-----------|-----------------|
| `generateSummary(messages, model, tokens, apiKey)` | compaction.ts:520-573 | Llamar LLM para crear resumen |
| `compact(preparation, model, apiKey)` | compaction.ts:705-771 | Ejecutar pipeline completo de compactación |
| `generateBranchSummary(entries, options)` | branch-summarization.ts:280-352 | Resumir rama abandonada |

### Funciones Utilitarias

| Función | Ubicación | Responsabilidad |
|---------|-----------|-----------------|
| `serializeConversation(messages)` | utils.ts:93-146 | Convertir mensajes a formato texto |
| `extractFileOpsFromMessage(msg, ops)` | utils.ts:29-56 | Parsear tool calls para file ops |
| `computeFileLists(fileOps)` | utils.ts:62-67 | Deduplicar archivos read/modified |
| `formatFileOperations(read, modified)` | utils.ts:72-82 | Formatear como tags XML para resumen |
| `convertToLlm(messages)` | messages.ts | Convertir AgentMessage[] a Message[] |

### Funciones de Session Management

| Función | Ubicación | Responsabilidad |
|---------|-----------|-----------------|
| `appendCompaction(summary, id, tokens, details)` | session-manager.ts:864-884 | Guardar entrada de compactación |
| `appendCustomMessageEntry(type, content, display)` | session-manager.ts:934-950 | Guardar resumen como mensaje |
| `buildSessionContext()` | session-manager.ts | Construir contexto LLM desde entries |
| `getLatestCompactionEntry(entries)` | session-manager.ts:293-300 | Encontrar compactación más reciente |

### Funciones de Agent-Session

| Función | Ubicación | Responsabilidad |
|---------|-----------|-----------------|
| `_checkCompaction(msg)` | agent-session.ts:1565-1610 | Detectar si compactación necesaria |
| `_runAutoCompaction(reason, willRetry)` | agent-session.ts:1615-1753 | Ejecutar auto-compactación |
| `compact(customInstructions)` | agent-session.ts:1470-1537 | API de compactación manual |
| `abortCompaction()` | agent-session.ts:1542-1545 | Cancelar compactación en vuelo |
| `setAutoCompactionEnabled(enabled)` | agent-session.ts:1758-1760 | Toggle feature |

---

## 7. Diagrama de Arquitectura

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SISTEMA AUTO-COMPACT                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  CAPA DE DETECCIÓN (agent-session.ts)                                   │
│  ├─ _handleAgentEvent() - Suscripción a eventos                         │
│  ├─ _checkCompaction() - Detección overflow O threshold                 │
│  └─ Emitir eventos: auto_compaction_start/end, auto_retry_start/end    │
│                                                                          │
│  CAPA DE PREPARACIÓN (compaction.ts)                                    │
│  ├─ prepareCompaction() - Recopilar datos para resumen                 │
│  ├─ findCutPoint() - Localizar límite de mensaje                       │
│  ├─ findTurnStartIndex() - Detectar split turns                        │
│  └─ estimateContextTokens() - Calcular uso actual                      │
│                                                                          │
│  CAPA DE RESUMEN (compaction.ts)                                        │
│  ├─ generateSummary() - Llamar LLM para resumen texto                  │
│  ├─ generateTurnPrefixSummary() - Para split turns                     │
│  └─ Usa serializeConversation() para formatear mensajes                │
│                                                                          │
│  CAPA DE PERSISTENCIA (session-manager.ts)                              │
│  ├─ appendCompaction() - Guardar CompactionEntry                       │
│  ├─ appendCustomMessageEntry() - Guardar resumen como mensaje          │
│  └─ buildSessionContext() - Reconstruir contexto del agente            │
│                                                                          │
│  CAPA DE CONFIGURACIÓN (settings-manager.ts)                            │
│  ├─ getCompactionSettings() - Leer config                              │
│  ├─ setCompactionEnabled() - Toggle feature                            │
│  └─ Soporta overrides global + nivel proyecto                          │
│                                                                          │
│  CAPA DE EXTENSIONES (extensions/types.ts)                              │
│  ├─ session_before_compact - Hook para resumen personalizado           │
│  └─ session_compact - Hook después de completar                        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Decisiones de Diseño Clave

| # | Decisión | Descripción |
|---|----------|-------------|
| 1 | **Detección basada en tokens** | Usa ratio de context window en lugar de conteo fijo |
| 2 | **Algoritmo de walk hacia atrás** | Mantiene contexto más reciente, resume lo más viejo |
| 3 | **Manejo de Split Turn** | Genera dos resúmenes para cortes a mitad de turn |
| 4 | **Tracking de archivos** | Acumulativo entre múltiples compactaciones |
| 5 | **Resúmenes estructurados** | Formato consistente ayuda tanto al modelo como al humano |
| 6 | **Hooks de extensión** | Permite implementaciones custom sin modificar core |
| 7 | **Auto-Retry** | Recuperación automática de errores overflow |
| 8 | **Queue Resume** | Asegura que mensajes en cola no se pierdan |
| 9 | **Control de Abort** | AbortSignal permite cancelación iniciada por usuario |
| 10 | **Herencia de settings** | Settings de proyecto sobrescriben global, ambos opcionales |

---

## 9. Ejemplo de Flujo Completo

```
1. Usuario envía mensaje #50 en conversación larga
         ↓
2. Agent procesa y genera respuesta (200k tokens usados)
         ↓
3. message_end event - guardar respuesta en sesión
         ↓
4. agent_end event - _checkCompaction() llamado
         ↓
5. shouldCompact(200000, 200000, { reserveTokens: 16384 }) = true
   (200000 > 200000 - 16384)
         ↓
6. _runAutoCompaction("threshold", false) iniciado
         ↓
7. prepareCompaction() - identifica:
   - historyMessages: mensajes 1-40
   - keptMessages: mensajes 41-50
   - tokensBefore: 200000
         ↓
8. findCutPoint() - con keepRecentTokens=20000:
   - Walk back desde mensaje 50
   - Acumular tokens hasta >= 20000
   - Encontrar límite válido (no tool_result)
         ↓
9. generateSummary() - LLM genera resumen estructurado:
   - Goal, Progress, Key Decisions, etc.
   - Incluye <read-files> y <modified-files>
         ↓
10. appendCompaction() - guarda en sesión:
    - summary: "## Goal\n..."
    - firstKeptEntryId: uuid del mensaje 41
    - tokensBefore: 200000
         ↓
11. buildSessionContext() - reconstruye:
    - [compaction_summary_message, msg41, msg42, ..., msg50]
         ↓
12. agent.replaceMessages() - nuevo contexto ~25000 tokens
         ↓
13. Emitir auto_compaction_end event
         ↓
14. Usuario continúa conversación con contexto optimizado
```

---

## 10. Consideraciones para Migración a Levante

### Componentes Requeridos

1. **Capa de Compactación**
   - `compaction.ts` - Adaptar para Vercel AI SDK
   - `utils.ts` - Serialización de mensajes
   - Tipos TypeBox → Zod

2. **Integración con Chat**
   - Hook después de cada respuesta del LLM
   - Detección de overflow/threshold
   - Retry automático

3. **Persistencia**
   - Guardar CompactionEntry en sesión
   - Reconstruir contexto desde entries

4. **Configuración**
   - Settings de compactación por proyecto/global

### Diferencias Clave

| Aspecto | pi-mono | Levante |
|---------|---------|---------|
| SDK | @mariozechner/pi-ai | Vercel AI SDK |
| Schemas | TypeBox | Zod |
| Agent Loop | Custom AgentSession | streamText() |
| Persistencia | SessionManager | Por definir |
| Mensajes | AgentMessage | CoreMessage |

### Pasos Sugeridos

1. Crear `src/main/services/ai/compaction/` con estructura similar
2. Adaptar `serializeConversation()` para CoreMessage de Vercel
3. Integrar detección en el hook de `streamText()` onFinish
4. Implementar persistencia de compactaciones
5. Agregar configuración de usuario

---

*Documento generado a partir del análisis de pi-mono v0.53.0*
