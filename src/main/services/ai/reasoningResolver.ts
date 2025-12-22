/**
 * Reasoning Resolver Module
 *
 * Centralizes all reasoning model configuration logic for multi-provider support.
 * Handles the translation of ReasoningConfig into provider-specific options.
 *
 * Supported providers:
 * - OpenRouter: Uses unified `reasoning` parameter
 * - OpenAI: Uses `reasoningSummary` and `reasoningEffort`
 * - Google: Uses `thinkingConfig`
 * - Anthropic: Uses `thinking` with budgetTokens
 * - Others: Safe fallback (no reasoning options)
 */

import type {
  ReasoningConfig,
  ReasoningEffort,
} from '../../../types/reasoning';
import {
  DEFAULT_REASONING_CONFIG,
  REASONING_MODEL_PATTERNS,
} from '../../../types/reasoning';
import type { ProviderConfig, ProviderType } from '../../../types/models';
import { getLogger } from '../logging';

const logger = getLogger();

/**
 * Resolves the reasoning configuration for a specific model/provider combination.
 *
 * Priority order:
 * 1. Provider-specific settings (provider.settings.reasoning)
 * 2. Global AI preferences (aiConfig.reasoning)
 * 3. Default configuration (adaptive mode)
 *
 * @param modelId - The model identifier
 * @param provider - The provider configuration
 * @param globalConfig - Global reasoning config from AI preferences
 * @returns The resolved reasoning configuration
 */
export function getReasoningConfig(
  modelId: string,
  provider: ProviderConfig,
  globalConfig?: ReasoningConfig
): ReasoningConfig {
  // Priority 1: Provider-specific settings
  const providerConfig = provider.settings?.reasoning as ReasoningConfig | undefined;
  if (providerConfig) {
    logger.aiSdk.debug('Using provider-specific reasoning config', {
      modelId,
      providerId: provider.id,
      config: providerConfig,
    });
    return providerConfig;
  }

  // Priority 2: Global config from AI preferences
  if (globalConfig) {
    logger.aiSdk.debug('Using global reasoning config', {
      modelId,
      config: globalConfig,
    });
    return globalConfig;
  }

  // Priority 3: Default (adaptive mode)
  logger.aiSdk.debug('Using default reasoning config (adaptive)', {
    modelId,
  });
  return DEFAULT_REASONING_CONFIG;
}

/**
 * Converts ReasoningConfig to provider-specific options for streamText.
 *
 * @param config - The reasoning configuration
 * @param providerType - The type of provider (openrouter, openai, google, etc.)
 * @param modelId - The model identifier
 * @returns Provider-specific options object or undefined if disabled/prompt-based
 */
export function buildProviderOptions(
  config: ReasoningConfig,
  providerType: ProviderType,
  modelId: string
): Record<string, unknown> | undefined {
  // Skip if disabled or prompt-based (no API parameters needed)
  if (config.mode === 'disabled' || config.mode === 'prompt-based') {
    logger.aiSdk.debug('Reasoning mode skips provider options', {
      mode: config.mode,
      modelId,
    });
    return undefined;
  }

  // Build provider-specific options
  switch (providerType) {
    case 'openrouter':
      return buildOpenRouterOptions(config, modelId);

    case 'openai':
      return buildOpenAIOptions(config, modelId);

    case 'google':
      return buildGoogleOptions(config, modelId);

    case 'anthropic':
      return buildAnthropicOptions(config, modelId);

    case 'vercel-gateway':
      // Vercel Gateway proxies to underlying providers
      // Try to detect provider from model ID and apply appropriate options
      return buildVercelGatewayOptions(config, modelId);

    default:
      // For other providers (groq, xai, huggingface, local), no reasoning options
      logger.aiSdk.debug('No reasoning options for provider type', {
        providerType,
        modelId,
      });
      return undefined;
  }
}

/**
 * Build OpenRouter reasoning options using their unified API.
 * OpenRouter normalizes reasoning across all providers.
 *
 * @see https://openrouter.ai/docs/use-cases/reasoning-tokens
 */
function buildOpenRouterOptions(
  config: ReasoningConfig,
  modelId: string
): Record<string, unknown> {
  const reasoning: Record<string, unknown> = {
    enabled: config.mode === 'always' || config.mode === 'adaptive',
  };

  // Only set effort/maxTokens in 'always' mode
  if (config.mode === 'always') {
    if (config.maxTokens) {
      // maxTokens takes precedence over effort
      reasoning.max_tokens = config.maxTokens;
    } else if (config.effort) {
      reasoning.effort = config.effort;
    } else {
      // Default effort for 'always' mode
      reasoning.effort = 'medium';
    }
  }

  if (config.excludeFromResponse) {
    reasoning.exclude = true;
  }

  logger.aiSdk.debug('Built OpenRouter reasoning options', {
    modelId,
    reasoning,
  });

  // OpenRouter uses top-level 'reasoning' parameter (not nested under provider)
  return { reasoning };
}

/**
 * Build OpenAI reasoning options.
 * Uses reasoningSummary and optionally reasoningEffort.
 */
function buildOpenAIOptions(
  config: ReasoningConfig,
  modelId: string
): Record<string, unknown> | undefined {
  const lowerModelId = modelId.toLowerCase();

  // Check if model supports reasoning
  const isReasoningModel = REASONING_MODEL_PATTERNS.openai.some(
    pattern => lowerModelId.includes(pattern)
  );

  if (!isReasoningModel) {
    logger.aiSdk.debug('OpenAI model does not support reasoning', { modelId });
    return undefined;
  }

  const openaiOptions: Record<string, unknown> = {
    // Always request detailed reasoning summary to get the text
    reasoningSummary: 'detailed',
  };

  // Only set reasoningEffort in 'always' mode
  if (config.mode === 'always' && config.effort) {
    openaiOptions.reasoningEffort = mapEffortToOpenAI(config.effort);
  }

  logger.aiSdk.debug('Built OpenAI reasoning options', {
    modelId,
    openaiOptions,
  });

  return { openai: openaiOptions };
}

/**
 * Map our effort levels to OpenAI's supported values.
 * OpenAI supports: 'low', 'medium', 'high'
 */
function mapEffortToOpenAI(effort: ReasoningEffort): string {
  switch (effort) {
    case 'minimal':
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
    case 'xhigh':
      return 'high';
    default:
      return 'medium';
  }
}

/**
 * Build Google reasoning options using thinkingConfig.
 */
function buildGoogleOptions(
  config: ReasoningConfig,
  modelId: string
): Record<string, unknown> | undefined {
  const lowerModelId = modelId.toLowerCase();

  // Check if model supports thinking
  const isThinkingModel = REASONING_MODEL_PATTERNS.google.some(
    pattern => lowerModelId.includes(pattern)
  );

  if (!isThinkingModel) {
    logger.aiSdk.debug('Google model does not support thinking', { modelId });
    return undefined;
  }

  const googleOptions: Record<string, unknown> = {
    thinkingConfig: {
      includeThoughts: true,
    },
  };

  logger.aiSdk.debug('Built Google reasoning options', {
    modelId,
    googleOptions,
  });

  return { google: googleOptions };
}

/**
 * Build Anthropic reasoning options using thinking config.
 */
function buildAnthropicOptions(
  config: ReasoningConfig,
  modelId: string
): Record<string, unknown> | undefined {
  const lowerModelId = modelId.toLowerCase();

  // Check if model supports extended thinking
  const supportsThinking = REASONING_MODEL_PATTERNS.anthropic.some(
    pattern => lowerModelId.includes(pattern)
  );

  if (!supportsThinking) {
    logger.aiSdk.debug('Anthropic model does not support thinking', { modelId });
    return undefined;
  }

  const anthropicOptions: Record<string, unknown> = {
    thinking: {
      enabled: config.mode === 'always' || config.mode === 'adaptive',
      budgetTokens: config.maxTokens || 4096,
    },
  };

  logger.aiSdk.debug('Built Anthropic reasoning options', {
    modelId,
    anthropicOptions,
  });

  return { anthropic: anthropicOptions };
}

/**
 * Build Vercel Gateway reasoning options.
 * Attempts to detect the underlying provider from model ID.
 */
function buildVercelGatewayOptions(
  config: ReasoningConfig,
  modelId: string
): Record<string, unknown> | undefined {
  const lowerModelId = modelId.toLowerCase();

  // Try to detect underlying provider
  if (lowerModelId.includes('gpt') || lowerModelId.includes('o1') || lowerModelId.includes('o3')) {
    return buildOpenAIOptions(config, modelId);
  }

  if (lowerModelId.includes('gemini')) {
    return buildGoogleOptions(config, modelId);
  }

  if (lowerModelId.includes('claude')) {
    return buildAnthropicOptions(config, modelId);
  }

  logger.aiSdk.debug('Could not detect provider for Vercel Gateway model', { modelId });
  return undefined;
}

/**
 * Check if a model should use reasoning middleware for <think> tag extraction.
 * This is specifically for DeepSeek R1 and similar models that use tags.
 *
 * @param modelId - The model identifier
 * @returns True if middleware should be applied
 */
export function shouldUseReasoningMiddleware(modelId: string): boolean {
  const lowerModelId = modelId.toLowerCase();

  return REASONING_MODEL_PATTERNS.deepseek.some(
    pattern => lowerModelId.includes(pattern)
  );
}
