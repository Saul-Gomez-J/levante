/**
 * Schema Sanitizer Module
 *
 * Provides provider-specific JSON Schema sanitization for MCP tools.
 * Different AI providers have different requirements for JSON Schema validation.
 */

import type { ProviderType, SchemaSanitizer, SanitizerRegistry } from './types';
import { baseSanitizer } from './baseSanitizer';
import { geminiSanitizer } from './geminiSanitizer';

export type { ProviderType, SchemaSanitizer } from './types';

/**
 * Registry of sanitizers per provider
 *
 * - google: Strict validation, requires properties on objects, items on arrays
 * - openai: Permissive, passes through most schemas
 * - anthropic: Permissive, passes through most schemas
 * - openrouter: Uses gemini sanitizer (can route to Google models)
 * - gateway: Uses gemini sanitizer (can route to any provider)
 * - local: Permissive (Ollama, etc.)
 */
const sanitizerRegistry: SanitizerRegistry = {
  google: geminiSanitizer,
  openai: baseSanitizer,
  anthropic: baseSanitizer,
  openrouter: geminiSanitizer, // OpenRouter can use Google models
  gateway: geminiSanitizer,    // Gateway can route to any provider
  local: baseSanitizer,
};

/**
 * Get the appropriate sanitizer for a provider
 */
export function getSanitizer(provider?: ProviderType): SchemaSanitizer {
  if (!provider) {
    // Default to the strictest sanitizer for safety
    return geminiSanitizer;
  }
  return sanitizerRegistry[provider] || geminiSanitizer;
}

/**
 * Sanitize a schema for a specific provider
 *
 * @param schema - The JSON Schema to sanitize
 * @param provider - The AI provider type (defaults to strictest)
 * @param path - Debug path for logging (optional)
 */
export function sanitizeSchema(
  schema: any,
  provider?: ProviderType,
  path: string = 'root'
): any {
  const sanitizer = getSanitizer(provider);
  return sanitizer(schema, path);
}

/**
 * Check if a provider requires strict schema sanitization
 */
export function requiresStrictSanitization(provider?: ProviderType): boolean {
  if (!provider) return true;
  return provider === 'google' || provider === 'openrouter' || provider === 'gateway';
}

// Re-export individual sanitizers for direct use
export { baseSanitizer } from './baseSanitizer';
export { geminiSanitizer } from './geminiSanitizer';
