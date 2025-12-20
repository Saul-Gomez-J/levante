import type { SchemaSanitizer } from './types';

/**
 * Base sanitizer - passes through schema unchanged
 * Used for providers that are permissive with JSON Schema
 */
export const baseSanitizer: SchemaSanitizer = (schema: any): any => {
  return schema;
};
