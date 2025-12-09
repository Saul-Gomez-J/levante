/**
 * Types for MCP UI Resource integration
 */

import type { UIActionResult } from '@mcp-ui/client';

// Re-export UIActionResult for convenience
export type { UIActionResult };

/**
 * Inner resource structure (uri, mimeType, text/blob)
 */
export interface UIResourceInner {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * UI Resource structure matching EmbeddedResource from MCP SDK
 * This is the format expected by UIResourceRenderer
 */
export interface UIResource {
  type: 'resource';
  resource: UIResourceInner;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Legacy alias for backwards compatibility
 */
export type UIResourceContent = UIResource;

/**
 * Display modes for UI Resources
 */
export type UIResourceDisplayMode = 'inline' | 'pip' | 'fullscreen';

/**
 * Props for UI Resource rendering components
 */
export interface UIResourceRenderProps {
  resource: UIResource;
  serverId?: string;
  displayMode?: UIResourceDisplayMode;
  onDisplayModeChange?: (mode: UIResourceDisplayMode) => void;
}

/**
 * Check if content is a UI resource (EmbeddedResource with ui:// URI)
 */
export function isUIResourceContent(content: unknown): content is UIResource {
  if (!content || typeof content !== 'object') return false;
  const c = content as Record<string, unknown>;

  // Check for EmbeddedResource structure: { type: "resource", resource: { uri: "ui://..." } }
  if (c.type === 'resource' && typeof c.resource === 'object' && c.resource !== null) {
    const inner = c.resource as Record<string, unknown>;
    return typeof inner.uri === 'string' && inner.uri.startsWith('ui://');
  }

  return false;
}

/**
 * Check if a raw resource object has ui:// URI (inner resource without wrapper)
 */
export function isUIResourceInner(resource: unknown): resource is UIResourceInner {
  if (!resource || typeof resource !== 'object') return false;
  const r = resource as Record<string, unknown>;
  return typeof r.uri === 'string' && r.uri.startsWith('ui://');
}

/**
 * Wrap a raw resource in EmbeddedResource structure if needed
 */
export function wrapAsUIResource(content: unknown): UIResource | null {
  if (!content || typeof content !== 'object') return null;

  // Already wrapped
  if (isUIResourceContent(content)) {
    return content;
  }

  // Raw resource with ui:// URI - wrap it
  if (isUIResourceInner(content)) {
    return {
      type: 'resource',
      resource: content,
    };
  }

  return null;
}

/**
 * Extract UI resources from tool output
 * Returns array of UIResource (EmbeddedResource format) ready for UIResourceRenderer
 *
 * Handles multiple formats:
 * - Direct array of resources
 * - Object with `uiResources` array (from mcpToolsAdapter)
 * - Object with `content` array (raw MCP format)
 * - Single resource object
 */
export function extractUIResources(toolOutput: unknown): UIResource[] {
  if (!toolOutput) return [];

  const results: UIResource[] = [];

  // Handle array of content
  if (Array.isArray(toolOutput)) {
    for (const item of toolOutput) {
      const wrapped = wrapAsUIResource(item);
      if (wrapped) results.push(wrapped);
    }
    return results;
  }

  // Handle object formats
  if (typeof toolOutput === 'object') {
    const obj = toolOutput as Record<string, unknown>;

    // Format from mcpToolsAdapter: { text, content, uiResources }
    if ('uiResources' in obj && Array.isArray(obj.uiResources)) {
      for (const item of obj.uiResources) {
        const wrapped = wrapAsUIResource(item);
        if (wrapped) results.push(wrapped);
      }
      if (results.length > 0) return results;
    }

    // Raw MCP format: { content: [...] }
    if ('content' in obj && Array.isArray(obj.content)) {
      for (const item of obj.content) {
        const wrapped = wrapAsUIResource(item);
        if (wrapped) results.push(wrapped);
      }
      if (results.length > 0) return results;
    }

    // Single resource object
    const wrapped = wrapAsUIResource(toolOutput);
    if (wrapped) {
      return [wrapped];
    }
  }

  return results;
}
