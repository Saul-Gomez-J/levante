import { ipcMain } from 'electron';
import { ModelFetchService } from '../services/modelFetchService';
import { getLogger } from '../services/logging';

const logger = getLogger();

export function setupModelHandlers() {
  // Fetch OpenRouter models
  ipcMain.removeHandler('levante/models/openrouter');
  ipcMain.handle('levante/models/openrouter', async (_, apiKey?: string) => {
    try {
      const models = await ModelFetchService.fetchOpenRouterModels(apiKey);
      return {
        success: true,
        data: models
      };
    } catch (error) {
      logger.ipc.error('Failed to fetch OpenRouter models', { error: error instanceof Error ? error.message : error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Fetch Gateway models
  ipcMain.removeHandler('levante/models/gateway');
  ipcMain.handle('levante/models/gateway', async (_, apiKey: string, baseUrl?: string) => {
    try {
      const models = await ModelFetchService.fetchGatewayModels(apiKey, baseUrl);
      return {
        success: true,
        data: models
      };
    } catch (error) {
      logger.ipc.error('Failed to fetch Gateway models', { error: error instanceof Error ? error.message : error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Fetch local models
  ipcMain.removeHandler('levante/models/local');
  ipcMain.handle('levante/models/local', async (_, endpoint: string) => {
    try {
      const models = await ModelFetchService.fetchLocalModels(endpoint);
      return {
        success: true,
        data: models
      };
    } catch (error) {
      logger.ipc.error('Failed to fetch local models', { endpoint, error: error instanceof Error ? error.message : error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Fetch OpenAI models
  ipcMain.removeHandler('levante/models/openai');
  ipcMain.handle('levante/models/openai', async (_, apiKey: string) => {
    try {
      const models = await ModelFetchService.fetchOpenAIModels(apiKey);
      return {
        success: true,
        data: models
      };
    } catch (error) {
      logger.ipc.error('Failed to fetch OpenAI models', { error: error instanceof Error ? error.message : error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Fetch Google AI models
  ipcMain.removeHandler('levante/models/google');
  ipcMain.handle('levante/models/google', async (_, apiKey: string) => {
    try {
      const models = await ModelFetchService.fetchGoogleModels(apiKey);
      return {
        success: true,
        data: models
      };
    } catch (error) {
      logger.ipc.error('Failed to fetch Google models', { error: error instanceof Error ? error.message : error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Fetch Anthropic models
  ipcMain.removeHandler('levante/models/anthropic');
  ipcMain.handle('levante/models/anthropic', async (_, apiKey: string) => {
    try {
      const models = await ModelFetchService.fetchAnthropicModels(apiKey);
      return {
        success: true,
        data: models
      };
    } catch (error) {
      logger.ipc.error('Failed to fetch Anthropic models', { error: error instanceof Error ? error.message : error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Fetch Groq models
  ipcMain.removeHandler('levante/models/groq');
  ipcMain.handle('levante/models/groq', async (_, apiKey: string) => {
    try {
      const models = await ModelFetchService.fetchGroqModels(apiKey);
      return {
        success: true,
        data: models
      };
    } catch (error) {
      logger.ipc.error('Failed to fetch Groq models', { error: error instanceof Error ? error.message : error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Fetch xAI models
  ipcMain.removeHandler('levante/models/xai');
  ipcMain.handle('levante/models/xai', async (_, apiKey: string) => {
    try {
      const models = await ModelFetchService.fetchXAIModels(apiKey);
      return {
        success: true,
        data: models
      };
    } catch (error) {
      logger.ipc.error('Failed to fetch xAI models', { error: error instanceof Error ? error.message : error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Fetch Hugging Face models
  ipcMain.removeHandler('levante/models/huggingface');
  ipcMain.handle('levante/models/huggingface', async (_, apiKey: string) => {
    try {
      const models = await ModelFetchService.fetchHuggingFaceModels(apiKey);
      return {
        success: true,
        data: models
      };
    } catch (error) {
      logger.ipc.error('Failed to fetch Hugging Face models', { error: error instanceof Error ? error.message : error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Validate Hugging Face model (fetch model info from HF API)
  ipcMain.removeHandler('levante/models/huggingface/validate');
  ipcMain.handle('levante/models/huggingface/validate', async (_, modelId: string) => {
    try {
      const apiUrl = `https://huggingface.co/api/models/${modelId}`;

      const response = await fetch(apiUrl);

      if (!response.ok) {
        if (response.status === 404) {
          return {
            success: false,
            error: 'Model not found on Hugging Face Hub'
          };
        }
        return {
          success: false,
          error: `Failed to fetch model info (HTTP ${response.status})`
        };
      }

      const data = await response.json();

      return {
        success: true,
        data: {
          id: data.id,
          pipeline_tag: data.pipeline_tag,
          modelId: data.modelId,
          author: data.author,
          downloads: data.downloads,
          likes: data.likes
        }
      };
    } catch (error) {
      logger.ipc.error('Failed to validate Hugging Face model', {
        modelId,
        error: error instanceof Error ? error.message : error
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to validate model'
      };
    }
  });

  logger.ipc.info('Model IPC handlers registered');
}