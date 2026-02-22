# Plan: Warning para Proveedores sin Tool Approval

## Objetivo

Mostrar un pequeño warning visual cuando el usuario selecciona un modelo que pertenece a un proveedor configurado para **no solicitar aprobación de tools** (es decir, que está en la lista `providersWithoutToolApproval`).

## Contexto

La lista `providersWithoutToolApproval` en las preferencias (`ai.providersWithoutToolApproval`) contiene los proveedores donde las herramientas MCP se ejecutan automáticamente sin pedir confirmación al usuario. Es importante que el usuario sea consciente de esto cuando selecciona un modelo de estos proveedores.

---

## Archivos a Modificar

| Archivo | Propósito |
|---------|-----------|
| `src/renderer/hooks/useToolApprovalWarning.ts` | **NUEVO** - Hook para detectar si el modelo actual necesita warning |
| `src/renderer/components/chat/ChatPromptInput.tsx` | Integrar el warning visual |
| `src/renderer/locales/en/chat.json` | Traducciones en inglés |
| `src/renderer/locales/es/chat.json` | Traducciones en español |

---

## Paso 1: Crear Hook `useToolApprovalWarning`

**Archivo:** `src/renderer/hooks/useToolApprovalWarning.ts` (NUEVO)

Este hook encapsula la lógica para determinar si el modelo seleccionado pertenece a un proveedor sin tool approval.

```typescript
import { useMemo } from 'react';
import { usePreferences } from './usePreferences';
import type { Model } from '@/types/models';
import type { ProviderType } from '@/types/models';

interface UseToolApprovalWarningResult {
  /** True si el proveedor del modelo actual tiene tool approval deshabilitado */
  showWarning: boolean;
  /** Nombre del proveedor (para mostrar en el mensaje) */
  providerName: string | null;
}

/**
 * Hook que determina si se debe mostrar un warning de tool approval
 * basándose en el modelo actual y las preferencias del usuario.
 */
export function useToolApprovalWarning(
  currentModelInfo: Model | undefined
): UseToolApprovalWarningResult {
  const { preferences } = usePreferences();

  return useMemo(() => {
    // Si no hay modelo seleccionado, no mostrar warning
    if (!currentModelInfo?.provider) {
      return { showWarning: false, providerName: null };
    }

    const providerType = currentModelInfo.provider as ProviderType;
    const providersWithoutApproval = preferences?.ai?.providersWithoutToolApproval ?? [];

    // Verificar si el proveedor está en la lista de proveedores sin approval
    const isProviderWithoutApproval = providersWithoutApproval.includes(providerType);

    return {
      showWarning: isProviderWithoutApproval,
      providerName: isProviderWithoutApproval ? currentModelInfo.provider : null,
    };
  }, [currentModelInfo?.provider, preferences?.ai?.providersWithoutToolApproval]);
}
```

---

## Paso 2: Añadir Traducciones

### Archivo: `src/renderer/locales/en/chat.json`

Añadir dentro del objeto raíz:

```json
{
  "tool_approval_warning": {
    "title": "Auto-execution enabled",
    "description": "Tools will run automatically without approval for this provider ({{provider}})"
  }
}
```

### Archivo: `src/renderer/locales/es/chat.json`

Añadir dentro del objeto raíz:

```json
{
  "tool_approval_warning": {
    "title": "Ejecución automática habilitada",
    "description": "Las herramientas se ejecutarán automáticamente sin aprobación para este proveedor ({{provider}})"
  }
}
```

---

## Paso 3: Integrar Warning en ChatPromptInput

**Archivo:** `src/renderer/components/chat/ChatPromptInput.tsx`

### 3.1 Añadir imports

```typescript
import { AlertTriangle } from 'lucide-react';
import { useToolApprovalWarning } from '@/hooks/useToolApprovalWarning';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
```

### 3.2 Usar el hook en el componente

Dentro del componente `ChatPromptInput`, añadir:

```typescript
// Obtener warning de tool approval
const { showWarning: showToolApprovalWarning, providerName } = useToolApprovalWarning(currentModelInfo);
```

### 3.3 Añadir el warning visual

Justo después del `ModelSearchableSelect`, añadir el indicador visual:

```tsx
{/* Model Selector */}
<ModelSearchableSelect
  value={model}
  onValueChange={onModelChange}
  models={availableModels}
  groupedModels={groupedModelsByProvider}
  loading={modelsLoading}
  placeholder={availableModels.length === 0 ? t('model_selector.no_models') : t('model_selector.label')}
/>

{/* Tool Approval Warning */}
{showToolApprovalWarning && (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center text-amber-500">
          <AlertTriangle className="h-4 w-4" />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="font-medium">{t('tool_approval_warning.title')}</p>
        <p className="text-xs text-muted-foreground">
          {t('tool_approval_warning.description', { provider: providerName })}
        </p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
)}
```

---

## Diseño Visual

El warning será un icono de triángulo con exclamación (`AlertTriangle`) en color ámbar/amarillo, posicionado junto al selector de modelo. Al hacer hover, muestra un tooltip con:

- **Título:** "Auto-execution enabled" (en negrita)
- **Descripción:** "Tools will run automatically without approval for this provider (google)"

### Mockup del diseño:

```
┌─────────────────────────────────────────────────────────────┐
│  [Input de mensaje...]                                       │
├─────────────────────────────────────────────────────────────┤
│  📎 Attach  │  [Model: Claude Haiku ▼] ⚠️  │  [Send ▶]     │
│             │                                                │
│             └── Tooltip on hover:                           │
│                 ┌────────────────────────────────────┐      │
│                 │ Auto-execution enabled             │      │
│                 │ Tools will run automatically       │      │
│                 │ without approval for this          │      │
│                 │ provider (google)                  │      │
│                 └────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## Resumen de Cambios

| Paso | Archivo | Tipo | Descripción |
|------|---------|------|-------------|
| 1 | `src/renderer/hooks/useToolApprovalWarning.ts` | Crear | Hook para detectar proveedores sin approval |
| 2a | `src/renderer/locales/en/chat.json` | Editar | Añadir traducciones en inglés |
| 2b | `src/renderer/locales/es/chat.json` | Editar | Añadir traducciones en español |
| 3 | `src/renderer/components/chat/ChatPromptInput.tsx` | Editar | Integrar warning visual con tooltip |

---

## Consideraciones

1. **Performance:** El hook usa `useMemo` para evitar recálculos innecesarios.
2. **UX:** El warning es sutil (solo un icono) para no distraer, pero informativo al hacer hover.
3. **i18n:** Soporta múltiples idiomas usando el sistema de traducciones existente.
4. **Consistencia:** Usa los componentes UI existentes (`Tooltip`, `AlertTriangle`).

---

## Verificación

Después de implementar:

1. Seleccionar un modelo de Google → debe aparecer el warning ⚠️
2. Seleccionar un modelo de OpenRouter → NO debe aparecer warning
3. Seleccionar un modelo de OpenAI → NO debe aparecer warning
4. Hover sobre el warning → debe mostrar tooltip con información
5. Verificar que funciona en inglés y español
