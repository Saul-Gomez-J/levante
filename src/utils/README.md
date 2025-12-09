# Utilidades Compartidas

Este directorio contiene funciones utilitarias compartidas entre el proceso principal (main) y el renderizador (renderer).

## Model Classification

### `modelClassification.ts`

Sistema de clasificación de modelos AI que asigna categorías y capacidades basándose en metadatos.

#### Uso Básico

```typescript
import { classifyModel } from '@/utils/modelClassification';
import type { Model } from '@/types/models';

const model: Model = {
  id: 'gpt-4',
  name: 'GPT-4',
  provider: 'OpenAI',
  capabilities: ['tools', 'vision'],
  // ... otros campos
};

const { category, capabilities } = classifyModel(model);
// category: 'multimodal' (porque tiene vision)
// capabilities: { supportsTools: true, supportsVision: true, ... }
```

#### Funciones Principales

- **`classifyModel(model)`** - Clasifica un modelo y retorna categoría + capacidades
- **`getSessionType(category)`** - Obtiene el tipo de sesión ('chat' | 'inference')
- **`getCompatibleCategories(sessionType)`** - Lista categorías compatibles con un tipo de sesión
- **`areModelsCompatible(cat1, cat2)`** - Verifica si dos modelos son compatibles
- **`hasCapability(model, capability)`** - Verifica si un modelo tiene una capacidad específica

#### Categorías (Minimalista)

1. **`chat`** - Modelos conversacionales estándar (GPT-4, Claude, Llama)
2. **`multimodal`** - Chat con visión/audio (GPT-4V, Claude 3, Gemini)
3. **`image`** - Generación de imágenes (DALL-E, Stable Diffusion, FLUX)
4. **`audio`** - Text-to-speech y speech-to-text (Whisper, TTS)
5. **`specialized`** - Tareas especializadas (QA de documentos, tablas, etc.)

#### Capacidades Detectadas

- `supportsTools` - Soporta function calling (MCP)
- `supportsVision` - Procesa imágenes
- `supportsStreaming` - Streaming de tokens
- `requiresAttachment` - Requiere archivos adjuntos
- `supportsAudioOut` - Genera audio
- `supportsAudioIn` - Procesa audio
- `supportsSystemPrompt` - Soporta system prompts
- `supportsMultiTurn` - Conversaciones multi-turno

#### Lógica de Clasificación

La clasificación sigue este orden de prioridad:

1. **taskType explícito** (modelos Hugging Face)
   ```typescript
   model.taskType = 'text-to-image' → category: 'image'
   ```

2. **capabilities array** (OpenAI, Anthropic, Google)
   ```typescript
   model.capabilities = ['vision', 'tools'] → category: 'multimodal'
   ```

3. **Patrones en model.id** (detección heurística)
   ```typescript
   'dall-e-3' → category: 'image'
   'whisper-1' → category: 'audio'
   ```

4. **Fallback** → `'chat'`

#### Ejemplo de Integración

```typescript
// En ModelService (Fase 2)
import { classifyModel, batchClassifyModels } from '@/utils/modelClassification';

class ModelService {
  private classificationCache = new Map();

  async syncProviderModels(providerId: string) {
    const models = await fetchModels(providerId);

    // Clasificar y cachear
    for (const model of models) {
      const { category, capabilities } = classifyModel(model);
      model.category = category;
      model.computedCapabilities = capabilities;

      this.classificationCache.set(model.id, { category, capabilities });
    }

    return models;
  }

  getModelClassification(modelId: string) {
    return this.classificationCache.get(modelId); // O(1) lookup!
  }
}
```

#### Notas de Compatibilidad

- Todos los campos agregados a `Model` son **opcionales**
- El código existente seguirá funcionando sin cambios
- Los modelos sin clasificar pueden clasificarse on-the-fly usando `classifyModel()`
- Sin breaking changes en la API existente

## Próximos Pasos (Fases Futuras)

- **Fase 2**: Integrar clasificación en ModelService con cache
- **Fase 3**: Usar clasificación en AIService para routing mejorado
- **Fase 4**: UI con filtrado y agrupación por categorías
