/**
 * Mini Chat Header
 * 
 * Header with model selector and close button.
 * Draggable area for moving the window.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useMiniChatStore } from '@/stores/miniChatStore';
import { modelService } from '@/services/modelService';
import { ModelSearchableSelect } from '@/components/ai-elements/model-searchable-select';
import type { GroupedModelsByProvider } from '../../../types/models';

interface MiniChatHeaderProps {
  onClearMessages?: () => void;
}

export function MiniChatHeader({ onClearMessages }: MiniChatHeaderProps = {}) {
  const { selectedModel, setSelectedModel, reset } = useMiniChatStore();
  const [groupedModels, setGroupedModels] = useState<GroupedModelsByProvider | null>(null);
  const [loading, setLoading] = useState(true);

  // Load available models on mount
  useEffect(() => {
    async function loadModels() {
      try {
        // Initialize model service and get ALL providers with their selected models
        await modelService.initialize();
        const grouped = await modelService.getAllProvidersWithSelectedModels();
        setGroupedModels(grouped);

        // Validate existing selected model or set default
        if (selectedModel && grouped.providers.length > 0) {
          const modelExists = grouped.providers.some(p =>
            p.models.some(m => m.id === selectedModel)
          );

          if (!modelExists) {
            console.warn('Previously selected model no longer available:', selectedModel);
            // Auto-select first model available
            const firstProvider = grouped.providers[0];
            if (firstProvider?.models.length > 0) {
              setSelectedModel(firstProvider.models[0].id);
            }
          }
        } else if (!selectedModel && grouped.totalModelCount > 0) {
          // Set default model if none selected
          const firstProvider = grouped.providers[0];
          if (firstProvider?.models.length > 0) {
            setSelectedModel(firstProvider.models[0].id);
          }
        }
      } catch (error) {
        console.error('Failed to load models:', error);
        setGroupedModels({ providers: [], totalModelCount: 0 });
      } finally {
        setLoading(false);
      }
    }

    loadModels();
  }, [selectedModel, setSelectedModel]);

  // Handler for model change with automatic provider switching
  const handleModelChange = useCallback(async (newModelId: string) => {
    // Get the provider that owns the model
    const newProviderId = await modelService.getProviderForModel(newModelId);
    const activeProvider = await modelService.getActiveProvider();

    // Automatically switch provider if necessary
    if (newProviderId && activeProvider && newProviderId !== activeProvider.id) {
      await modelService.setActiveProvider(newProviderId);
    }

    // Update selected model in the store
    setSelectedModel(newModelId);
  }, [setSelectedModel]);

  const handleClose = () => {
    window.levante?.miniChat?.hide?.();
  };

  const handleClear = () => {
    // Clear messages via callback (from useChat in Container)
    onClearMessages?.();
    // Reset store session state
    reset();
    // Reset window size
    window.levante?.miniChat?.resize?.(140);
  };

  return (
    <div className="mini-chat-header">
      <div className="mini-chat-header-left">
        <ModelSearchableSelect
          value={selectedModel}
          onValueChange={handleModelChange}
          models={[]}
          groupedModels={groupedModels || undefined}
          loading={loading}
          placeholder="Select model"
          className="mini-chat-model-select-wrapper"
          useCustomPortalContainer={true}
          expandMiniChatOnOpen={true}
        />
      </div>

      <div className="mini-chat-header-right">
        <button
          className="mini-chat-header-btn"
          onClick={handleClear}
          title="Clear chat"
        >
          🗑️
        </button>
        <button
          className="mini-chat-header-btn"
          onClick={handleClose}
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
