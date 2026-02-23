# Plan de Recuperación: Sistema de Tool Approval

**Fecha:** 2026-02-23

---

## Contexto histórico

### Lo que ocurrió

| Commit | Fecha | Acción |
|--------|-------|--------|
| `9b031a0` | 17 Jan 2026 | **PR #173 mergeado**: Sistema completo de tool approval con UI (Aprobar / Denegar / Aprobar para sesión) |
| `ed2013e` | 17 Jan 2026 | **PR #173 revertido**: Todo el sistema fue eliminado el mismo día |
| `73af7ad` | 18 Feb 2026 | **PR #193 mergeado**: Re-añadida únicamente la configuración `skipApproval` por proveedor (sin UI de aprobación) |

### El estado actual

PR #193 introdujo `needsApproval: !skipApproval` en `mcpToolsAdapter.ts`, pero sin la infraestructura para gestionar la aprobación. Resultado:
- `needsApproval: true` por defecto → el AI SDK no ejecuta las tools → stream se completa sin resultados → tools quedan en "Ejecutando..." para siempre
- No hay UI de approve/deny porque la lógica del renderer fue revertida en `ed2013e`

### ¿Por qué se revertió PR #173?

Los bugs documentados dentro del propio PR (todos resueltos antes del merge):
1. **Bucle infinito en la denegación**: Fix en `398ba6b` — al denegar una tool, el AI SDK reintentaba indefinidamente. Solución: `sendAutomaticallyWhen` solo devuelve `true` si **todas** las respuestas son aprobaciones.
2. **Error 500 en Anthropic al denegar**: Fix en `398ba6b` — Anthropic requiere `tool_result` para cada `tool_use`. Si la tool se deniega sin generar resultado, la API falla. Solución: convertir los parts denegados a `output-available` con mensaje `"Tool execution was denied by the user."` en `sanitizeMessagesForModel`.
3. **Reset de estado incorrecto**: Fix en PR #173 — emitir `tool-input-start` antes de `tool-approval-request` reseteaba el part. Solución: no emitir `tool-input-start` para tools que necesitan aprobación.

> La razón exacta del revert no está en el código, pero dado que todos los bugs conocidos estaban corregidos dentro del mismo PR antes del merge, el revert pudo deberse a una decisión de diseño o conflicto de merge con `develop`.

---

## Archivos que deben restaurarse / crearse

### Archivos a crear (eliminados en `ed2013e`)

| Archivo | Origen en PR #173 |
|---------|-------------------|
| `src/renderer/components/ai-elements/tool-approval.tsx` | Commit `dec5af8` (versión final con i18n) |
| `src/renderer/hooks/useToolAutoApproval.ts` | Commit `fc47284` |

### Archivos a modificar (volver a estado de PR #173)

| Archivo | Qué restaurar |
|---------|---------------|
| `src/preload/types/index.ts` | Campo `toolApproval` en `ChatStreamChunk` |
| `src/main/services/aiService.ts` | `case "tool-approval-request":` en el switch del fullStream; handler del denial en `sanitizeMessagesForModel` |
| `src/renderer/transports/ElectronChatTransport.ts` | Conversión de `chunk.toolApproval` → chunk `tool-approval-request` |
| `src/renderer/pages/ChatPage.tsx` | `addToolApprovalResponse` de `useChat`; `sendAutomaticallyWhen`; import y uso de `useToolAutoApproval` |
| `src/renderer/components/chat/ChatMessageItem.tsx` | Renderizado condicional de `ToolApprovalInline` cuando `state === 'approval-requested'` |
| `src/renderer/locales/en/chat.json` | Strings de i18n para tool approval |
| `src/renderer/locales/es/chat.json` | Strings de i18n para tool approval |

---

## Plan de implementación paso a paso

### Paso 1 — Tipos: añadir `toolApproval` a `ChatStreamChunk`

**Archivo:** `src/preload/types/index.ts`

Añadir el campo `toolApproval` a la interfaz `ChatStreamChunk`:

```typescript
export interface ChatStreamChunk {
  delta?: string;
  done?: boolean;
  error?: string;
  parts?: Array<any>;
  sources?: Array<{ url: string; title?: string }>;
  reasoningText?: string;
  reasoningId?: string;
  toolCall?: { ... };
  toolResult?: { ... };
  // NUEVO
  toolApproval?: {
    approvalId: string;
    toolCallId: string;
    toolName: string;
    input: Record<string, any>;
  };
  generatedAttachment?: { ... };
}
```

---

### Paso 2 — Main process: manejar el chunk `tool-approval-request`

**Archivo:** `src/main/services/aiService.ts`

En el switch sobre `result.fullStream`, añadir antes del `case "tool-call"`:

```typescript
case "tool-approval-request":
  const approvalChunk = chunk as {
    type: string;
    approvalId: string;
    toolCall?: {
      toolCallId: string;
      toolName: string;
      input?: Record<string, unknown>;
    };
  };

  // Garantizar que input NUNCA sea undefined (Anthropic lo requiere)
  const toolInput = approvalChunk.toolCall?.input ?? {};

  yield {
    toolApproval: {
      approvalId: approvalChunk.approvalId,
      toolCallId: approvalChunk.toolCall?.toolCallId ?? '',
      toolName: approvalChunk.toolCall?.toolName ?? '',
      input: toolInput,
    },
  };
  break;
```

**Nota crítica:** Este case debe ir ANTES del `case "tool-call"` para que el routing sea correcto. El AI SDK emite `tool-approval-request` en lugar de ejecutar la tool; el `tool-call` chunk puede o no aparecer según la versión del SDK.

---

### Paso 3 — Main process: fix denial en `sanitizeMessagesForModel`

**Archivo:** `src/main/services/aiService.ts`

En la función `sanitizeMessagesForModel` (o donde se preparan los mensajes para el modelo), convertir los parts en estado `approval-responded` con `approved: false` a `output-available`:

```typescript
// Al iterar los parts del mensaje:
if (part.state === 'approval-responded') {
  const wasDenied = part.approval?.approved === false;
  if (wasDenied) {
    // Generar un tool_result válido para Anthropic/OpenRouter
    // Sin esto, la API devuelve 500 porque tool_use no tiene tool_result
    part = {
      ...part,
      state: 'output-available',
      output: 'Tool execution was denied by the user.',
    };
  }
}
```

**¿Por qué?** Anthropic requiere que cada `tool_use` tenga su correspondiente `tool_result`. Si el usuario deniega sin generar resultado, la siguiente request a la API falla con 500.

---

### Paso 4 — Transport: convertir `toolApproval` a UIMessageChunk

**Archivo:** `src/renderer/transports/ElectronChatTransport.ts`

En el método `convertChunkToUIMessageChunks`, añadir ANTES del handler de `chunk.toolCall`:

```typescript
// Handle tool approval requests (for needsApproval: true tools)
if (chunk.toolApproval) {
  const safeInput = chunk.toolApproval.input ?? {};

  // IMPORTANTE: NO emitir tool-input-start aquí.
  // Si se emite tool-input-start antes de tool-approval-request,
  // el part se resetea a 'input-streaming' y el estado 'approval-requested'
  // nunca llega al componente.

  yield {
    type: "tool-approval-request",
    toolCallId: chunk.toolApproval.toolCallId,
    toolName: chunk.toolApproval.toolName,
    approvalId: chunk.toolApproval.approvalId,
    input: safeInput,
    toolCall: {
      toolCallId: chunk.toolApproval.toolCallId,
      toolName: chunk.toolApproval.toolName,
      input: safeInput,
    },
  } as any;
}
```

---

### Paso 5 — Crear `tool-approval.tsx` (componente UI)

**Archivo nuevo:** `src/renderer/components/ai-elements/tool-approval.tsx`

Componente con botones Denegar / Aprobar / Aprobar para sesión:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Wrench, X, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { CodeBlock } from './code-block';

interface ToolApprovalInlineProps {
  toolName: string;         // Formato: serverId_toolName
  input: Record<string, unknown>;
  approvalId: string;
  onApprove: () => void;
  onDeny: () => void;
  onApproveForSession?: (serverId: string) => void;
  className?: string;
}

export function ToolApprovalInline({
  toolName, input, approvalId, onApprove, onDeny, onApproveForSession, className
}: ToolApprovalInlineProps) {
  const { t } = useTranslation('chat');
  const [showDetails, setShowDetails] = useState(false);

  const displayToolName = toolName.includes('_')
    ? toolName.split('_').slice(1).join('_')
    : toolName;
  const serverId = toolName.includes('_') ? toolName.split('_')[0] : 'unknown';

  const handleApproveForSession = () => {
    onApprove();
    onApproveForSession?.(serverId);
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center gap-2 text-sm">
        <Wrench className="w-4 h-4 text-muted-foreground" />
        <span className="font-mono font-medium">{displayToolName}</span>
        <Badge variant="outline" className="text-xs">{serverId}</Badge>
      </div>

      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {showDetails ? t('tool_approval.hide_parameters') : t('tool_approval.show_parameters')}
      </button>

      {showDetails && (
        <div className="rounded-md border overflow-hidden">
          <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onDeny} className="gap-1">
          <X className="w-3 h-3" />
          {t('tool_approval.deny')}
        </Button>
        <Button variant="outline" size="sm" onClick={onApprove} className="gap-1">
          <Check className="w-3 h-3" />
          {t('tool_approval.approve')}
        </Button>
        {onApproveForSession && (
          <Button size="sm" onClick={handleApproveForSession} className="gap-1">
            <Check className="w-3 h-3" />
            {t('tool_approval.approve_for_session')}
          </Button>
        )}
      </div>
    </div>
  );
}
```

---

### Paso 6 — Crear `useToolAutoApproval.ts` (hook de auto-aprobación)

**Archivo nuevo:** `src/renderer/hooks/useToolAutoApproval.ts`

```typescript
import { useState, useCallback } from 'react';

interface UseToolAutoApprovalReturn {
  autoApprovedServers: Set<string>;
  approveServerForSession: (serverId: string) => void;
  isServerAutoApproved: (serverId: string) => boolean;
  clearAutoApprovals: () => void;
}

export function useToolAutoApproval(): UseToolAutoApprovalReturn {
  const [autoApprovedServers, setAutoApprovedServers] = useState<Set<string>>(new Set());

  const approveServerForSession = useCallback((serverId: string) => {
    setAutoApprovedServers(prev => new Set([...prev, serverId]));
  }, []);

  const isServerAutoApproved = useCallback((serverId: string) => {
    return autoApprovedServers.has(serverId);
  }, [autoApprovedServers]);

  const clearAutoApprovals = useCallback(() => {
    setAutoApprovedServers(new Set());
  }, []);

  return { autoApprovedServers, approveServerForSession, isServerAutoApproved, clearAutoApprovals };
}

export function extractServerIdFromToolName(toolName: string): string {
  return toolName.includes('_') ? toolName.split('_')[0] : 'unknown';
}
```

---

### Paso 7 — `ChatPage.tsx`: `useChat` con `addToolApprovalResponse` y `sendAutomaticallyWhen`

**Archivo:** `src/renderer/pages/ChatPage.tsx`

**7a. Import del hook:**
```typescript
import { useToolAutoApproval } from '@/hooks/useToolAutoApproval';
```

**7b. Usar el hook:**
```typescript
const { approveServerForSession, isServerAutoApproved, clearAutoApprovals } = useToolAutoApproval();
```

**7c. Añadir `addToolApprovalResponse` y `sendAutomaticallyWhen` a `useChat`:**

```typescript
const {
  messages,
  setMessages,
  sendMessage: sendMessageAI,
  status,
  stop,
  error: chatError,
  addToolApprovalResponse,  // ← NUEVO
} = useChat({
  id: currentSession?.id || 'new-chat',
  transport,

  // CRÍTICO: Solo re-enviar automáticamente si TODAS las tools fueron APROBADAS.
  // Si alguna fue denegada, NO re-enviar (respetamos la decisión del usuario).
  sendAutomaticallyWhen: ({ messages }) => {
    const lastAssistant = messages.slice().reverse().find(m => m.role === 'assistant');
    if (!lastAssistant) return false;

    const toolParts = lastAssistant.parts?.filter((p: any) => p.type?.startsWith('tool-')) || [];
    const approvalParts = toolParts.filter((p: any) => p.state === 'approval-responded' && p.approval);
    if (approvalParts.length === 0) return false;

    return approvalParts.every((p: any) => p.approval.approved === true);
  },

  onFinish: async ({ message }) => { /* ... igual que ahora ... */ },
});
```

**7d. Limpiar auto-aprobaciones al cambiar de sesión:**
```typescript
// En el useEffect que detecta cambio de sesión:
clearAutoApprovals();
```

**7e. Pasar callbacks a `ChatMessageItem`:**
```typescript
<ChatMessageItem
  // ... props existentes ...
  addToolApprovalResponse={addToolApprovalResponse}
  onApproveServerForSession={approveServerForSession}
  isServerAutoApproved={isServerAutoApproved}
/>
```

---

### Paso 8 — `ChatMessageItem.tsx`: renderizar UI de aprobación

**Archivo:** `src/renderer/components/chat/ChatMessageItem.tsx`

**8a. Import:**
```typescript
import { ToolApprovalInline } from '@/components/ai-elements/tool-approval';
```

**8b. Añadir props a la interfaz del componente:**
```typescript
interface ChatMessageItemProps {
  // ... props existentes ...
  addToolApprovalResponse?: (response: { id: string; approved: boolean }) => void;
  onApproveServerForSession?: (serverId: string) => void;
  isServerAutoApproved?: (serverId: string) => boolean;
}
```

**8c. En el renderizado de parts, añadir antes del renderizado de `ToolCallPart`:**

```typescript
if (part?.type?.startsWith('tool-')) {
  // Si está esperando aprobación → mostrar UI de aprobación
  if (part.state === 'approval-requested' && addToolApprovalResponse) {
    const toolName = part.toolName || part.type.replace(/^tool-/, '');
    const serverId = toolName.includes('_') ? toolName.split('_')[0] : 'unknown';

    // Auto-aprobación para servidores pre-aprobados en la sesión
    if (isServerAutoApproved?.(serverId)) {
      queueMicrotask(() => {
        addToolApprovalResponse({
          id: part.approval?.id || part.toolCallId,
          approved: true,
        });
      });

      return (
        <div key={`${message.id}-${i}`} className="flex items-center gap-2 text-sm text-muted-foreground">
          <Check className="w-4 h-4 text-green-500" />
          <span>Auto-aprobado: {toolName.split('_').slice(1).join('_')}</span>
          <Badge variant="outline" className="text-xs">{serverId}</Badge>
        </div>
      );
    }

    return (
      <ToolApprovalInline
        key={`${message.id}-${i}`}
        toolName={toolName}
        input={part.input || {}}
        approvalId={part.approval?.id || part.toolCallId}
        onApprove={() => addToolApprovalResponse({ id: part.approval?.id || part.toolCallId, approved: true })}
        onDeny={() => addToolApprovalResponse({ id: part.approval?.id || part.toolCallId, approved: false })}
        onApproveForSession={onApproveServerForSession}
      />
    );
  }

  // Estado normal (input-streaming, output-available, etc.)
  return (
    <ToolCallPart key={...} part={part} ... />
  );
}
```

---

### Paso 9 — Strings de i18n

**`src/renderer/locales/en/chat.json`** — añadir bajo la clave `"tool_approval"`:
```json
"tool_approval": {
  "show_parameters": "Show parameters",
  "hide_parameters": "Hide parameters",
  "deny": "Deny",
  "approve": "Approve",
  "approve_for_session": "Approve for session"
}
```

**`src/renderer/locales/es/chat.json`**:
```json
"tool_approval": {
  "show_parameters": "Ver parámetros",
  "hide_parameters": "Ocultar parámetros",
  "deny": "Denegar",
  "approve": "Aprobar",
  "approve_for_session": "Aprobar para esta sesión"
}
```

---

## Orden de implementación recomendado

```
1. Paso 1  → preload/types/index.ts          (sin dependencias)
2. Paso 5  → tool-approval.tsx               (sin dependencias del resto del plan)
3. Paso 6  → useToolAutoApproval.ts          (sin dependencias del resto del plan)
4. Paso 9  → locales en/es                  (sin dependencias)
5. Paso 2  → aiService.ts (case approval)    (depende de Paso 1)
6. Paso 3  → aiService.ts (denial fix)       (depende de Paso 2)
7. Paso 4  → ElectronChatTransport.ts        (depende de Paso 1)
8. Paso 8  → ChatMessageItem.tsx             (depende de Pasos 5 y 6)
9. Paso 7  → ChatPage.tsx                    (depende de Pasos 6 y 8)
```

---

## Bugs conocidos a evitar (aprendizajes del PR #173)

### Bug 1: Bucle infinito al denegar

**Síntoma:** Al denegar una tool, el AI SDK reintenta automáticamente de forma infinita.

**Causa:** Sin `sendAutomaticallyWhen`, el AI SDK re-envía el mensaje automáticamente cuando hay approval responses.

**Fix:** `sendAutomaticallyWhen` solo devuelve `true` si **TODAS** las respuestas son aprobaciones (`approved: true`). Si alguna es denegación, retorna `false`.

---

### Bug 2: Error 500 de Anthropic al denegar

**Síntoma:** Después de denegar una tool y continuar el chat, Anthropic devuelve 500.

**Causa:** El protocolo Anthropic requiere que cada `tool_use` tenga exactamente un `tool_result`. Si el usuario deniega sin generar resultado, la siguiente request no incluye el `tool_result` requerido.

**Fix:** En `sanitizeMessagesForModel`, detectar parts en estado `approval-responded` con `approved: false` y convertirlos a `output-available` con output `"Tool execution was denied by the user."` antes de generar los mensajes para la API.

---

### Bug 3: Reset de estado al emitir `tool-input-start`

**Síntoma:** Las tools que necesitan aprobación nunca llegan al estado `approval-requested`; quedan en `input-streaming`.

**Causa:** Si en `ElectronChatTransport` se emite `tool-input-start` antes de `tool-approval-request`, el AI SDK resetea el part al estado inicial, impidiendo la transición a `approval-requested`.

**Fix:** El handler de `chunk.toolApproval` en el transport NO debe emitir `tool-input-start`. Solo emitir el chunk `tool-approval-request` directamente.

---

## Compatibilidad con `skipApproval` (PR #193)

El sistema de PR #193 (configurar proveedores sin aprobación) es compatible con la recuperación del flujo de aprobación. Se mantiene la lógica existente:

- Si el proveedor está en `providersWithoutToolApproval` → `skipApproval=true` → `needsApproval=false` → tools se ejecutan automáticamente (comportamiento actual que funciona)
- Si el proveedor NO está configurado → `needsApproval=true` → aparece la UI de Aprobar/Denegar (comportamiento a recuperar)

No hay que eliminar nada de PR #193, solo añadir la infraestructura de aprobación sobre él.

---

## Referencia a commits clave

Para implementar, se pueden recuperar los diffs exactos de:

| Funcionalidad | Commit de referencia |
|---------------|----------------------|
| UI base de aprobación | `dec5af8` (versión final con i18n) |
| Session auto-approval hook | `fc47284` |
| Fix bucle infinito y error Anthropic | `398ba6b` |
| Case tool-approval-request en aiService | `9b031a0` |
| Transport: chunk toolApproval | `9b031a0` |
| ChatPage: addToolApprovalResponse | `9b031a0` + `398ba6b` |
| ChatMessageItem: renderizado condicional | `9b031a0` + `fc47284` |
