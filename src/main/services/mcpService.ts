// Re-export the modular implementation
export { MCPService } from './mcp/index.js'; // Legacy - for backwards compatibility
export { MCPServiceFactory } from './mcp/mcpServiceFactory.js';
export { MCPUseService } from './mcp/mcpUseService.js';
export { MCPLegacyService } from './mcp/mcpLegacyService.js';
export type { IMCPService } from './mcp/IMCPService.js';
export type { MCPRegistry, MCPRegistryEntry, MCPDeprecatedEntry } from './mcp/types';
