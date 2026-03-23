# Runbook de implementacion: correccion de `Tool results are missing for tool calls` en aprobacion parcial

## Objetivo

Corregir el fallo que aparece cuando el modelo genera multiples tool calls paralelas que requieren aprobacion y el usuario responde una parte de ellas antes que el resto.

Error observado:

```text
Tool results are missing for tool calls call_z1EWZgGiRNJ3nmrKlzTmd1zr, call_u5l7Xy1JRVmFH63TQ6VdjRTX.
```

## Resultado esperado

Tras aplicar este runbook:

1. El chat no debe reenviar automaticamente mientras exista alguna tool del ultimo step en `approval-requested`.
2. Si hay mezcla de aprobaciones y denegaciones, el reenvio automatico debe ocurrir solo cuando todas las approvals del ultimo step hayan sido respondidas y exista al menos una aprobada.
3. Si todas las tools fueron denegadas, no debe haber auto-send.
4. Si por cualquier motivo llegan estados incompletos al main process, el backend debe convertirlos a estados finales validos para `convertToModelMessages`.
5. Deben existir tests unitarios que cubran el bug y los casos limite principales.

---

## Resumen de la causa raiz

Hay dos problemas reales:

1. `sendAutomaticallyWhen` en `src/renderer/pages/ChatPage.tsx` dispara demasiado pronto.
   La implementacion actual devuelve `true` en cuanto encuentra una tool ya respondida y aprobada, aunque otras tools del mismo step sigan en `approval-requested`.

2. `sanitizeMessagesForModel` en `src/main/services/aiService.ts` no normaliza todos los estados incompletos.
   Si un mensaje llega al backend con tools en `approval-requested`, `input-available` o `input-streaming`, `convertToModelMessages` puede construir una conversacion invalida con `tool_call` sin `tool_result`.

Importante:

- El AI SDK ya ofrece `lastAssistantMessageIsCompleteWithApprovalResponses`.
- El AI SDK ya soporta `output-denied` en `convertToModelMessages`.
- Este fix no debe reimplementar la semantica del SDK de forma parcial si existe helper oficial.

---

## Decision de implementacion

La correccion debe aplicarse en dos capas:

1. Renderer:
   Reemplazar la logica ad hoc de `sendAutomaticallyWhen` por una funcion basada en el helper oficial `lastAssistantMessageIsCompleteWithApprovalResponses`, anadiendo solo la regla de producto local: no auto-enviar si todas las tools del ultimo step fueron denegadas.

2. Main process:
   Endurecer `sanitizeMessagesForModel` para transformar estados incompletos en estados finales compatibles con `convertToModelMessages`.

No usar `ignoreIncompleteToolCalls` como solucion principal.
Ese flag solo ocultaria el problema descartando tool calls incompletas y puede enmascarar errores reales de flujo.

---

## Archivos a modificar

| Archivo | Accion |
|---|---|
| `src/renderer/pages/ChatPage.tsx` | Sustituir la logica inline de `sendAutomaticallyWhen` |
| `src/renderer/utils/toolApprovalAutoSend.ts` | Crear helper puro y testeable para decidir el auto-send |
| `src/renderer/utils/__tests__/toolApprovalAutoSend.test.ts` | Anadir tests del predicado de auto-send |
| `src/main/services/aiService.ts` | Importar el sanitizador y mantener el flujo actual |
| `src/main/services/ai/toolMessageSanitizer.ts` | Extraer y corregir `sanitizeMessagesForModel` |
| `src/main/services/ai/__tests__/toolMessageSanitizer.test.ts` | Anadir tests del sanitizador |

Si durante la implementacion ya existe una carpeta de tests mas apropiada en el mismo dominio, mantener la convencion del repo. Lo importante es que los tests queden junto al modulo nuevo y no dependan del archivo monolitico `aiService.ts`.

---

## Fase 1: corregir el auto-send en renderer

### 1. Crear helper dedicado

Crear `src/renderer/utils/toolApprovalAutoSend.ts`.

Debe exportar una funcion:

```typescript
import {
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from 'ai';

export function shouldAutoSendAfterApproval(messages: UIMessage[]): boolean {
  if (!lastAssistantMessageIsCompleteWithApprovalResponses({ messages })) {
    return false;
  }

  const message = messages[messages.length - 1];
  if (!message || message.role !== 'assistant') {
    return false;
  }

  const lastStepStartIndex = message.parts.reduce((lastIndex, part, index) => {
    return part.type === 'step-start' ? index : lastIndex;
  }, -1);

  const lastStepToolParts = message.parts
    .slice(lastStepStartIndex + 1)
    .filter(isToolUIPart)
    .filter(part => !part.providerExecuted);

  return lastStepToolParts.some(
    part =>
      part.state === 'approval-responded' &&
      part.approval?.approved === true,
  );
}
```

### 2. Motivo de esta implementacion

Esta funcion hace dos cosas distintas y ambas son necesarias:

1. `lastAssistantMessageIsCompleteWithApprovalResponses` garantiza la condicion correcta de completitud del ultimo step.
   Eso evita reproducir mal la logica del SDK.

2. El `some(...approved === true)` aplica la regla de producto de Levante.
   Si todas las tools fueron denegadas, el chat no debe continuar automaticamente.

### 3. Reemplazar la logica inline en `ChatPage.tsx`

En `src/renderer/pages/ChatPage.tsx`:

1. Anadir import del helper:

```typescript
import { shouldAutoSendAfterApproval } from '@/utils/toolApprovalAutoSend';
```

Si el alias correcto del proyecto para utilidades renderer es distinto, usar el alias existente del repo.

2. Reemplazar el bloque actual de `sendAutomaticallyWhen` por:

```typescript
sendAutomaticallyWhen: ({ messages }) => {
  return shouldAutoSendAfterApproval(messages);
},
```

### 4. Comportamiento requerido despues del cambio

Debe cumplirse lo siguiente:

- 1 aprobada y 2 pendientes: `false`
- 2 aprobadas y 1 denegada, todas respondidas: `true`
- 3 denegadas: `false`
- tools de steps anteriores: no influyen
- `dynamic-tool`: debe estar soportada si el SDK la clasifica como tool part
- `providerExecuted`: debe quedar fuera de la decision, igual que hace el helper oficial

---

## Fase 2: endurecer el saneado de mensajes en main

### 1. Extraer el sanitizador a un modulo propio

Crear `src/main/services/ai/toolMessageSanitizer.ts`.

Mover ahi la logica actual de `sanitizeMessagesForModel(messages: UIMessage[]): UIMessage[]` y exportarla.

El objetivo de la extraccion es:

- reducir acoplamiento con `aiService.ts`
- permitir tests puros
- dejar la normalizacion de estados tool en un unico lugar

### 2. Reglas obligatorias del sanitizador

El sanitizador debe aplicar estas transformaciones:

| Estado de entrada | Estado de salida | Motivo |
|---|---|---|
| `approval-responded` con `approved=false` | `output-denied` | El SDK ya sabe convertirlo a `tool-result` valido |
| `approval-requested` | `output-denied` | Fallback defensivo si una approval pendiente cruza al backend |
| `input-available` | `output-error` | La tool quedo interrumpida antes de producir resultado |
| `input-streaming` | `output-error` | La tool quedo interrumpida antes de producir resultado |

### 3. No convertir fallbacks a `output-available`

No usar mensajes sinteticos con `state: 'output-available'` para estados pendientes o interrumpidos.

Eso seria semanticamente incorrecto porque:

- una approval pendiente no es una ejecucion exitosa
- una tool interrumpida no es una ejecucion exitosa
- el modelo recibe mejor contexto si el resultado es error o denegacion real

### 4. Implementacion de referencia

La version corregida del sanitizador debe contener al menos esta logica:

```typescript
import { type UIMessage } from 'ai';

export function sanitizeMessagesForModel(messages: UIMessage[]): UIMessage[] {
  const clonedMessages = JSON.parse(JSON.stringify(messages));

  return clonedMessages.map((message: any) => {
    const parts = message.parts;
    if (!Array.isArray(parts)) return message;

    const sanitizedParts = parts.map((part: any) => {
      if (!part) return part;

      if (
        part.state === 'approval-responded' &&
        part.approval?.approved === false
      ) {
        part = {
          ...part,
          state: 'output-denied',
          approval: {
            ...part.approval,
            approved: false,
          },
        };
        delete part.output;
        delete part.errorText;
      }

      if (part.state === 'approval-requested') {
        part = {
          ...part,
          state: 'output-denied',
          approval: {
            id: part.approval?.id ?? `pending-${part.toolCallId ?? 'unknown'}`,
            approved: false,
            reason:
              part.approval?.reason ??
              'Tool execution did not run because approval was still pending.',
          },
        };
        delete part.output;
        delete part.errorText;
      }

      if (
        part.state === 'input-available' ||
        part.state === 'input-streaming'
      ) {
        part = {
          ...part,
          state: 'output-error',
          errorText:
            'Tool execution was interrupted before producing a result.',
        };
        delete part.output;
      }

      return part;
    });

    return {
      ...message,
      parts: sanitizedParts,
    };
  }) as UIMessage[];
}
```

### 5. Integrar el nuevo modulo en `aiService.ts`

En `src/main/services/aiService.ts`:

1. Eliminar la implementacion local de `sanitizeMessagesForModel`
2. Importar la funcion desde `./ai/toolMessageSanitizer`
3. Mantener sin cambios el orden actual del pipeline:

```typescript
const { updatedMessages, executedTools } = await preExecuteApprovedTools(
  messagesWithFileParts,
  tools
);

const sanitizedMessages = sanitizeMessagesForModel(updatedMessages);
const modelMessages = await convertToModelMessages(sanitizedMessages);
```

Ese orden es correcto:

- primero se ejecutan tools ya aprobadas
- despues se normalizan estados residuales
- por ultimo se convierten a `ModelMessage`

---

## Fase 3: tests obligatorios

Este fix no se considera listo sin tests unitarios.

### 1. Test del predicado de auto-send

Crear `src/renderer/utils/__tests__/toolApprovalAutoSend.test.ts`.

Casos minimos:

1. Devuelve `false` si una tool del ultimo step sigue en `approval-requested`
2. Devuelve `true` si todas las tools del ultimo step ya fueron respondidas y al menos una fue aprobada
3. Devuelve `false` si todas las tools del ultimo step fueron denegadas
4. Ignora tools de steps anteriores
5. Ignora tools con `providerExecuted === true`
6. Soporta `dynamic-tool` si aparece en el mensaje

Estructura sugerida:

```typescript
import { describe, it, expect } from 'vitest';
import type { UIMessage } from 'ai';
import { shouldAutoSendAfterApproval } from '../toolApprovalAutoSend';
```

### 2. Test del sanitizador

Crear `src/main/services/ai/__tests__/toolMessageSanitizer.test.ts`.

Casos minimos:

1. `approval-responded` con `approved=false` se convierte a `output-denied`
2. `approval-requested` se convierte a `output-denied` con reason fallback
3. `input-available` se convierte a `output-error`
4. `input-streaming` se convierte a `output-error`
5. Un `output-available` valido no se altera innecesariamente

Estructura sugerida:

```typescript
import { describe, it, expect } from 'vitest';
import type { UIMessage } from 'ai';
import { sanitizeMessagesForModel } from '../toolMessageSanitizer';
```

### 3. Comandos de verificacion automatica

Ejecutar:

```bash
pnpm typecheck
pnpm test -- toolApprovalAutoSend
pnpm test -- toolMessageSanitizer
```

Si el filtro de `vitest` del repo no funciona con ese formato, ejecutar directamente:

```bash
pnpm test
```

---

## Fase 4: validacion manual

### Escenario principal

1. Abrir Levante en modo Cowork con proyecto configurado
2. Pedir al modelo que lance multiples comandos `bash` en paralelo
3. Esperar a que aparezcan varias approvals
4. Aprobar una y dejar otras pendientes
5. Verificar que no se envia request automaticamente
6. Responder el resto mezclando aprobacion y denegacion
7. Verificar que solo entonces se reenvia y no aparece el error de tool results missing

### Escenarios adicionales

1. Denegar todas las tools
   Resultado esperado: no hay auto-send

2. Aprobar todas las tools
   Resultado esperado: hay auto-send normal

3. Generar varias tools en steps consecutivos
   Resultado esperado: la decision de auto-send solo usa el ultimo step

4. Interrumpir el flujo antes de completar todas las tools
   Resultado esperado: el backend normaliza estados incompletos y no revienta `convertToModelMessages`

---

## Criterios de aceptacion

El fix esta listo solo si se cumplen todos estos puntos:

1. Se usa el helper oficial `lastAssistantMessageIsCompleteWithApprovalResponses`
2. La regla de "no auto-send si todas fueron denegadas" queda implementada encima de ese helper
3. El backend convierte denegaciones a `output-denied`
4. El backend convierte estados `input-*` a `output-error`
5. No se usa `output-available` para representar pending approvals o ejecuciones interrumpidas
6. Existen tests unitarios del predicado renderer y del sanitizador backend
7. `pnpm typecheck` pasa
8. La reproduccion manual original deja de fallar

---

## Notas de implementacion

### Sobre `output-denied`

`convertToModelMessages` del AI SDK ya soporta `output-denied` y genera un `tool-result` valido con texto de error.
Por tanto, esta es la representacion correcta para approvals denegadas o approvals pendientes que llegan indebidamente al backend.

### Sobre `preExecuteApprovedTools`

No hace falta reescribir `preExecuteApprovedTools` para este fix.
Su responsabilidad actual sigue siendo correcta: ejecutar las tools ya aprobadas antes de convertir los mensajes.

### Sobre la condicion de carrera

El bug original existe porque el reenvio se decide antes de que todas las approvals hayan pasado de `approval-requested` a `approval-responded`.
La correccion del renderer elimina esa ventana de carrera desde el origen.
El sanitizador backend queda como defensa en profundidad, no como mecanismo principal.

### Sobre cambios fuera de alcance

No modificar `node_modules`.
No introducir workarounds basados en descartar tool calls incompletas.
No confiar solo en pruebas manuales.

---

## Resumen ejecutivo para implementar

1. Extraer `shouldAutoSendAfterApproval()` a un helper testeable en renderer.
2. Hacer que `ChatPage.tsx` use ese helper en `sendAutomaticallyWhen`.
3. Extraer `sanitizeMessagesForModel()` a `toolMessageSanitizer.ts`.
4. Cambiar denegaciones a `output-denied` y estados `input-*` a `output-error`.
5. Anadir tests unitarios de ambas piezas.
6. Ejecutar `pnpm typecheck` y `pnpm test`.
7. Validar manualmente el escenario original de aprobacion parcial.
