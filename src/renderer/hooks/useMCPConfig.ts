import { useState, useEffect } from 'react';
import { MCPPreferences, DEFAULT_MCP_PREFERENCES } from '../../types/preferences';
import { getRendererLogger } from '@/services/logger';

const logger = getRendererLogger();

export const useMCPConfig = () => {
  const [config, setConfig] = useState<MCPPreferences>(DEFAULT_MCP_PREFERENCES);

  const [state, setState] = useState({
    saving: false,
    saved: false
  });

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const result = await window.levante.preferences.get('mcp');

      if (result.success && result.data) {
        setConfig(result.data);
      } else {
        // Use defaults if no config exists
        setConfig(DEFAULT_MCP_PREFERENCES);
      }
    } catch (error) {
      logger.preferences.error('Error loading MCP configuration', {
        error: error instanceof Error ? error.message : error
      });
      // Fallback to defaults on error
      setConfig(DEFAULT_MCP_PREFERENCES);
    }
  };

  const handleSave = async () => {
    setState(prev => ({ ...prev, saving: true, saved: false }));

    try {
      const result = await window.levante.preferences.set('mcp', config);

      if (result.success) {
        setState(prev => ({ ...prev, saving: false, saved: true }));

        setTimeout(() => {
          setState(prev => ({ ...prev, saved: false }));
        }, 3000);

        logger.preferences.info('MCP configuration saved successfully', {
          sdk: config.sdk,
          codeModeEnabled: config.codeModeDefaults?.enabled
        });
      } else {
        throw new Error(result.error || 'Failed to save MCP configuration');
      }
    } catch (error) {
      logger.preferences.error('Error saving MCP configuration', {
        sdk: config.sdk,
        error: error instanceof Error ? error.message : error
      });
      setState(prev => ({ ...prev, saving: false }));
    }
  };

  return {
    config,
    setConfig,
    state,
    handleSave
  };
};
