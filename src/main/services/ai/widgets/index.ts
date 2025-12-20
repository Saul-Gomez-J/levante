/**
 * Widgets Module
 *
 * Provides widget utilities for MCP tools.
 * Supports multiple widget protocols:
 * - MCP Apps (SEP-1865): window.mcpApp API with JSON-RPC 2.0
 * - OpenAI Apps SDK: window.openai API with custom postMessage
 * - MCP-UI: Inline ui:// resources (handled by @mcp-ui/client)
 *
 * Detection priority follows MCPJam Inspector:
 * 1. MCP Apps: ui/resourceUri in tool metadata
 * 2. OpenAI Apps SDK: openai/outputTemplate in tool metadata
 * 3. MCP-UI: Inline ui:// resource in tool result
 */

// Protocol types and detection
export {
  detectWidgetProtocol,
  extractWidgetMetadata,
} from './types';
export type {
  WidgetProtocol,
  WidgetMetadata,
  WidgetBridgeOptions,
  WidgetHostContext,
} from './types';

// MCP Apps bridge (SEP-1865)
export {
  generateMcpAppsBridgeScript,
  injectMcpAppsBridge,
} from './mcpAppsBridge';

// OpenAI Apps SDK bridge
export { injectAppsSdkBridge } from './appsSdkBridge';
export type { AppsSdkBridgeOptions } from './appsSdkBridge';

// HTML utilities
export { escapeHtml, injectDataIntoHtml } from './htmlUtils';
