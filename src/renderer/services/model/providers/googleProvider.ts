import type { Model } from '../../../../types/models';
import { getRendererLogger } from '@/services/logger';

const logger = getRendererLogger();

/**
 * Fetch models from Google AI API
 */
export async function fetchGoogleModels(apiKey: string): Promise<Model[]> {
  try {
    const result = await window.levante.models.fetchGoogle(apiKey);

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch Google models');
    }

    const data = result.data || [];

    // Filter to only generative models
    return data
      .filter((model: any) => model.name && model.name.includes('models/gemini'))
      .map((model: any): Model => {
        const modelId = model.name.replace('models/', '');
        return {
          id: modelId,
          name: modelId,
          provider: 'google',
          contextLength: model.inputTokenLimit || 0,
          capabilities: getCapabilities(model),
          isAvailable: true,
          userDefined: false,
          pricing: undefined // Google API doesn't provide pricing
        };
      });
  } catch (error) {
    logger.models.error('Failed to fetch Google models', {
      error: error instanceof Error ? error.message : error
    });
    throw error;
  }
}

function getCapabilities(model: any): string[] {
  const caps = ['text', 'tools'];
  if (model.supportedGenerationMethods?.includes('generateContent')) {
    caps.push('vision');
  }
  return caps;
}
