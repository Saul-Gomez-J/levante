import type { Model } from '../../../../types/models';
import { getRendererLogger } from '@/services/logger';

const logger = getRendererLogger();

/**
 * Fetch models from Hugging Face Inference Router API
 */
export async function fetchHuggingFaceModels(apiKey: string): Promise<Model[]> {
  try {
    const result = await window.levante.models.fetchHuggingFace(apiKey);

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch Hugging Face models');
    }

    const data = result.data || [];

    return data.map((model: any): Model => {
      const inputModalities = mergeModalities(
        model.input_modalities,
        model.architecture?.input_modalities,
        model.providers?.flatMap((p: any) => p.input_modalities)
      );

      const outputModalities = mergeModalities(
        model.output_modalities,
        model.architecture?.output_modalities,
        model.providers?.flatMap((p: any) => p.output_modalities)
      );

      const pricing = normalizePricing(model, model.providers);

      return {
        id: model.id,
        name: model.name || model.id,
        provider: 'huggingface',
        contextLength: getContextLength(model),
        description: model.description,
        tags: Array.isArray(model.tags) ? model.tags : undefined,
        inputModalities,
        outputModalities,
        capabilities: parseCapabilities(model, inputModalities, outputModalities),
        isAvailable: true,
        userDefined: false,
        pricing,
        taskType: inferTaskType(model)
      };
    });
  } catch (error) {
    logger.models.error('Failed to fetch Hugging Face models', {
      error: error instanceof Error ? error.message : error
    });
    throw error;
  }
}

/**
 * Infer task type from model pipeline_tag
 * Maps Hugging Face pipeline tags to our task type enum
 */
function inferTaskType(model: any): 'chat' | 'text-generation' | 'text-to-image' | 'image-text-to-text' | 'image-to-image' | 'text-to-video' | 'text-to-speech' {
  const pipelineTag = model.pipeline_tag;

  // Map pipeline_tag to task type
  switch (pipelineTag) {
    case 'text-generation':
      // Text generation models from Router API are typically chat models
      // The Router API filters for chat-compatible models
      return 'chat';

    case 'conversational':
    case 'text2text-generation':
      return 'chat';

    case 'image-text-to-text':
      // Multimodal vision models
      return 'image-text-to-text';

    case 'text-to-image':
      return 'text-to-image';

    case 'image-to-image':
      return 'image-to-image';

    case 'text-to-video':
      return 'text-to-video';

    case 'text-to-speech':
      return 'text-to-speech';

    default:
      // Default to chat for unknown or unspecified pipeline tags
      // Router API only returns chat-compatible models anyway
      return 'chat';
  }
}

/**
 * Parse model capabilities based on model metadata
 */
function parseCapabilities(model: any, inputModalities: string[], outputModalities: string[]): string[] {
  const capabilities = new Set<string>();
  capabilities.add('text');

  if (
    model.pipeline_tag === 'image-text-to-text' ||
    model.tags?.includes('vision') ||
    model.id.toLowerCase().includes('vision') ||
    inputModalities.some((mod) => mod === 'image' || mod === 'video') ||
    outputModalities.some((mod) => mod === 'image' || mod === 'video')
  ) {
    capabilities.add('vision');
  }

  if (inputModalities.includes('audio')) {
    capabilities.add('audio');
  }

  if (
    model.pipeline_tag === 'text-generation' ||
    model.tags?.includes('conversational') ||
    model.tags?.includes('function-calling') ||
    model.capabilities?.includes('tools') ||
    model.providers?.some((p: any) => p.supports_tools)
  ) {
    capabilities.add('tools');
  }

  return Array.from(capabilities);
}

/**
 * Get context length for known models, with fallback
 */
function getContextLength(model: any): number {
  if (Array.isArray(model.providers)) {
    const providerContext = model.providers.find((p: any) => typeof p.context_length === 'number');
    if (providerContext) {
      return providerContext.context_length;
    }
  }
  // Try to extract from model metadata
  if (model.context_length) return model.context_length;
  if (model.config?.max_position_embeddings) return model.config.max_position_embeddings;
  if (model.config?.model_max_length) return model.config.model_max_length;

  // Fallback based on model ID patterns
  const modelId = model.id.toLowerCase();

  if (modelId.includes('llama-3.3') || modelId.includes('llama-3.1')) return 128000;
  if (modelId.includes('qwen2.5')) return 128000;
  if (modelId.includes('mistral')) return 32768;
  if (modelId.includes('gemma-2')) return 8192;

  // Default fallback
  return 8192;
}

function normalizeModalities(value: unknown): string[] {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return items
    .flat()
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeModalities(...lists: Array<unknown>): string[] {
  const set = new Set<string>();
  lists.forEach((list) => {
    normalizeModalities(list).forEach((item) => set.add(item));
  });
  return Array.from(set);
}

function normalizePricing(model: any, providers?: any[]): { input: number; output: number } | undefined {
  const sources = [];
  if (model?.pricing) sources.push(model.pricing);
  if (Array.isArray(providers)) {
    for (const provider of providers) {
      if (provider?.pricing) {
        sources.push(provider.pricing);
      }
    }
  }

  for (const pricing of sources) {
    const input = Number(pricing.input ?? pricing.prompt ?? pricing.in);
    const output = Number(pricing.output ?? pricing.completion ?? pricing.out);

    if (Number.isFinite(input) || Number.isFinite(output)) {
      return {
        input: Number.isFinite(input) ? input : 0,
        output: Number.isFinite(output) ? output : 0
      };
    }
  }

  return undefined;
}
