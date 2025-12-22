/**
 * Reasoning configuration types for AI models
 *
 * Supports multiple providers with different reasoning implementations:
 * - OpenRouter: Unified `reasoning` parameter with effort levels
 * - OpenAI: `reasoningSummary` and `reasoningEffort` options
 * - Google: `thinkingConfig` with includeThoughts
 * - Anthropic: `thinking` with budgetTokens
 */

/**
 * Reasoning effort levels
 * Based on OpenRouter's unified API which normalizes across providers
 *
 * Effort ratios (percentage of max_tokens allocated to reasoning):
 * - minimal: ~10%
 * - low: ~20%
 * - medium: ~50%
 * - high: ~80%
 * - xhigh: ~95%
 */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * Reasoning mode determines how reasoning is triggered
 *
 * - adaptive: Let model decide based on task complexity (default, recommended)
 *   Works with prompts like "think step by step"
 * - always: Always request reasoning output from models that support it
 * - prompt-based: Only trigger reasoning through prompts, no API parameters sent
 * - disabled: Never use reasoning features
 */
export type ReasoningMode = 'adaptive' | 'always' | 'prompt-based' | 'disabled';

/**
 * Provider-level reasoning configuration
 * Can be set globally in AI preferences or per-provider in ProviderConfig.settings
 */
export interface ReasoningConfig {
  /** Global reasoning mode for this provider/globally */
  mode: ReasoningMode;

  /** Effort level when mode is 'always' (optional, mutually exclusive with maxTokens) */
  effort?: ReasoningEffort;

  /** Max tokens for reasoning - alternative to effort (optional, mutually exclusive with effort) */
  maxTokens?: number;

  /** Whether to exclude reasoning from response (model still uses it internally) */
  excludeFromResponse?: boolean;
}

/**
 * Default reasoning configuration
 * Uses adaptive mode which lets the model decide when to reason
 */
export const DEFAULT_REASONING_CONFIG: ReasoningConfig = {
  mode: 'adaptive',
};

/**
 * Model patterns that are known to support reasoning
 * Used as fallback when no explicit configuration exists
 */
export const REASONING_MODEL_PATTERNS = {
  openai: [
    'gpt-5',
    'o1',
    'o3',
  ],
  google: [
    'gemini-2.0',
    'gemini-2.5',
    'gemini-3',
  ],
  anthropic: [
    'claude-3.5',
    'claude-3.7',
    'claude-4',
    'claude-sonnet-4',
    'claude-opus-4',
  ],
  deepseek: [
    'deepseek-r1',
    'deepseek-reasoner',
    'r1-distill',
  ],
} as const;
