/**
 * Mini Chat Header
 * 
 * Header with model selector and close button.
 * Draggable area for moving the window.
 */

import React, { useEffect, useState } from 'react';
import { useMiniChatStore } from '@/stores/miniChatStore';
import { modelService } from '@/services/modelService';

interface Model {
  id: string;
  name: string;
}

export function MiniChatHeader() {
  const { selectedModel, setSelectedModel, clearMessages } = useMiniChatStore();
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);

  // Load available models on mount
  useEffect(() => {
    async function loadModels() {
      try {
        // Initialize model service and get available models
        await modelService.initialize();
        const availableModels = await modelService.getAvailableModels();
        
        const modelList = availableModels.map((m) => ({
          id: m.id,
          name: m.name || m.id.split('/').pop() || m.id,
        }));
        setModels(modelList);

        // Set default model if none selected
        if (!selectedModel && modelList.length > 0) {
          setSelectedModel(modelList[0].id);
        }
      } catch (error) {
        console.error('Failed to load models:', error);
      } finally {
        setLoading(false);
      }
    }

    loadModels();
  }, [selectedModel, setSelectedModel]);

  const handleClose = () => {
    window.levante?.miniChat?.hide?.();
  };

  const handleClear = () => {
    clearMessages();
    // Reset window size
    window.levante?.miniChat?.resize?.(140);
  };

  return (
    <div className="mini-chat-header">
      <div className="mini-chat-header-left">
        <span className="mini-chat-logo">⚡</span>
        <select
          className="mini-chat-model-select"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={loading}
        >
          {loading ? (
            <option>Loading...</option>
          ) : models.length === 0 ? (
            <option>No models available</option>
          ) : (
            models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))
          )}
        </select>
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
