import { useState, useEffect } from 'react';
import type { ReasoningConfig } from '../../types/reasoning';
import { DEFAULT_REASONING_CONFIG } from '../../types/reasoning';
import { getRendererLogger } from '@/services/logger';

const logger = getRendererLogger();

interface ReasoningConfigState {
  saving: boolean;
  saved: boolean;
  loading: boolean;
}

export const useReasoningConfig = () => {
  const [config, setConfig] = useState<ReasoningConfig>(DEFAULT_REASONING_CONFIG);

  const [state, setState] = useState<ReasoningConfigState>({
    saving: false,
    saved: false,
    loading: true,
  });

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      // Reasoning config is stored inside the 'ai' preference object
      const result = await window.levante.preferences.get('ai');

      if (result.success && result.data?.reasoning) {
        setConfig(result.data.reasoning);
      } else {
        // Use defaults if no config exists
        setConfig(DEFAULT_REASONING_CONFIG);
      }
    } catch (error) {
      logger.preferences.error('Error loading reasoning configuration', {
        error: error instanceof Error ? error.message : error,
      });
      // Fallback to defaults on error
      setConfig(DEFAULT_REASONING_CONFIG);
    } finally {
      setState(prev => ({ ...prev, loading: false }));
    }
  };

  const handleSave = async () => {
    setState(prev => ({ ...prev, saving: true, saved: false }));

    try {
      // Get current AI config and merge with new reasoning config
      const currentAiResult = await window.levante.preferences.get('ai');
      // Use existing config or defaults for required fields
      const currentAiConfig = currentAiResult.success && currentAiResult.data
        ? currentAiResult.data
        : { baseSteps: 5, maxSteps: 20, mermaidValidation: true };

      const newAiConfig = {
        ...currentAiConfig,
        reasoning: config,
      };

      const result = await window.levante.preferences.set('ai', newAiConfig as typeof currentAiConfig);

      if (result.success) {
        setState(prev => ({ ...prev, saving: false, saved: true }));

        setTimeout(() => {
          setState(prev => ({ ...prev, saved: false }));
        }, 3000);

        logger.preferences.info('Reasoning configuration saved successfully', {
          mode: config.mode,
          effort: config.effort,
        });
      } else {
        throw new Error(result.error || 'Failed to save reasoning configuration');
      }
    } catch (error) {
      logger.preferences.error('Error saving reasoning configuration', {
        mode: config.mode,
        error: error instanceof Error ? error.message : error,
      });
      setState(prev => ({ ...prev, saving: false }));
    }
  };

  return {
    config,
    setConfig,
    state,
    handleSave,
  };
};
