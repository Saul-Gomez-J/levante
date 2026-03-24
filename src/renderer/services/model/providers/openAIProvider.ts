import type { Model } from '../../../../types/models';
import { getRendererLogger } from '@/services/logger';

const logger = getRendererLogger();

export async function fetchOpenAIModels(
  params:
    | string
    | { apiKey?: string; authMode?: 'api-key' | 'oauth'; organizationId?: string }
): Promise<Model[]> {
  try {
    const result = await window.levante.models.fetchOpenAI(params);

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch OpenAI models');
    }

    const data = result.data || [];

    return data
      .filter((model: any) => isSupportedOpenAIModel(model.id))
      .map((model: any): Model => ({
        id: model.id,
        name: model.display_name || model.name || model.id,
        provider: 'openai',
        contextLength: 0,
        capabilities: getCapabilities(model.id),
        isAvailable: true,
        userDefined: false,
        pricing: undefined,
      }));
  } catch (error) {
    logger.models.error('Failed to fetch OpenAI models', {
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}

function isSupportedOpenAIModel(modelId: string): boolean {
  return (
    modelId.startsWith('gpt-') ||
    modelId.startsWith('o1') ||
    modelId.startsWith('o3') ||
    modelId.startsWith('o4') ||
    modelId.includes('codex')
  );
}

function getCapabilities(modelId: string): string[] {
  const caps = ['text', 'tools'];
  if (modelId.includes('gpt-4') || modelId.includes('gpt-5') || modelId.includes('o1')) {
    caps.push('vision');
  }
  return caps;
}
