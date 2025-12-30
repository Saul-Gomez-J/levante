import { getLogger } from '../../logging';
import type { SchemaSanitizer } from './types';

const logger = getLogger();

/**
 * Sanitize JSON Schema for Google Generative AI compatibility
 *
 * Google's API strictly validates schemas and requires:
 * 1. Objects must have "properties" field (even if empty)
 * 2. Arrays must have "items" field with valid schema
 * 3. Required arrays must only reference existing properties
 * 4. No additionalProperties: true/false (not supported)
 *
 * This function recursively fixes these issues with deep cloning.
 */
export const geminiSanitizer: SchemaSanitizer = (schema: any, path: string = 'root'): any => {
  // Handle null/undefined
  if (schema === null || schema === undefined) {
    return { type: 'string' }; // Default fallback
  }

  // Handle primitives (shouldn't happen at top level, but safety check)
  if (typeof schema !== 'object') {
    return { type: 'string' };
  }

  // Handle actual JS arrays in schema (like enum values)
  if (Array.isArray(schema)) {
    return schema.map((item, i) => geminiSanitizer(item, `${path}[${i}]`));
  }

  // Deep clone the schema object
  const result: Record<string, any> = {};

  // Copy all primitive fields first
  for (const [key, value] of Object.entries(schema)) {
    if (value === null || value === undefined) {
      continue; // Skip null/undefined values
    }

    if (key === 'properties') {
      // Recursively sanitize each property
      const sanitizedProps: Record<string, any> = {};
      if (typeof value === 'object' && value !== null) {
        for (const [propName, propDef] of Object.entries(value)) {
          sanitizedProps[propName] = geminiSanitizer(propDef, `${path}.${propName}`);
        }
      }
      result.properties = sanitizedProps;
    } else if (key === 'items') {
      // Recursively sanitize array items
      result.items = geminiSanitizer(value, `${path}.items`);
    } else if (key === 'additionalProperties') {
      // Handle additionalProperties - convert to proper schema or remove
      if (typeof value === 'boolean') {
        // Google doesn't like additionalProperties: true/false, skip it
        continue;
      } else if (typeof value === 'object') {
        result.additionalProperties = geminiSanitizer(value, `${path}.additionalProperties`);
      }
    } else if (key === 'required') {
      // Copy required array - we'll filter it later
      if (Array.isArray(value)) {
        result.required = [...value];
      }
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      // Recursively handle nested objects (allOf, oneOf, anyOf, etc.)
      result[key] = geminiSanitizer(value, `${path}.${key}`);
    } else {
      // Copy primitive values directly
      result[key] = value;
    }
  }

  // Now apply fixes based on type
  const schemaType = result.type;

  // Fix object types
  if (schemaType === 'object' || (!schemaType && result.properties)) {
    // Ensure type is set
    result.type = 'object';

    // Ensure properties exists
    if (!result.properties) {
      result.properties = {};
    }

    // Filter required array:
    // 1. Property must exist in properties
    // 2. Property must have a valid type (not empty object)
    // 3. If type is 'object', it must have properties defined
    // Google rejects required properties that are undefined or invalid
    if (result.required && Array.isArray(result.required)) {
      const existingProps = Object.keys(result.properties);
      const filtered = result.required.filter((prop: unknown) => {
        // Ensure prop is a string
        if (typeof prop !== 'string') {
          logger.aiSdk.debug("Removing non-string from required", { path, prop });
          return false;
        }

        // Must exist in properties
        if (!existingProps.includes(prop)) {
          logger.aiSdk.debug("Removing non-existent property from required", {
            path,
            property: prop,
            existingProps
          });
          return false;
        }

        // Check if property has a valid schema
        const propSchema = result.properties[prop];
        if (!propSchema || typeof propSchema !== 'object') {
          logger.aiSdk.debug("Removing invalid property schema from required", {
            path,
            property: prop
          });
          return false;
        }

        // Property must have a type defined
        if (!propSchema.type) {
          logger.aiSdk.debug("Removing property without type from required", {
            path,
            property: prop,
            propSchema
          });
          return false;
        }

        // If type is 'object', it must have real properties
        if (propSchema.type === 'object') {
          const hasRealProperties = propSchema.properties &&
            typeof propSchema.properties === 'object' &&
            Object.keys(propSchema.properties).length > 0;
          if (!hasRealProperties) {
            logger.aiSdk.debug("Removing empty object from required", {
              path,
              property: prop
            });
            return false;
          }
        }

        return true;
      });

      if (filtered.length !== result.required.length) {
        logger.aiSdk.debug("Filtered invalid required properties", {
          path,
          original: result.required,
          filtered,
          existing: existingProps
        });
      }

      if (filtered.length === 0) {
        delete result.required;
      } else {
        result.required = filtered;
      }
    }
  }

  // Fix array types
  if (schemaType === 'array') {
    // Ensure items exists with a valid schema
    if (!result.items) {
      result.items = { type: 'string' }; // Default to string items
      logger.aiSdk.debug("Added default items schema to array", { path });
    } else {
      // Check if items is an empty object {} (no type field, no properties)
      const itemsIsEmptyObject = typeof result.items === 'object' &&
        !result.items.type &&
        Object.keys(result.items).length === 0;

      // Check if items is type: object but with no real properties
      const itemsIsEmptyObjectType = result.items.type === 'object' &&
        (!result.items.properties || Object.keys(result.items.properties).length === 0);

      if (itemsIsEmptyObject || itemsIsEmptyObjectType) {
        result.items = { type: 'string' };
        logger.aiSdk.debug("Converted invalid/empty items to string type", {
          path,
          wasEmptyObject: itemsIsEmptyObject,
          wasEmptyObjectType: itemsIsEmptyObjectType
        });
      }
    }
  }

  // Final safety check: if result is an empty object, convert to string schema
  // Empty objects {} are invalid in Google's API
  if (Object.keys(result).length === 0) {
    logger.aiSdk.debug("Converting empty schema object to string type", { path });
    return { type: 'string' };
  }

  return result;
};
