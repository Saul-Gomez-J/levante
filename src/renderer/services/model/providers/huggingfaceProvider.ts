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

    return data.map((model: any): Model => ({
      id: model.id,
      name: model.id,
      provider: 'huggingface',
      contextLength: getContextLength(model),
      capabilities: parseCapabilities(model),
      isAvailable: true,
      userDefined: false,
      pricing: undefined, // Hugging Face Inference Router uses dynamic pricing
      taskType: inferTaskType(model) // Infer task type from pipeline_tag
    }));
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
function parseCapabilities(model: any): string[] {
  const capabilities: string[] = ['text'];

  // Check for vision/multimodal capabilities
  if (model.pipeline_tag === 'image-text-to-text' ||
      model.tags?.includes('vision') ||
      model.id.toLowerCase().includes('vision')) {
    capabilities.push('vision');
  }

  // Most modern LLMs support function calling
  if (model.pipeline_tag === 'text-generation' ||
      model.tags?.includes('conversational') ||
      model.tags?.includes('function-calling')) {
    capabilities.push('tools');
  }

  return capabilities;
}

/**
 * Get context length for known models, with fallback
 */
function getContextLength(model: any): number {
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
