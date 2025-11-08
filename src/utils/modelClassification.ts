/**
 * Model Classification Utilities
 *
 * Pure functions for classifying AI models into categories and
 * computing their capabilities based on metadata.
 *
 * @module modelClassification
 */

import type { Model } from '../types/models';
import type {
  ModelCategory,
  ModelCapabilities,
  SessionType,
  CategoryConfig,
} from '../types/modelCategories';
import { CATEGORY_CONFIGS, getCategoriesForSessionType } from '../types/modelCategories';

/**
 * Classification result
 */
export interface ModelClassification {
  category: ModelCategory;
  capabilities: ModelCapabilities;
}

/**
 * Classify a model into category and capabilities
 * Pure function - no side effects, deterministic output
 *
 * @param model - Model to classify
 * @returns Classification with category and computed capabilities
 *
 * @example
 * ```typescript
 * const model = { id: 'gpt-4', capabilities: ['tools'], ... };
 * const { category, capabilities } = classifyModel(model);
 * // category: 'chat'
 * // capabilities: { supportsTools: true, ... }
 * ```
 */
export function classifyModel(model: Model): ModelClassification {
  const category = inferCategory(model);
  const capabilities = inferCapabilities(model, category);

  return { category, capabilities };
}

/**
 * Infer category from model metadata
 * Priority order:
 * 1. Explicit taskType (Hugging Face inference models)
 * 2. Capabilities array (OpenAI, Anthropic, etc.)
 * 3. Model ID patterns (DALL-E, Whisper, etc.)
 * 4. Fallback to 'chat'
 *
 * @param model - Model to analyze
 * @returns Inferred category
 */
function inferCategory(model: Model): ModelCategory {
  // Priority 1: Use explicit taskType (Hugging Face inference models)
  if (model.taskType) {
    const categoryFromTaskType = mapTaskTypeToCategory(model.taskType);
    if (categoryFromTaskType) {
      return categoryFromTaskType;
    }
  }

  // Priority 2: Infer from capabilities array (OpenAI, Anthropic, Google, etc.)
  if (model.capabilities && model.capabilities.length > 0) {
    // Multimodal: Has vision capability
    if (model.capabilities.includes('vision')) {
      return 'multimodal';
    }

    // For now, models with capabilities but no vision are chat models
    // (Future: could check for other capabilities like 'embedding')
  }

  // Priority 3: Infer from model ID patterns
  const id = model.id.toLowerCase();

  // Image generation models
  if (
    id.includes('dall-e') ||
    id.includes('stable-diffusion') ||
    id.includes('flux') ||
    id.includes('sd') && id.includes('xl') || // SDXL
    id.includes('midjourney')
  ) {
    return 'image';
  }

  // Audio models
  if (
    id.includes('whisper') ||
    id.includes('tts') ||
    id.includes('bark') ||
    id.includes('speech')
  ) {
    return 'audio';
  }

  // Default: chat
  return 'chat';
}

/**
 * Map Hugging Face taskType to category
 */
function mapTaskTypeToCategory(taskType: string): ModelCategory | null {
  const mapping: Record<string, ModelCategory> = {
    // Chat/conversational models
    'chat': 'chat',
    'conversational': 'chat',
    'text-generation': 'chat',
    'text2text-generation': 'chat',

    // Multimodal models
    'image-text-to-text': 'multimodal',

    // Image models
    'text-to-image': 'image',
    'image-to-image': 'image',

    // Audio models
    'text-to-speech': 'audio',
    'automatic-speech-recognition': 'audio',
    'text-to-video': 'audio', // Grouped with audio for now

    // Specialized tasks
    'visual-question-answering': 'specialized',
    'document-question-answering': 'specialized',
    'table-question-answering': 'specialized',
  };

  return mapping[taskType] || null;
}

/**
 * Infer capabilities from model metadata and category
 *
 * Combines:
 * - Category defaults from CATEGORY_CONFIGS
 * - Explicit capabilities from model.capabilities array
 *
 * @param model - Model to analyze
 * @param category - Computed category
 * @returns Computed capabilities
 */
function inferCapabilities(model: Model, category: ModelCategory): ModelCapabilities {
  const categoryConfig = CATEGORY_CONFIGS[category];
  const defaults = categoryConfig.defaultCapabilities;

  // Start with category defaults
  const capabilities: ModelCapabilities = {
    supportsTools: defaults.supportsTools ?? false,
    supportsVision: defaults.supportsVision ?? false,
    supportsStreaming: defaults.supportsStreaming ?? false,
    requiresAttachment: defaults.requiresAttachment ?? false,
    supportsAudioOut: defaults.supportsAudioOut ?? false,
    supportsAudioIn: defaults.supportsAudioIn ?? false,
    supportsSystemPrompt: defaults.supportsSystemPrompt ?? false,
    supportsMultiTurn: defaults.supportsMultiTurn ?? false,
  };

  // Override with explicit capabilities from model metadata
  if (model.capabilities && model.capabilities.length > 0) {
    const caps = model.capabilities;

    // Tools capability
    if (caps.includes('tools') || caps.includes('function-calling')) {
      capabilities.supportsTools = true;
    }

    // Vision capability
    if (caps.includes('vision') || caps.includes('image')) {
      capabilities.supportsVision = true;
    }

    // Audio capabilities
    if (caps.includes('audio') || caps.includes('speech')) {
      capabilities.supportsAudioIn = true;
      capabilities.supportsAudioOut = true;
    }
  }

  // Special handling for image-to-image and specialized tasks
  if (model.taskType) {
    if (
      model.taskType === 'image-to-image' ||
      model.taskType === 'visual-question-answering' ||
      model.taskType === 'document-question-answering'
    ) {
      capabilities.requiresAttachment = true;
    }

    // Text-to-speech models generate audio
    if (model.taskType === 'text-to-speech') {
      capabilities.supportsAudioOut = true;
      capabilities.supportsAudioIn = false;
    }

    // Speech-to-text models process audio
    // Note: 'automatic-speech-recognition' is not in the official taskType enum yet
    // but may be used in practice. Using type assertion for forward compatibility.
    if ((model.taskType as string) === 'automatic-speech-recognition') {
      capabilities.supportsAudioIn = true;
      capabilities.supportsAudioOut = false;
    }
  }

  return capabilities;
}

/**
 * Get session type from category
 *
 * Session types determine model compatibility within a chat session:
 * - 'chat': Conversational models (chat, multimodal)
 * - 'inference': Specialized models (image, audio, specialized tasks)
 *
 * @param category - Model category
 * @returns Session type
 *
 * @example
 * ```typescript
 * getSessionType('chat') // 'chat'
 * getSessionType('multimodal') // 'chat'
 * getSessionType('image') // 'inference'
 * ```
 */
export function getSessionType(category: ModelCategory): SessionType {
  return CATEGORY_CONFIGS[category].sessionType;
}

/**
 * Get compatible categories for a session type
 *
 * @param sessionType - Session type
 * @returns Array of compatible categories
 *
 * @example
 * ```typescript
 * getCompatibleCategories('chat')
 * // ['chat', 'multimodal']
 *
 * getCompatibleCategories('inference')
 * // ['image', 'audio', 'specialized']
 * ```
 */
export function getCompatibleCategories(sessionType: SessionType): ModelCategory[] {
  return getCategoriesForSessionType(sessionType);
}

/**
 * Check if two models are compatible for switching within the same session
 *
 * Models are compatible if they have the same session type.
 *
 * @param category1 - First model's category
 * @param category2 - Second model's category
 * @returns True if models can be used in the same session
 *
 * @example
 * ```typescript
 * areModelsCompatible('chat', 'multimodal') // true (both are 'chat' session type)
 * areModelsCompatible('chat', 'image') // false (different session types)
 * areModelsCompatible('image', 'audio') // true (both are 'inference' session type)
 * ```
 */
export function areModelsCompatible(
  category1: ModelCategory,
  category2: ModelCategory
): boolean {
  const sessionType1 = getSessionType(category1);
  const sessionType2 = getSessionType(category2);
  return sessionType1 === sessionType2;
}

/**
 * Get category configuration
 *
 * @param category - Model category
 * @returns Category configuration with metadata
 */
export function getCategoryConfig(category: ModelCategory): CategoryConfig {
  return CATEGORY_CONFIGS[category];
}

/**
 * Batch classify multiple models
 *
 * @param models - Array of models to classify
 * @returns Map of modelId to classification
 */
export function batchClassifyModels(
  models: Model[]
): Map<string, ModelClassification> {
  const classifications = new Map<string, ModelClassification>();

  for (const model of models) {
    const classification = classifyModel(model);
    classifications.set(model.id, classification);
  }

  return classifications;
}

/**
 * Check if a model supports a specific capability
 *
 * @param model - Model to check (must have computedCapabilities)
 * @param capability - Capability to check
 * @returns True if model supports the capability
 */
export function hasCapability(
  model: Model,
  capability: keyof ModelCapabilities
): boolean {
  if (!model.computedCapabilities) {
    // If not classified yet, classify on-the-fly
    const { capabilities } = classifyModel(model);
    return capabilities[capability];
  }

  return model.computedCapabilities[capability];
}
