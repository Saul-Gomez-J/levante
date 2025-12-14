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
import type { Model } from '../../types/models';

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
  const [modelsLoading, setModelsLoading] = useState(true);

  // Get current model info
  const currentModelInfo = availableModels.find((m) => m.id === model);
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
        const models = await modelService.getAvailableModels();
        setAvailableModels(models);

        // Log available models for debugging
        logger.models.debug(`Loaded ${models.length} available models`, {
          models: models.map(m => ({ id: m.id, name: m.name, provider: m.provider }))
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
  const handleModelChange = useCallback((newModelId: string) => {
    // If no current session, allow any model (it will determine session type on creation)
    if (!currentSession) {
      setModel(newModelId);
      return;
    }

    // Get the new model's info
    const newModelInfo = availableModels.find((m) => m.id === newModelId);
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

    // Valid change - update model
    logger.core.info('Model changed', {
      oldModel: model,
      newModel: newModelId,
      sessionType,
      compatible: true
    });
    setModel(newModelId);
  }, [currentSession, availableModels, model]);

  return {
    model,
    setModel,
    availableModels,
    filteredAvailableModels,
    modelsLoading,
    currentModelInfo,
    modelTaskType,
    handleModelChange,
  };
}

// Export helper for use in other places
export { isInferenceModel };
