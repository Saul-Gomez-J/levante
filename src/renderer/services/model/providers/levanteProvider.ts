import type { Model } from '../../../../types/models';
import { getRendererLogger } from '@/services/logger';

const logger = getRendererLogger();

/**
 * Fetch models from Levante Platform API
 * Uses OAuth tokens from the OAuth store (not API keys)
 * @param baseUrl - Optional base URL override for local development
 */
export async function fetchLevantePlatformModels(baseUrl?: string): Promise<Model[]> {
  try {
    const result = await window.levante.models.fetchLevantePlatform(baseUrl);

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch Levante Platform models');
    }

    const data = result.data || [];

    return data.map((model: any): Model => ({
      id: model.id,
      name: model.name || model.id,
      provider: 'levante-platform',
      contextLength: model.context_length || model.contextLength || 128000,
      pricing: model.pricing ? {
        input: parseFloat(model.pricing.input || model.pricing.prompt) * 1000000,
        output: parseFloat(model.pricing.output || model.pricing.completion) * 1000000
      } : undefined,
      description: model.description,
      capabilities: parseLevantePlatformCapabilities(model),
      isAvailable: true,
      userDefined: false
    }));
  } catch (error) {
    logger.models.error('Failed to fetch Levante Platform models', {
      error: error instanceof Error ? error.message : error
    });
    throw error;
  }
}

/**
 * Parse Levante Platform model capabilities
 */
function parseLevantePlatformCapabilities(model: any): string[] {
  const capabilities: string[] = ['text'];

  // Check for vision/multimodal capabilities
  if (model.capabilities?.includes('vision') ||
    model.modalities?.includes('image') ||
    model.id.toLowerCase().includes('vision')) {
    capabilities.push('vision');
  }

  // Check for function/tool calling
  if (model.capabilities?.includes('tools') ||
    model.capabilities?.includes('function_calling') ||
    model.supports_tools) {
    capabilities.push('tools');
  }

  // Check for reasoning
  if (model.capabilities?.includes('reasoning') ||
    model.id.toLowerCase().includes('reasoning')) {
    capabilities.push('reasoning');
  }

  return capabilities;
}
