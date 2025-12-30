/**
 * Types for schema sanitization
 */

/**
 * Supported AI provider types
 */
export type ProviderType = 'google' | 'openai' | 'anthropic' | 'openrouter' | 'local' | 'gateway';

/**
 * Schema sanitizer function signature
 */
export type SchemaSanitizer = (schema: any, path?: string) => any;

/**
 * Registry of sanitizers per provider
 */
export type SanitizerRegistry = Record<ProviderType, SchemaSanitizer>;
