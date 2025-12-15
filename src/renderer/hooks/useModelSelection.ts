/**
 * useModelSelection Hook
 *
 * Handles model selection logic including:
 * - Loading available models from modelService
 * - Filtering models based on session type
 * - Validating model changes against session type
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { modelService } from '@/services/modelService';
import { getRendererLogger } from '@/services/logger';
import type { Model, GroupedModelsByProvider } from '../../types/models';

const logger = getRendererLogger();

// ============================================================================
// Types
// ============================================================================

interface Session {
  id: string;
  model?: string;
  session_type?: 'chat' | 'inference';
}

interface UseModelSelectionOptions {
  currentSession: Session | null;
  onLoadUserName?: () => void;
}

interface UseModelSelectionReturn {
  model: string;
  setModel: (model: string) => void;
  availableModels: Model[];
  filteredAvailableModels: Model[];
  groupedModelsByProvider: GroupedModelsByProvider | null;
  modelsLoading: boolean;
  currentModelInfo: Model | undefined;
  modelTaskType: string | undefined;
  handleModelChange: (newModelId: string) => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a model is an inference model (non-chat)
 */
function isInferenceModel(taskType: string | undefined): boolean {
  return !!taskType && taskType !== 'chat' && taskType !== 'image-text-to-text';
}

/**
 * Filter models based on session type
 */
function filterModelsBySessionType(
  models: Model[],
  session: Session | null
): Model[] {
  if (!session) {
    return models;
  }

  const sessionType = session.session_type;
  let filtered: Model[] = [];

  if (sessionType === 'chat') {
    // Chat session - only show chat and multimodal chat models
    filtered = models.filter(m => {
      const taskType = m.taskType;
      return !taskType || taskType === 'chat' || taskType === 'image-text-to-text';
    });
  } else if (sessionType === 'inference') {
    // Inference session - only show inference models
    filtered = models.filter(m => {
      const taskType = m.taskType;
      return taskType && taskType !== 'chat' && taskType !== 'image-text-to-text';
    });
  } else {
    // Fallback - show all models
    filtered = models;
  }

  // ALWAYS include the session's current model, even if not in filtered list
  // This allows continuing conversations with the same model
  if (session.model) {
    const currentModel = models.find(m => m.id === session.model);
    if (currentModel && !filtered.find(m => m.id === currentModel.id)) {
      logger.core.info('Adding session model to filtered list', {
        model: session.model,
        sessionType
      });
      filtered = [currentModel, ...filtered];
    }
  }

  return filtered;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useModelSelection(options: UseModelSelectionOptions): UseModelSelectionReturn {
  const { currentSession, onLoadUserName } = options;

  const [model, setModel] = useState<string>('');
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [groupedModelsByProvider, setGroupedModelsByProvider] = useState<GroupedModelsByProvider | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);

  // Get current model info - search in grouped models if available, otherwise availableModels
  const currentModelInfo = useMemo(() => {
    // First try to find in available models (active provider)
    let info = availableModels.find((m) => m.id === model);

    // If not found, search in grouped models (other providers)
    if (!info && groupedModelsByProvider) {
      for (const group of groupedModelsByProvider.providers) {
        info = group.models.find(m => m.id === model);
        if (info) break;
      }
    }
    return info;
  }, [model, availableModels, groupedModelsByProvider]);

  const modelTaskType = currentModelInfo?.taskType;

  // Filter available models based on current session type
  const filteredAvailableModels = useMemo(() => {
    return filterModelsBySessionType(availableModels, currentSession);
  }, [availableModels, currentSession]);

  // Load available models on component mount
  useEffect(() => {
    const loadModels = async () => {
      setModelsLoading(true);
      try {
        // Ensure model service is initialized
        await modelService.initialize();

        // Load legacy single-provider models AND grouped multi-provider models
        const [models, grouped] = await Promise.all([
          modelService.getAvailableModels(),
          modelService.getAllProvidersWithSelectedModels()
        ]);

        setAvailableModels(models);
        setGroupedModelsByProvider(grouped);

        // Log available models for debugging
        logger.models.debug(`Loaded models`, {
          count: models.length,
          groupedCount: grouped.totalModelCount,
          providerCount: grouped.providers.length
        });
      } catch (error) {
        logger.models.error('Failed to load models', {
          error: error instanceof Error ? error.message : error
        });
      } finally {
        setModelsLoading(false);
      }
    };

    loadModels();


    // Also load user name if callback provided
    if (onLoadUserName) {
      onLoadUserName();
    }
  }, [onLoadUserName]);

  // Auto-select model if only one is available and no model is selected
  useEffect(() => {
    if (!modelsLoading && !model && !currentSession) {
      // Logic:
      // 1. If groupedModels exists, check total count.
      // 2. If availableModels exists (legacy/active), check that.

      let candidateModel = '';

      if (groupedModelsByProvider && groupedModelsByProvider.totalModelCount === 1) {
        // Only 1 model across all providers
        const provider = groupedModelsByProvider.providers[0];
        if (provider && provider.models.length === 1) {
          candidateModel = provider.models[0].id;
        }
      } else if (availableModels.length === 1) {
        // Fallback or specific scope
        candidateModel = availableModels[0].id;
      }

      if (candidateModel) {
        logger.models.info('Auto-selecting single available model', { model: candidateModel });
        setModel(candidateModel);
      }
    }
  }, [availableModels, groupedModelsByProvider, modelsLoading, model, currentSession]);

  // Sync model with current session when session changes
  useEffect(() => {
    if (currentSession?.model) {
      logger.core.info('Syncing model from session', {
        sessionId: currentSession.id,
        model: currentSession.model
      });
      setModel(currentSession.model);
    }
  }, [currentSession?.id, currentSession?.model]);

  // Handle model change with session type validation
  const handleModelChange = useCallback(async (newModelId: string) => {
    // Keep internal sync with new model logic (async wrapper)

    // Find model info across all providers
    let newModelInfo = availableModels.find((m) => m.id === newModelId);
    if (!newModelInfo && groupedModelsByProvider) {
      for (const group of groupedModelsByProvider.providers) {
        newModelInfo = group.models.find(m => m.id === newModelId);
        if (newModelInfo) break;
      }
    }

    // If still not found (rare edge case), we can't validate
    if (!newModelInfo) {
      logger.models.warn('Model not found for selection', { newModelId });
      // If no current session, proceed blindly, otherwise block safe
      if (currentSession) return;
    }

    // If no current session, allow any model (it will determine session type on creation)
    if (!currentSession) {
      // Check if we need to switch provider
      try {
        const newProviderId = await modelService.getProviderForModel(newModelId);
        const activeProvider = await modelService.getActiveProvider();

        if (newProviderId && activeProvider && newProviderId !== activeProvider.id) {
          logger.models.info('Auto-switching provider for new session', {
            from: activeProvider.id,
            to: newProviderId,
            model: newModelId
          });
          await modelService.setActiveProvider(newProviderId);
          // Refresh available models for the new active provider
          const models = await modelService.getAvailableModels();
          setAvailableModels(models);
        }
      } catch (err) {
        logger.models.error('Failed to auto-switch provider', {
          error: err instanceof Error ? err.message : String(err)
        });
      }

      setModel(newModelId);
      return;
    }

    const newTaskType = newModelInfo?.taskType;
    const isNewModelInference = isInferenceModel(newTaskType);

    // Check session type compatibility
    const sessionType = currentSession.session_type;

    if (sessionType === 'chat' && isNewModelInference) {
      logger.core.warn('Cannot switch to inference model in chat session', {
        currentSessionType: sessionType,
        newModel: newModelId,
        newTaskType
      });
      alert(
        '❌ No puedes usar modelos de inferencia en sesiones de chat.\n\n' +
        'Las sesiones de chat están diseñadas para modelos conversacionales. ' +
        'Para usar modelos de inferencia (text-to-image, image-to-image, etc.), inicia una nueva conversación.'
      );
      return;
    }

    if (sessionType === 'inference' && !isNewModelInference) {
      logger.core.warn('Cannot switch to chat model in inference session', {
        currentSessionType: sessionType,
        newModel: newModelId,
        newTaskType
      });
      alert(
        '❌ No puedes usar modelos de chat en sesiones de inferencia.\n\n' +
        'Las sesiones de inferencia están diseñadas para tareas específicas (text-to-image, image-to-image, etc.). ' +
        'Para usar modelos de chat normales, inicia una nueva conversación.'
      );
      return;
    }

    // Valid change - check provider switch
    try {
      const newProviderId = await modelService.getProviderForModel(newModelId);
      const activeProvider = await modelService.getActiveProvider();

      if (newProviderId && activeProvider && newProviderId !== activeProvider.id) {
        logger.models.info('Auto-switching provider for existing session', {
          from: activeProvider.id,
          to: newProviderId,
          model: newModelId
        });
        await modelService.setActiveProvider(newProviderId);

        // Refresh available models (active provider changed)
        const models = await modelService.getAvailableModels();
        setAvailableModels(models);

        // Also refresh grouped models to update order (active logic)
        const grouped = await modelService.getAllProvidersWithSelectedModels();
        setGroupedModelsByProvider(grouped);
      }
    } catch (err) {
      logger.models.error('Failed to auto-switch provider', {
        error: err instanceof Error ? err.message : String(err)
      });
    }

    logger.core.info('Model changed', {
      oldModel: model,
      newModel: newModelId,
      sessionType,
      compatible: true
    });
    setModel(newModelId);
  }, [currentSession, availableModels, model, groupedModelsByProvider]);

  return {
    model,
    setModel,
    availableModels,
    filteredAvailableModels,
    groupedModelsByProvider,
    modelsLoading,
    currentModelInfo,
    modelTaskType,
    handleModelChange,
  };
}

// Export helper for use in other places
export { isInferenceModel };
