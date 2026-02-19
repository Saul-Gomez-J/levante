# Migración del Sistema Auto-Compact a Levante

Este documento detalla el proceso completo para implementar el sistema de auto-compactación de pi-mono en Levante, adaptado a su arquitectura con Vercel AI SDK, SQLite y Electron.

---

## Índice

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Mapeo de Arquitecturas](#2-mapeo-de-arquitecturas)
3. [Archivos a Crear](#3-archivos-a-crear)
4. [Archivos a Modificar](#4-archivos-a-modificar)
5. [Fase 1: Infraestructura Base](#fase-1-infraestructura-base)
6. [Fase 2: Sistema de Tokens](#fase-2-sistema-de-tokens)
7. [Fase 3: Algoritmo de Compactación](#fase-3-algoritmo-de-compactación)
8. [Fase 4: Integración con AI Service](#fase-4-integración-con-ai-service)
9. [Fase 5: Persistencia](#fase-5-persistencia)
10. [Fase 6: Configuración](#fase-6-configuración)
11. [Fase 7: UI y Notificaciones](#fase-7-ui-y-notificaciones)
12. [Fase 8: Testing](#fase-8-testing)
13. [Checklist Final](#checklist-final)

---

## 1. Resumen Ejecutivo

### Objetivo
Implementar auto-compactación de conversaciones en Levante para:
- Evitar errores de context overflow
- Reducir costos de API (menos tokens enviados)
- Mantener conversaciones largas funcionales

### Diferencias Clave

| Aspecto | pi-mono | Levante |
|---------|---------|---------|
| SDK | @mariozechner/pi-ai | Vercel AI SDK |
| Schemas | TypeBox | Zod |
| Persistencia | JSON files + SessionManager | SQLite + ChatService |
| Agent Loop | Custom AgentSession con eventos | streamText() con onFinish |
| Mensajes | AgentMessage | UIMessage / CoreMessage |
| Settings | JSON files (~/.pi/) | Electron Store (ui-preferences.json) |

### Estimación de Archivos

- **Archivos nuevos**: 12
- **Archivos a modificar**: 8
- **Migraciones DB**: 1

---

## 2. Mapeo de Arquitecturas

### Componentes pi-mono → Levante

```
pi-mono                              Levante
────────────────────────────────────────────────────────────────
compaction/compaction.ts        →    compaction/compaction.ts
compaction/utils.ts             →    compaction/utils.ts
compaction/branch-summarization →    (No aplica - sin branches)
agent-session.ts                →    aiService.ts (integración)
session-manager.ts              →    chatService.ts + databaseService.ts
settings-manager.ts             →    preferencesService.ts
AgentMessage                    →    UIMessage / Message (DB)
SessionEntry                    →    Message (DB row)
CompactionEntry                 →    compaction_entries (nueva tabla)
```

### Flujo de Eventos

```
pi-mono:
agent_end event → _checkCompaction() → _runAutoCompaction()

Levante:
onFinish callback → checkCompaction() → runCompaction()
```

---

## 3. Archivos a Crear

### Estructura de Carpetas

```
src/main/services/ai/
├── compaction/
│   ├── index.ts                 # Exports públicos
│   ├── types.ts                 # Interfaces y tipos
│   ├── compaction.ts            # Algoritmo principal
│   ├── token-counter.ts         # Conteo de tokens
│   ├── summarizer.ts            # Generación de resúmenes
│   └── utils.ts                 # Utilidades
```

### Detalle de Archivos Nuevos

#### 3.1 `src/main/services/ai/compaction/index.ts`

```typescript
// Exports públicos del módulo de compactación
export { checkCompaction, runCompaction, type CompactionResult } from './compaction';
export { estimateTokens, countMessageTokens } from './token-counter';
export { generateSummary } from './summarizer';
export type {
  CompactionSettings,
  CompactionPreparation,
  CompactionEntry
} from './types';
```

#### 3.2 `src/main/services/ai/compaction/types.ts`

```typescript
import type { Message } from '@/types/database';

/**
 * Configuración de compactación
 */
export interface CompactionSettings {
  /** Habilitar auto-compactación. Default: true */
  enabled: boolean;
  /** Tokens reservados para respuesta del LLM. Default: 16384 */
  reserveTokens: number;
  /** Tokens recientes a preservar (no resumir). Default: 20000 */
  keepRecentTokens: number;
  /** Modelo a usar para generar resúmenes. Default: modelo actual */
  summaryModel?: string;
}

/**
 * Configuración por defecto
 */
export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
};

/**
 * Resultado de preparar compactación
 */
export interface CompactionPreparation {
  /** Mensajes que serán resumidos (a descartar) */
  historyMessages: Message[];
  /** Mensajes que se conservarán */
  keptMessages: Message[];
  /** ID del primer mensaje conservado */
  firstKeptMessageId: string;
  /** Resumen anterior si existe */
  previousSummary?: string;
  /** Tokens antes de compactar */
  tokensBefore: number;
  /** Archivos leídos en la conversación */
  readFiles: string[];
  /** Archivos modificados en la conversación */
  modifiedFiles: string[];
}

/**
 * Resultado de compactación
 */
export interface CompactionResult {
  /** Resumen generado */
  summary: string;
  /** ID del primer mensaje conservado */
  firstKeptMessageId: string;
  /** Tokens antes de compactar */
  tokensBefore: number;
  /** Tokens después de compactar (estimado) */
  tokensAfter: number;
  /** Número de mensajes resumidos */
  messagesCompacted: number;
  /** Detalles de archivos */
  details: {
    readFiles: string[];
    modifiedFiles: string[];
  };
}

/**
 * Entrada de compactación en DB
 */
export interface CompactionEntry {
  id: string;
  session_id: string;
  summary: string;
  first_kept_message_id: string;
  tokens_before: number;
  tokens_after: number;
  messages_compacted: number;
  read_files: string[];      // JSON serializado
  modified_files: string[];  // JSON serializado
  created_at: string;
}

/**
 * Razón de la compactación
 */
export type CompactionReason = 'threshold' | 'overflow' | 'manual';

/**
 * Operaciones de archivo extraídas de tool calls
 */
export interface FileOperations {
  read: Set<string>;
  modified: Set<string>;
}

/**
 * Punto de corte válido
 */
export interface CutPoint {
  index: number;
  messageId: string;
  tokensAfterCut: number;
}

/**
 * Context window por modelo (tokens)
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-3.5-turbo': 16385,
  'o1': 200000,
  'o1-mini': 128000,
  'o1-preview': 128000,
  'o3-mini': 200000,

  // Anthropic
  'claude-opus-4-20250514': 200000,
  'claude-sonnet-4-20250514': 200000,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-5-haiku-20241022': 200000,
  'claude-3-opus-20240229': 200000,
  'claude-3-sonnet-20240229': 200000,
  'claude-3-haiku-20240307': 200000,

  // Google
  'gemini-2.0-flash': 1000000,
  'gemini-1.5-pro': 2000000,
  'gemini-1.5-flash': 1000000,

  // DeepSeek
  'deepseek-chat': 64000,
  'deepseek-reasoner': 64000,

  // Default
  'default': 128000,
};

/**
 * Obtener context window para un modelo
 */
export function getContextWindow(model: string): number {
  // Buscar match exacto
  if (MODEL_CONTEXT_WINDOWS[model]) {
    return MODEL_CONTEXT_WINDOWS[model];
  }

  // Buscar por prefijo
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (model.startsWith(key) || model.includes(key)) {
      return value;
    }
  }

  return MODEL_CONTEXT_WINDOWS['default'];
}
```

#### 3.3 `src/main/services/ai/compaction/token-counter.ts`

```typescript
import type { Message } from '@/types/database';
import type { UIMessage } from '@ai-sdk/ui-utils';

/**
 * Heurística simple: ~4 caracteres por token (promedio para inglés/español)
 * Para mayor precisión, usar tiktoken o similar
 */
const CHARS_PER_TOKEN = 4;

/**
 * Estimar tokens de un string
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimar tokens de un mensaje de DB
 */
export function countMessageTokens(message: Message): number {
  let tokens = 0;

  // Contenido principal
  if (message.content) {
    tokens += estimateTokens(message.content);
  }

  // Tool calls (JSON serializado)
  if (message.tool_calls) {
    const toolCallsStr = typeof message.tool_calls === 'string'
      ? message.tool_calls
      : JSON.stringify(message.tool_calls);
    tokens += estimateTokens(toolCallsStr);
  }

  // Attachments
  if (message.attachments) {
    const attachmentsStr = typeof message.attachments === 'string'
      ? message.attachments
      : JSON.stringify(message.attachments);
    tokens += estimateTokens(attachmentsStr);
  }

  // Reasoning
  if (message.reasoning) {
    const reasoningStr = typeof message.reasoning === 'string'
      ? message.reasoning
      : JSON.stringify(message.reasoning);
    tokens += estimateTokens(reasoningStr);
  }

  // Overhead por role y metadata (~10 tokens)
  tokens += 10;

  return tokens;
}

/**
 * Estimar tokens de un UIMessage
 */
export function countUIMessageTokens(message: UIMessage): number {
  let tokens = 0;

  // Content puede ser string o array de parts
  if (typeof message.content === 'string') {
    tokens += estimateTokens(message.content);
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === 'text') {
        tokens += estimateTokens(part.text);
      } else if (part.type === 'tool-call') {
        tokens += estimateTokens(JSON.stringify(part.args));
        tokens += estimateTokens(part.toolName);
      } else if (part.type === 'tool-result') {
        tokens += estimateTokens(JSON.stringify(part.result));
      }
    }
  }

  // Reasoning content
  if ('reasoning' in message && message.reasoning) {
    tokens += estimateTokens(String(message.reasoning));
  }

  // Overhead
  tokens += 10;

  return tokens;
}

/**
 * Calcular tokens totales de una lista de mensajes DB
 */
export function calculateTotalTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + countMessageTokens(msg), 0);
}

/**
 * Calcular tokens totales de UIMessages
 */
export function calculateUIMessagesTokens(messages: UIMessage[]): number {
  return messages.reduce((sum, msg) => sum + countUIMessageTokens(msg), 0);
}

/**
 * Obtener tokens de contexto desde usage de respuesta LLM
 */
export function getContextTokensFromUsage(usage: {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}): number {
  // promptTokens representa el contexto enviado
  return usage.promptTokens ?? 0;
}
```

#### 3.4 `src/main/services/ai/compaction/utils.ts`

```typescript
import type { Message } from '@/types/database';
import type { FileOperations } from './types';

/**
 * Crear objeto vacío de operaciones de archivo
 */
export function createFileOps(): FileOperations {
  return {
    read: new Set<string>(),
    modified: new Set<string>(),
  };
}

/**
 * Extraer operaciones de archivo de un mensaje
 * Parsea tool_calls para encontrar read, write, edit
 */
export function extractFileOpsFromMessage(
  message: Message,
  ops: FileOperations
): void {
  if (!message.tool_calls) return;

  let toolCalls: any[];
  try {
    toolCalls = typeof message.tool_calls === 'string'
      ? JSON.parse(message.tool_calls)
      : message.tool_calls;
  } catch {
    return;
  }

  if (!Array.isArray(toolCalls)) return;

  for (const call of toolCalls) {
    const toolName = call.toolName || call.name;
    const args = call.args || call.arguments || {};

    switch (toolName) {
      case 'read':
        if (args.path) ops.read.add(args.path);
        break;
      case 'write':
      case 'edit':
        if (args.path) ops.modified.add(args.path);
        if (args.file_path) ops.modified.add(args.file_path);
        break;
      case 'bash':
        // Intentar detectar operaciones de archivo en comandos bash
        // Esto es heurístico y puede no capturar todo
        break;
    }
  }
}

/**
 * Extraer todas las operaciones de archivo de una lista de mensajes
 */
export function extractFileOperations(messages: Message[]): FileOperations {
  const ops = createFileOps();

  for (const message of messages) {
    extractFileOpsFromMessage(message, ops);
  }

  return ops;
}

/**
 * Combinar operaciones de archivos previas con nuevas
 */
export function mergeFileOperations(
  previous: { readFiles?: string[]; modifiedFiles?: string[] },
  current: FileOperations
): FileOperations {
  const merged = createFileOps();

  // Agregar previas
  if (previous.readFiles) {
    for (const f of previous.readFiles) merged.read.add(f);
  }
  if (previous.modifiedFiles) {
    for (const f of previous.modifiedFiles) merged.modified.add(f);
  }

  // Agregar actuales
  for (const f of current.read) merged.read.add(f);
  for (const f of current.modified) merged.modified.add(f);

  return merged;
}

/**
 * Formatear operaciones de archivo como XML para incluir en resumen
 */
export function formatFileOperations(
  readFiles: string[],
  modifiedFiles: string[]
): string {
  let result = '';

  if (readFiles.length > 0) {
    result += '<read-files>\n';
    for (const f of readFiles) {
      result += `${f}\n`;
    }
    result += '</read-files>\n\n';
  }

  if (modifiedFiles.length > 0) {
    result += '<modified-files>\n';
    for (const f of modifiedFiles) {
      result += `${f}\n`;
    }
    result += '</modified-files>\n';
  }

  return result;
}

/**
 * Serializar mensajes a formato texto para enviar al LLM
 */
export function serializeMessagesForSummary(messages: Message[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const role = msg.role.toUpperCase();
    lines.push(`--- ${role} ---`);

    if (msg.content) {
      lines.push(msg.content);
    }

    // Tool calls
    if (msg.tool_calls) {
      let toolCalls: any[];
      try {
        toolCalls = typeof msg.tool_calls === 'string'
          ? JSON.parse(msg.tool_calls)
          : msg.tool_calls;

        for (const call of toolCalls) {
          const name = call.toolName || call.name;
          const args = call.args || call.arguments || {};
          lines.push(`[Tool: ${name}]`);
          lines.push(JSON.stringify(args, null, 2));
        }
      } catch {
        // Ignorar errores de parsing
      }
    }

    // Reasoning (resumido)
    if (msg.reasoning) {
      lines.push('[Reasoning content present]');
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Verificar si un mensaje es un tool result
 * Los tool results no son puntos de corte válidos
 */
export function isToolResult(message: Message): boolean {
  return message.role === 'tool';
}

/**
 * Verificar si un mensaje es punto de corte válido
 * Válidos: user, assistant (sin tool result pendiente)
 */
export function isValidCutPoint(
  message: Message,
  nextMessage?: Message
): boolean {
  // No cortar en tool results
  if (isToolResult(message)) return false;

  // Si el siguiente es tool result, no es válido
  // (el tool call debe permanecer con su result)
  if (nextMessage && isToolResult(nextMessage)) return false;

  // user y assistant son válidos
  return message.role === 'user' || message.role === 'assistant';
}
```

#### 3.5 `src/main/services/ai/compaction/summarizer.ts`

```typescript
import { generateText } from 'ai';
import type { Message } from '@/types/database';
import { serializeMessagesForSummary, formatFileOperations } from './utils';
import { estimateTokens } from './token-counter';

/**
 * Prompt del sistema para generar resúmenes
 */
const SUMMARY_SYSTEM_PROMPT = `You are a conversation summarizer. Your task is to create a structured summary of the conversation that preserves all critical context needed to continue the work.

IMPORTANT:
- Be concise but comprehensive
- Focus on decisions made, progress achieved, and next steps
- Include technical details that would be needed to continue
- Preserve file paths and code references
- Do NOT include pleasantries or meta-commentary

Output format (use exactly this structure):

## Goal
[What the user is trying to accomplish - 1-2 sentences]

## Constraints & Preferences
[Any requirements, preferences, or constraints mentioned]

## Progress
### Completed
- [List of completed tasks]

### In Progress
- [Current work being done]

### Blocked
- [Any blockers or issues encountered]

## Key Decisions
[Important decisions made and why - bullet points]

## Next Steps
1. [Ordered list of what needs to be done next]

## Critical Context
[Any data, values, or context needed to continue - code snippets, config values, etc.]

{FILE_OPERATIONS}`;

/**
 * Prompt para actualizar un resumen existente
 */
const UPDATE_SUMMARY_PROMPT = `You are updating a conversation summary with new information.

Previous summary:
{PREVIOUS_SUMMARY}

New conversation since last summary:
{NEW_CONVERSATION}

Create an updated summary that:
1. Merges the previous summary with new developments
2. Updates progress sections (move completed items, add new ones)
3. Updates next steps based on what was done
4. Preserves all critical context
5. Removes outdated information

Use the same format as the previous summary.

{FILE_OPERATIONS}`;

export interface SummaryOptions {
  /** Mensajes a resumir */
  messages: Message[];
  /** Modelo a usar */
  model: string;
  /** Provider ID */
  providerId: string;
  /** API Key del provider */
  apiKey: string;
  /** Resumen anterior (para actualizaciones) */
  previousSummary?: string;
  /** Archivos leídos */
  readFiles?: string[];
  /** Archivos modificados */
  modifiedFiles?: string[];
  /** Tokens máximos para el resumen */
  maxTokens?: number;
  /** Signal para cancelación */
  signal?: AbortSignal;
}

/**
 * Generar resumen de conversación usando LLM
 */
export async function generateSummary(options: SummaryOptions): Promise<string> {
  const {
    messages,
    model,
    providerId,
    apiKey,
    previousSummary,
    readFiles = [],
    modifiedFiles = [],
    maxTokens = 4000,
    signal,
  } = options;

  // Serializar mensajes
  const conversationText = serializeMessagesForSummary(messages);

  // Formatear operaciones de archivo
  const fileOpsText = formatFileOperations(readFiles, modifiedFiles);

  // Construir prompt
  let systemPrompt: string;
  let userPrompt: string;

  if (previousSummary) {
    // Actualizar resumen existente
    systemPrompt = 'You are a conversation summarizer updating an existing summary.';
    userPrompt = UPDATE_SUMMARY_PROMPT
      .replace('{PREVIOUS_SUMMARY}', previousSummary)
      .replace('{NEW_CONVERSATION}', conversationText)
      .replace('{FILE_OPERATIONS}', fileOpsText);
  } else {
    // Crear nuevo resumen
    systemPrompt = SUMMARY_SYSTEM_PROMPT.replace('{FILE_OPERATIONS}', fileOpsText);
    userPrompt = `Please summarize the following conversation:\n\n${conversationText}`;
  }

  // Importar dinámicamente para obtener el provider correcto
  const { getModelProvider } = await import('../aiService');

  const modelProvider = await getModelProvider(providerId, model, apiKey);

  const result = await generateText({
    model: modelProvider,
    system: systemPrompt,
    prompt: userPrompt,
    maxTokens,
    abortSignal: signal,
  });

  return result.text;
}

/**
 * Estimar tokens del resumen generado
 */
export function estimateSummaryTokens(summary: string): number {
  // El resumen + overhead de mensaje custom
  return estimateTokens(summary) + 50;
}
```

#### 3.6 `src/main/services/ai/compaction/compaction.ts`

```typescript
import type { Message } from '@/types/database';
import type {
  CompactionSettings,
  CompactionPreparation,
  CompactionResult,
  CompactionReason,
  CutPoint,
} from './types';
import {
  DEFAULT_COMPACTION_SETTINGS,
  getContextWindow
} from './types';
import {
  countMessageTokens,
  calculateTotalTokens,
  getContextTokensFromUsage,
} from './token-counter';
import {
  extractFileOperations,
  mergeFileOperations,
  isValidCutPoint,
} from './utils';
import { generateSummary, estimateSummaryTokens } from './summarizer';
import { logger } from '@/main/utils/logger';

/**
 * Verificar si se debe compactar basado en tokens
 */
export function shouldCompact(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings = DEFAULT_COMPACTION_SETTINGS
): boolean {
  if (!settings.enabled) return false;

  const threshold = contextWindow - settings.reserveTokens;
  return contextTokens > threshold;
}

/**
 * Verificar si la respuesta del LLM indica context overflow
 */
export function isContextOverflow(error: any): boolean {
  if (!error) return false;

  const message = error.message || error.toString();
  const lowerMessage = message.toLowerCase();

  return (
    lowerMessage.includes('context length') ||
    lowerMessage.includes('context_length') ||
    lowerMessage.includes('maximum context') ||
    lowerMessage.includes('token limit') ||
    lowerMessage.includes('too many tokens') ||
    lowerMessage.includes('context window') ||
    lowerMessage.includes('max_tokens')
  );
}

/**
 * Encontrar punto de corte óptimo
 * Camina hacia atrás desde el final manteniendo keepRecentTokens
 */
export function findCutPoint(
  messages: Message[],
  keepRecentTokens: number
): CutPoint | null {
  if (messages.length === 0) return null;

  let accumulatedTokens = 0;
  let cutIndex = messages.length - 1;

  // Caminar hacia atrás acumulando tokens
  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = countMessageTokens(messages[i]);
    accumulatedTokens += tokens;

    if (accumulatedTokens >= keepRecentTokens) {
      cutIndex = i;
      break;
    }
  }

  // Encontrar punto de corte válido en o después del índice
  for (let i = cutIndex; i < messages.length; i++) {
    const nextMsg = messages[i + 1];
    if (isValidCutPoint(messages[i], nextMsg)) {
      // Calcular tokens después del corte
      const keptMessages = messages.slice(i + 1);
      const tokensAfterCut = calculateTotalTokens(keptMessages);

      return {
        index: i,
        messageId: messages[i].id,
        tokensAfterCut,
      };
    }
  }

  // Si no hay punto válido, usar el primero disponible
  for (let i = 0; i < messages.length; i++) {
    const nextMsg = messages[i + 1];
    if (isValidCutPoint(messages[i], nextMsg)) {
      const keptMessages = messages.slice(i + 1);
      return {
        index: i,
        messageId: messages[i].id,
        tokensAfterCut: calculateTotalTokens(keptMessages),
      };
    }
  }

  return null;
}

/**
 * Preparar datos para compactación
 */
export async function prepareCompaction(
  messages: Message[],
  settings: CompactionSettings,
  previousCompaction?: {
    summary: string;
    readFiles?: string[];
    modifiedFiles?: string[];
  }
): Promise<CompactionPreparation | null> {
  if (messages.length < 3) {
    // Muy pocos mensajes para compactar
    return null;
  }

  const tokensBefore = calculateTotalTokens(messages);

  // Encontrar punto de corte
  const cutPoint = findCutPoint(messages, settings.keepRecentTokens);
  if (!cutPoint) {
    logger.compaction.warn('No valid cut point found');
    return null;
  }

  // Separar mensajes
  const historyMessages = messages.slice(0, cutPoint.index + 1);
  const keptMessages = messages.slice(cutPoint.index + 1);

  if (historyMessages.length === 0) {
    // Nada que compactar
    return null;
  }

  // Extraer operaciones de archivo
  const currentFileOps = extractFileOperations(historyMessages);
  const mergedFileOps = previousCompaction
    ? mergeFileOperations(
        {
          readFiles: previousCompaction.readFiles,
          modifiedFiles: previousCompaction.modifiedFiles
        },
        currentFileOps
      )
    : currentFileOps;

  return {
    historyMessages,
    keptMessages,
    firstKeptMessageId: keptMessages[0]?.id || '',
    previousSummary: previousCompaction?.summary,
    tokensBefore,
    readFiles: Array.from(mergedFileOps.read),
    modifiedFiles: Array.from(mergedFileOps.modified),
  };
}

export interface CompactOptions {
  /** Preparación de compactación */
  preparation: CompactionPreparation;
  /** Modelo para generar resumen */
  model: string;
  /** Provider ID */
  providerId: string;
  /** API Key */
  apiKey: string;
  /** Signal de cancelación */
  signal?: AbortSignal;
}

/**
 * Ejecutar compactación completa
 */
export async function compact(options: CompactOptions): Promise<CompactionResult> {
  const { preparation, model, providerId, apiKey, signal } = options;

  logger.compaction.info('Starting compaction', {
    messagesBeforeCut: preparation.historyMessages.length,
    messagesKept: preparation.keptMessages.length,
    tokensBefore: preparation.tokensBefore,
  });

  // Generar resumen
  const summary = await generateSummary({
    messages: preparation.historyMessages,
    model,
    providerId,
    apiKey,
    previousSummary: preparation.previousSummary,
    readFiles: preparation.readFiles,
    modifiedFiles: preparation.modifiedFiles,
    signal,
  });

  // Estimar tokens después
  const summaryTokens = estimateSummaryTokens(summary);
  const keptTokens = calculateTotalTokens(preparation.keptMessages);
  const tokensAfter = summaryTokens + keptTokens;

  logger.compaction.info('Compaction complete', {
    tokensAfter,
    reduction: `${Math.round((1 - tokensAfter / preparation.tokensBefore) * 100)}%`,
  });

  return {
    summary,
    firstKeptMessageId: preparation.firstKeptMessageId,
    tokensBefore: preparation.tokensBefore,
    tokensAfter,
    messagesCompacted: preparation.historyMessages.length,
    details: {
      readFiles: preparation.readFiles,
      modifiedFiles: preparation.modifiedFiles,
    },
  };
}

/**
 * Punto de entrada principal: verificar y ejecutar compactación
 */
export async function checkAndCompact(
  sessionId: string,
  messages: Message[],
  contextTokens: number,
  model: string,
  providerId: string,
  apiKey: string,
  settings: CompactionSettings = DEFAULT_COMPACTION_SETTINGS,
  signal?: AbortSignal
): Promise<CompactionResult | null> {
  const contextWindow = getContextWindow(model);

  // Verificar si necesita compactación
  if (!shouldCompact(contextTokens, contextWindow, settings)) {
    return null;
  }

  logger.compaction.info('Compaction triggered', {
    sessionId,
    contextTokens,
    contextWindow,
    threshold: contextWindow - settings.reserveTokens,
  });

  // Obtener compactación anterior si existe
  const { compactionService } = await import('./compaction-service');
  const previousCompaction = await compactionService.getLatestCompaction(sessionId);

  // Preparar compactación
  const preparation = await prepareCompaction(messages, settings, previousCompaction);
  if (!preparation) {
    logger.compaction.warn('Could not prepare compaction');
    return null;
  }

  // Ejecutar compactación
  const result = await compact({
    preparation,
    model,
    providerId,
    apiKey,
    signal,
  });

  // Persistir resultado
  await compactionService.saveCompaction(sessionId, result);

  return result;
}
```

#### 3.7 `src/main/services/ai/compaction/compaction-service.ts`

```typescript
import { databaseService } from '@/main/services/databaseService';
import type { CompactionEntry, CompactionResult } from './types';
import { logger } from '@/main/utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Servicio para gestionar compactaciones en la base de datos
 */
class CompactionService {
  /**
   * Guardar resultado de compactación
   */
  async saveCompaction(
    sessionId: string,
    result: CompactionResult
  ): Promise<CompactionEntry> {
    const id = uuidv4();
    const now = new Date().toISOString();

    const entry: CompactionEntry = {
      id,
      session_id: sessionId,
      summary: result.summary,
      first_kept_message_id: result.firstKeptMessageId,
      tokens_before: result.tokensBefore,
      tokens_after: result.tokensAfter,
      messages_compacted: result.messagesCompacted,
      read_files: result.details.readFiles,
      modified_files: result.details.modifiedFiles,
      created_at: now,
    };

    await databaseService.execute({
      sql: `INSERT INTO compaction_entries
            (id, session_id, summary, first_kept_message_id, tokens_before,
             tokens_after, messages_compacted, read_files, modified_files, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        entry.id,
        entry.session_id,
        entry.summary,
        entry.first_kept_message_id,
        entry.tokens_before,
        entry.tokens_after,
        entry.messages_compacted,
        JSON.stringify(entry.read_files),
        JSON.stringify(entry.modified_files),
        entry.created_at,
      ],
    });

    logger.compaction.info('Compaction saved', { id, sessionId });

    return entry;
  }

  /**
   * Obtener la compactación más reciente de una sesión
   */
  async getLatestCompaction(sessionId: string): Promise<{
    summary: string;
    readFiles: string[];
    modifiedFiles: string[];
  } | null> {
    const result = await databaseService.execute({
      sql: `SELECT summary, read_files, modified_files
            FROM compaction_entries
            WHERE session_id = ?
            ORDER BY created_at DESC
            LIMIT 1`,
      args: [sessionId],
    });

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0] as any;
    return {
      summary: row.summary,
      readFiles: JSON.parse(row.read_files || '[]'),
      modifiedFiles: JSON.parse(row.modified_files || '[]'),
    };
  }

  /**
   * Obtener historial de compactaciones de una sesión
   */
  async getCompactionHistory(sessionId: string): Promise<CompactionEntry[]> {
    const result = await databaseService.execute({
      sql: `SELECT * FROM compaction_entries
            WHERE session_id = ?
            ORDER BY created_at DESC`,
      args: [sessionId],
    });

    return result.rows.map((row: any) => ({
      ...row,
      read_files: JSON.parse(row.read_files || '[]'),
      modified_files: JSON.parse(row.modified_files || '[]'),
    }));
  }

  /**
   * Eliminar compactaciones de una sesión (para cleanup)
   */
  async deleteSessionCompactions(sessionId: string): Promise<void> {
    await databaseService.execute({
      sql: 'DELETE FROM compaction_entries WHERE session_id = ?',
      args: [sessionId],
    });

    logger.compaction.info('Session compactions deleted', { sessionId });
  }
}

export const compactionService = new CompactionService();
```

---

## 4. Archivos a Modificar

### 4.1 `src/main/services/databaseService.ts`

**Agregar migración v6 para tabla de compactaciones:**

```typescript
// En getMigrations(), agregar:
{
  version: 6,
  description: 'Add compaction_entries table',
  up: `
    CREATE TABLE IF NOT EXISTS compaction_entries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      first_kept_message_id TEXT NOT NULL,
      tokens_before INTEGER NOT NULL,
      tokens_after INTEGER NOT NULL,
      messages_compacted INTEGER NOT NULL,
      read_files TEXT DEFAULT '[]',
      modified_files TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_compaction_session_created
    ON compaction_entries(session_id, created_at DESC);
  `,
},
```

### 4.2 `src/main/services/aiService.ts`

**Integrar auto-compactación en streamChat():**

```typescript
// Importar al inicio del archivo
import {
  checkAndCompact,
  shouldCompact,
  isContextOverflow,
  getContextWindow,
  calculateTotalTokens,
  getContextTokensFromUsage,
} from './ai/compaction';
import type { CompactionSettings } from './ai/compaction/types';

// En streamChat(), después de cargar mensajes y antes de streamText():

// Verificar si necesita compactación preventiva
const settings = await getCompactionSettings();
if (settings.enabled) {
  const estimatedTokens = calculateTotalTokens(messages);
  const contextWindow = getContextWindow(model);

  if (shouldCompact(estimatedTokens, contextWindow, settings)) {
    logger.aiSdk.info('Running preventive compaction');

    const compactionResult = await checkAndCompact(
      request.sessionId,
      messages, // Mensajes de DB
      estimatedTokens,
      model,
      providerId,
      apiKey,
      settings,
    );

    if (compactionResult) {
      // Insertar resumen como mensaje del sistema al inicio
      yield {
        type: 'compaction',
        summary: compactionResult.summary,
        messagesCompacted: compactionResult.messagesCompacted,
      };

      // Recargar mensajes después del punto de corte
      messages = await reloadMessagesAfterCompaction(
        request.sessionId,
        compactionResult.firstKeptMessageId,
        compactionResult.summary
      );
    }
  }
}

// En onFinish callback, después de guardar métricas:
onFinish: async (finishData) => {
  const { usage } = finishData;

  // Verificar si necesita compactación post-respuesta
  if (settings.enabled && usage) {
    const contextTokens = getContextTokensFromUsage(usage);
    const contextWindow = getContextWindow(model);

    if (shouldCompact(contextTokens, contextWindow, settings)) {
      // Programar compactación para el próximo mensaje
      // (no bloquear la respuesta actual)
      scheduleCompaction(request.sessionId);
    }
  }
}

// En el catch de errores:
catch (error) {
  if (isContextOverflow(error)) {
    logger.aiSdk.warn('Context overflow detected, triggering compaction');

    // Ejecutar compactación de emergencia
    const result = await checkAndCompact(
      request.sessionId,
      messages,
      Infinity, // Forzar compactación
      model,
      providerId,
      apiKey,
      { ...settings, enabled: true },
    );

    if (result) {
      // Reintentar con contexto compactado
      // ... (lógica de retry)
    }
  }
  throw error;
}
```

### 4.3 `src/main/services/preferencesService.ts`

**Agregar configuración de compactación:**

```typescript
// Agregar al schema de preferencias:
interface AIPreferences {
  // ... existentes
  compaction?: {
    enabled?: boolean;
    reserveTokens?: number;
    keepRecentTokens?: number;
    summaryModel?: string;
  };
}

// Agregar defaults:
const DEFAULT_COMPACTION = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
};

// Agregar método helper:
getCompactionSettings(): CompactionSettings {
  const ai = this.get('ai') as AIPreferences;
  return {
    enabled: ai?.compaction?.enabled ?? true,
    reserveTokens: ai?.compaction?.reserveTokens ?? 16384,
    keepRecentTokens: ai?.compaction?.keepRecentTokens ?? 20000,
    summaryModel: ai?.compaction?.summaryModel,
  };
}

setCompactionEnabled(enabled: boolean): void {
  const ai = this.get('ai') as AIPreferences || {};
  this.set('ai', {
    ...ai,
    compaction: { ...ai.compaction, enabled },
  });
}
```

### 4.4 `src/main/utils/logger.ts`

**Agregar logger de compactación:**

```typescript
// Agregar nuevo logger específico:
compaction: createLogger('compaction'),
```

### 4.5 `src/types/database.ts`

**Agregar tipo CompactionEntry:**

```typescript
export interface CompactionEntry {
  id: string;
  session_id: string;
  summary: string;
  first_kept_message_id: string;
  tokens_before: number;
  tokens_after: number;
  messages_compacted: number;
  read_files: string[];
  modified_files: string[];
  created_at: string;
}
```

### 4.6 `src/main/services/chatService.ts`

**Agregar método para recargar mensajes post-compactación:**

```typescript
/**
 * Recargar mensajes después de compactación
 * Retorna el resumen + mensajes desde firstKeptMessageId
 */
async getMessagesAfterCompaction(
  sessionId: string,
  firstKeptMessageId: string,
  summary: string
): Promise<Message[]> {
  // Obtener mensajes desde el punto de corte
  const result = await databaseService.execute({
    sql: `SELECT * FROM messages
          WHERE session_id = ?
          AND created_at >= (
            SELECT created_at FROM messages WHERE id = ?
          )
          ORDER BY created_at ASC`,
    args: [sessionId, firstKeptMessageId],
  });

  const keptMessages = result.rows as Message[];

  // Crear mensaje sintético con el resumen
  const summaryMessage: Message = {
    id: `compaction-${Date.now()}`,
    session_id: sessionId,
    role: 'system', // o 'assistant' con formato especial
    content: `[Conversation Summary]\n\n${summary}`,
    created_at: new Date(0).toISOString(), // Al inicio
  };

  return [summaryMessage, ...keptMessages];
}
```

### 4.7 `src/renderer/types/chat.ts` (si existe)

**Agregar tipo para evento de compactación:**

```typescript
export interface CompactionEvent {
  type: 'compaction';
  summary: string;
  messagesCompacted: number;
  tokensBefore?: number;
  tokensAfter?: number;
}
```

### 4.8 `src/main/ipc/handlers.ts` (o similar)

**Agregar handlers IPC para compactación manual:**

```typescript
// Compactación manual
ipcMain.handle('compaction:trigger', async (_, sessionId: string) => {
  const { compactionService } = await import('../services/ai/compaction/compaction-service');
  // ... trigger manual compaction
});

// Obtener historial de compactaciones
ipcMain.handle('compaction:history', async (_, sessionId: string) => {
  const { compactionService } = await import('../services/ai/compaction/compaction-service');
  return compactionService.getCompactionHistory(sessionId);
});

// Obtener configuración
ipcMain.handle('compaction:settings', async () => {
  const { preferencesService } = await import('../services/preferencesService');
  return preferencesService.getCompactionSettings();
});

// Actualizar configuración
ipcMain.handle('compaction:settings:update', async (_, settings) => {
  const { preferencesService } = await import('../services/preferencesService');
  const ai = preferencesService.get('ai') || {};
  preferencesService.set('ai', { ...ai, compaction: settings });
});
```

---

## Fase 1: Infraestructura Base

### Objetivo
Crear la estructura de carpetas y archivos base sin funcionalidad.

### Pasos

1. **Crear carpeta de compactación**
   ```bash
   mkdir -p src/main/services/ai/compaction
   ```

2. **Crear archivo de tipos** (`types.ts`)
   - Interfaces: `CompactionSettings`, `CompactionPreparation`, `CompactionResult`
   - Constantes: `DEFAULT_COMPACTION_SETTINGS`, `MODEL_CONTEXT_WINDOWS`
   - Función: `getContextWindow()`

3. **Crear archivo de exports** (`index.ts`)
   - Re-exportar tipos y funciones públicas

4. **Agregar logger de compactación**
   - Modificar `src/main/utils/logger.ts`
   - Agregar: `compaction: createLogger('compaction')`

### Verificación
- [ ] Carpeta `src/main/services/ai/compaction/` existe
- [ ] `types.ts` compila sin errores
- [ ] `index.ts` exporta correctamente
- [ ] Logger funciona: `logger.compaction.info('test')`

---

## Fase 2: Sistema de Tokens

### Objetivo
Implementar conteo y estimación de tokens.

### Pasos

1. **Crear `token-counter.ts`**
   - `estimateTokens(text)` - Heurística chars/4
   - `countMessageTokens(message)` - Para Message de DB
   - `countUIMessageTokens(message)` - Para UIMessage
   - `calculateTotalTokens(messages)` - Suma total
   - `getContextTokensFromUsage(usage)` - Extraer de respuesta LLM

2. **Tests unitarios**
   ```typescript
   // test/compaction/token-counter.test.ts
   describe('estimateTokens', () => {
     it('should estimate ~1 token per 4 chars', () => {
       expect(estimateTokens('1234')).toBe(1);
       expect(estimateTokens('12345678')).toBe(2);
     });
   });
   ```

### Verificación
- [ ] `estimateTokens('hello world')` retorna ~3
- [ ] `countMessageTokens()` maneja todos los campos
- [ ] Tests pasan

---

## Fase 3: Algoritmo de Compactación

### Objetivo
Implementar la lógica core de compactación.

### Pasos

1. **Crear `utils.ts`**
   - `createFileOps()` - Crear objeto vacío
   - `extractFileOpsFromMessage()` - Extraer de tool calls
   - `extractFileOperations()` - De lista de mensajes
   - `mergeFileOperations()` - Combinar previas + actuales
   - `formatFileOperations()` - Formatear como XML
   - `serializeMessagesForSummary()` - Convertir a texto
   - `isToolResult()` - Verificar tipo de mensaje
   - `isValidCutPoint()` - Verificar punto de corte válido

2. **Crear `summarizer.ts`**
   - Prompts del sistema (SUMMARY_SYSTEM_PROMPT, UPDATE_SUMMARY_PROMPT)
   - `generateSummary()` - Llamar LLM para resumen
   - `estimateSummaryTokens()` - Estimar tokens del resultado

3. **Crear `compaction.ts`**
   - `shouldCompact()` - Verificar si necesita compactación
   - `isContextOverflow()` - Detectar error de overflow
   - `findCutPoint()` - Encontrar punto de corte óptimo
   - `prepareCompaction()` - Preparar datos
   - `compact()` - Ejecutar compactación
   - `checkAndCompact()` - Punto de entrada principal

4. **Tests de integración**
   ```typescript
   describe('findCutPoint', () => {
     it('should find valid cut point preserving recent tokens', () => {
       const messages = createMockMessages(50);
       const cutPoint = findCutPoint(messages, 20000);
       expect(cutPoint).not.toBeNull();
       expect(cutPoint!.tokensAfterCut).toBeLessThanOrEqual(25000);
     });
   });
   ```

### Verificación
- [ ] `findCutPoint()` encuentra puntos válidos
- [ ] `prepareCompaction()` separa mensajes correctamente
- [ ] `generateSummary()` produce texto estructurado
- [ ] Tests pasan

---

## Fase 4: Integración con AI Service

### Objetivo
Conectar compactación con el flujo de chat.

### Pasos

1. **Modificar `aiService.ts`**

   a. Importar módulo de compactación:
   ```typescript
   import { checkAndCompact, shouldCompact, ... } from './ai/compaction';
   ```

   b. Antes de `streamText()`:
   ```typescript
   // Compactación preventiva
   if (settings.enabled) {
     const tokens = calculateTotalTokens(dbMessages);
     if (shouldCompact(tokens, getContextWindow(model), settings)) {
       const result = await checkAndCompact(...);
       if (result) {
         yield { type: 'compaction', ... };
         messages = await reloadMessages(...);
       }
     }
   }
   ```

   c. En `onFinish`:
   ```typescript
   // Verificar para próximo mensaje
   if (shouldCompact(usage.promptTokens, ...)) {
     scheduleCompaction(sessionId);
   }
   ```

   d. En catch de errores:
   ```typescript
   if (isContextOverflow(error)) {
     // Compactación de emergencia + retry
   }
   ```

2. **Crear helper `reloadMessagesAfterCompaction()`**
   - Cargar mensajes desde `firstKeptMessageId`
   - Prepender resumen como mensaje del sistema

3. **Agregar tipo de chunk `compaction`**
   ```typescript
   type ChatStreamChunk =
     | { type: 'text-delta'; ... }
     | { type: 'compaction'; summary: string; messagesCompacted: number; }
     | ...;
   ```

### Verificación
- [ ] Compactación se ejecuta cuando tokens > threshold
- [ ] Retry funciona después de overflow
- [ ] UI recibe evento de compactación

---

## Fase 5: Persistencia

### Objetivo
Guardar y recuperar compactaciones de la base de datos.

### Pasos

1. **Crear migración v6** en `databaseService.ts`
   ```sql
   CREATE TABLE compaction_entries (
     id TEXT PRIMARY KEY,
     session_id TEXT NOT NULL,
     summary TEXT NOT NULL,
     first_kept_message_id TEXT NOT NULL,
     tokens_before INTEGER,
     tokens_after INTEGER,
     messages_compacted INTEGER,
     read_files TEXT DEFAULT '[]',
     modified_files TEXT DEFAULT '[]',
     created_at TEXT NOT NULL,
     FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
   );
   ```

2. **Crear `compaction-service.ts`**
   - `saveCompaction()` - Guardar resultado
   - `getLatestCompaction()` - Obtener última compactación
   - `getCompactionHistory()` - Historial completo
   - `deleteSessionCompactions()` - Limpiar al borrar sesión

3. **Modificar `chatService.ts`**
   - Agregar `getMessagesAfterCompaction()`
   - Modificar `deleteSession()` para cascade a compaction_entries

4. **Agregar tipo a `types/database.ts`**
   ```typescript
   export interface CompactionEntry { ... }
   ```

### Verificación
- [ ] Migración se aplica correctamente
- [ ] `saveCompaction()` inserta en DB
- [ ] `getLatestCompaction()` retorna datos correctos
- [ ] Cascade delete funciona

---

## Fase 6: Configuración

### Objetivo
Permitir configuración de compactación por usuario.

### Pasos

1. **Modificar `preferencesService.ts`**
   ```typescript
   interface AIPreferences {
     compaction?: {
       enabled?: boolean;
       reserveTokens?: number;
       keepRecentTokens?: number;
       summaryModel?: string;
     };
   }
   ```

2. **Agregar métodos helper**
   - `getCompactionSettings()`
   - `setCompactionEnabled()`
   - `setCompactionSettings()`

3. **Agregar handlers IPC**
   - `compaction:settings` - Obtener configuración
   - `compaction:settings:update` - Actualizar configuración
   - `compaction:trigger` - Compactación manual
   - `compaction:history` - Historial de sesión

4. **Crear hook React** (opcional)
   ```typescript
   // src/renderer/hooks/useCompactionSettings.ts
   export function useCompactionSettings() {
     const [settings, setSettings] = useState(DEFAULT_SETTINGS);
     // ...
   }
   ```

### Verificación
- [ ] Settings se guardan en ui-preferences.json
- [ ] Settings se cargan al iniciar
- [ ] IPC handlers funcionan
- [ ] Cambios de configuración persisten

---

## Fase 7: UI y Notificaciones

### Objetivo
Mostrar feedback al usuario sobre compactaciones.

### Pasos

1. **Agregar notificación de compactación**

   En el componente de chat, manejar evento:
   ```typescript
   case 'compaction':
     showNotification({
       type: 'info',
       message: `Conversation compacted: ${chunk.messagesCompacted} messages summarized`,
     });
     break;
   ```

2. **Agregar indicador en sesión** (opcional)
   - Mostrar badge si sesión tiene compactaciones
   - Tooltip con stats de compactación

3. **Panel de configuración** (opcional)
   - Toggle para habilitar/deshabilitar
   - Sliders para reserveTokens y keepRecentTokens
   - Selector de modelo para resúmenes

4. **Historial de compactaciones** (opcional)
   - Vista de compactaciones de la sesión
   - Mostrar resumen, tokens ahorrados, archivos

### Verificación
- [ ] Notificación aparece al compactar
- [ ] Panel de settings funciona
- [ ] Historial muestra datos correctos

---

## Fase 8: Testing

### Objetivo
Asegurar que el sistema funciona correctamente.

### Pasos

1. **Tests unitarios**
   ```
   test/compaction/
   ├── token-counter.test.ts
   ├── utils.test.ts
   ├── compaction.test.ts
   └── summarizer.test.ts
   ```

2. **Tests de integración**
   ```typescript
   describe('Auto-compaction flow', () => {
     it('should compact when threshold exceeded', async () => {
       // Setup: crear sesión con muchos mensajes
       // Action: enviar mensaje que exceda threshold
       // Assert: compactación se ejecutó
     });

     it('should recover from context overflow', async () => {
       // Setup: forzar overflow
       // Action: enviar mensaje
       // Assert: compactación + retry exitoso
     });
   });
   ```

3. **Tests E2E**
   - Conversación larga → compactación automática
   - Compactación manual → resumen correcto
   - Persistencia → compactación sobrevive restart

### Verificación
- [ ] Tests unitarios pasan
- [ ] Tests de integración pasan
- [ ] Tests E2E pasan
- [ ] Coverage > 80%

---

## Checklist Final

### Archivos Creados
- [ ] `src/main/services/ai/compaction/index.ts`
- [ ] `src/main/services/ai/compaction/types.ts`
- [ ] `src/main/services/ai/compaction/token-counter.ts`
- [ ] `src/main/services/ai/compaction/utils.ts`
- [ ] `src/main/services/ai/compaction/summarizer.ts`
- [ ] `src/main/services/ai/compaction/compaction.ts`
- [ ] `src/main/services/ai/compaction/compaction-service.ts`

### Archivos Modificados
- [ ] `src/main/services/databaseService.ts` (migración v6)
- [ ] `src/main/services/aiService.ts` (integración)
- [ ] `src/main/services/preferencesService.ts` (settings)
- [ ] `src/main/services/chatService.ts` (reload messages)
- [ ] `src/main/utils/logger.ts` (compaction logger)
- [ ] `src/types/database.ts` (CompactionEntry type)
- [ ] `src/main/ipc/handlers.ts` (IPC handlers)
- [ ] `src/renderer/components/Chat/` (notificaciones)

### Funcionalidades
- [ ] Compactación automática por threshold
- [ ] Compactación por overflow + retry
- [ ] Compactación manual
- [ ] Persistencia de compactaciones
- [ ] Configuración de usuario
- [ ] Notificaciones en UI
- [ ] Tests completos

### Verificaciones de Calidad
- [ ] No hay regresiones en chat normal
- [ ] Rendimiento aceptable (< 5s para compactar)
- [ ] Resúmenes son útiles y coherentes
- [ ] Manejo correcto de errores
- [ ] Logs informativos

---

## Notas de Implementación

### Diferencias con pi-mono

1. **Sin branches**: Levante no tiene sistema de branches, así que `branch-summarization.ts` no se migra.

2. **SQLite vs JSON**: pi-mono usa archivos JSON para sesiones, Levante usa SQLite. Esto simplifica algunas operaciones pero requiere migraciones.

3. **Vercel AI SDK**: Los hooks son diferentes. pi-mono tiene eventos custom, Levante usa `onFinish` callback.

4. **Sin AgentSession**: La lógica de pi-mono's `AgentSession._runAutoCompaction()` se integra directamente en `aiService.streamChat()`.

### Consideraciones de Rendimiento

1. **Estimación vs Conteo Real**: Usamos heurística chars/4 en lugar de tiktoken para evitar dependencia pesada. Para mayor precisión, considerar `js-tiktoken`.

2. **Compactación Asíncrona**: Para no bloquear la respuesta, la compactación post-respuesta puede programarse para el próximo mensaje.

3. **Cache de Tokens**: Considerar guardar token count en tabla messages para evitar recalcular.

### Posibles Mejoras Futuras

1. **Tiktoken real**: Integrar `js-tiktoken` para conteo preciso por modelo.

2. **Compactación incremental**: En lugar de un solo resumen, mantener múltiples niveles de resúmenes.

3. **Archivado de mensajes**: Mover mensajes antiguos a tabla separada en lugar de solo resumir.

4. **Compactación selectiva**: Permitir al usuario elegir qué mensajes preservar.

---

*Documento generado para Levante basado en análisis de pi-mono v0.53.0*
