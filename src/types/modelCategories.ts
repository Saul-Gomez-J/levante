/**
 * Model Classification System - Core Types
 *
 * Defines categories and capabilities for AI models to enable:
 * - Category-based filtering in UI
 * - Session type enforcement
 * - Capability-aware routing
 *
 * @module modelCategories
 */

/**
 * Model categories based on functional purpose (Minimalista approach)
 */
export type ModelCategory =
  | 'chat'        // Standard conversational AI (GPT-4, Claude, Llama, etc.)
  | 'multimodal'  // Chat with vision/audio capabilities (GPT-4V, Claude 3, Gemini)
  | 'image'       // Image generation/transformation (DALL-E, Stable Diffusion, FLUX)
  | 'audio'       // Text-to-speech and speech-to-text (Whisper, TTS models)
  | 'specialized' // Document QA, Table QA, Visual QA, and other specialized tasks
  ;

/**
 * Structured model capabilities
 * These are computed from model metadata and category
 */
export interface ModelCapabilities {
  /** Supports function/tool calling (MCP integration) */
  supportsTools: boolean;

  /** Can process image inputs */
  supportsVision: boolean;

  /** Supports token streaming */
  supportsStreaming: boolean;

  /** Requires file attachment to function */
  requiresAttachment: boolean;

  /** Can generate audio outputs */
  supportsAudioOut: boolean;

  /** Can process audio inputs */
  supportsAudioIn: boolean;

  /** Supports system prompts */
  supportsSystemPrompt: boolean;

  /** Supports multi-turn conversations */
  supportsMultiTurn: boolean;
}

/**
 * Session type derived from category
 * Used to enforce model compatibility within sessions
 */
export type SessionType = 'chat' | 'inference';

/**
 * Configuration for each category
 */
export interface CategoryConfig {
  id: ModelCategory;
  label: string;
  description: string;
  sessionType: SessionType;
  defaultCapabilities: Partial<ModelCapabilities>;
}

/**
 * Category definitions with metadata
 */
export const CATEGORY_CONFIGS: Record<ModelCategory, CategoryConfig> = {
  chat: {
    id: 'chat',
    label: 'Chat',
    description: 'Standard conversational AI models',
    sessionType: 'chat',
    defaultCapabilities: {
      supportsStreaming: true,
      supportsMultiTurn: true,
      supportsSystemPrompt: true,
      requiresAttachment: false,
      supportsAudioOut: false,
      supportsAudioIn: false,
    },
  },

  multimodal: {
    id: 'multimodal',
    label: 'Multimodal',
    description: 'Chat models with vision and/or audio capabilities',
    sessionType: 'chat',
    defaultCapabilities: {
      supportsStreaming: true,
      supportsMultiTurn: true,
      supportsSystemPrompt: true,
      supportsVision: true,
      requiresAttachment: false,
      supportsAudioOut: false,
      supportsAudioIn: false,
    },
  },

  image: {
    id: 'image',
    label: 'Image',
    description: 'Image generation and transformation models',
    sessionType: 'inference',
    defaultCapabilities: {
      supportsStreaming: false,
      supportsMultiTurn: false,
      supportsSystemPrompt: false,
      supportsTools: false,
      supportsVision: false,
      requiresAttachment: false, // text-to-image doesn't require attachment
      supportsAudioOut: false,
      supportsAudioIn: false,
    },
  },

  audio: {
    id: 'audio',
    label: 'Audio',
    description: 'Text-to-speech and speech-to-text models',
    sessionType: 'inference',
    defaultCapabilities: {
      supportsStreaming: false,
      supportsMultiTurn: false,
      supportsSystemPrompt: false,
      supportsTools: false,
      supportsVision: false,
      requiresAttachment: false,
      supportsAudioOut: true, // TTS
      supportsAudioIn: true,  // STT
    },
  },

  specialized: {
    id: 'specialized',
    label: 'Specialized',
    description: 'Document QA, Table QA, Visual QA, and other specialized tasks',
    sessionType: 'inference',
    defaultCapabilities: {
      supportsStreaming: false,
      supportsMultiTurn: false,
      supportsSystemPrompt: false,
      supportsTools: false,
      requiresAttachment: true, // Most specialized tasks require attachments
      supportsAudioOut: false,
      supportsAudioIn: false,
    },
  },
};

/**
 * Display names for categories (for UI)
 */
export const CATEGORY_DISPLAY_NAMES: Record<ModelCategory, string> = {
  chat: 'Chat',
  multimodal: 'Multimodal Chat',
  image: 'Image Generation',
  audio: 'Audio',
  specialized: 'Specialized',
};

/**
 * Get category configuration
 */
export function getCategoryConfig(category: ModelCategory): CategoryConfig {
  return CATEGORY_CONFIGS[category];
}

/**
 * Get all categories for a session type
 */
export function getCategoriesForSessionType(sessionType: SessionType): ModelCategory[] {
  return Object.values(CATEGORY_CONFIGS)
    .filter(config => config.sessionType === sessionType)
    .map(config => config.id);
}
