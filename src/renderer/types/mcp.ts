export interface MCPRegistryEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  transport: {
    type: 'stdio' | 'http' | 'sse';
    autoDetect: boolean;
  };
  configuration: {
    fields: MCPConfigField[];
    defaults?: Record<string, any>;
    template?: {
      type: 'stdio' | 'http' | 'sse';
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      baseUrl?: string;
      headers?: Record<string, string>;
    };
  };
  // Provider source
  source?: string; // 'levante' | 'smithery' | 'mcp-so' | 'awesome-mcp' | etc.
  // Additional metadata from external providers
  metadata?: {
    useCount?: number;
    homepage?: string;
    author?: string;
    repository?: string;
    path?: string;
  };
}

export interface MCPProvider {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: 'local' | 'github' | 'api';
  endpoint: string;
  enabled: boolean;
  homepage?: string;
  lastSynced?: string;
  serverCount?: number;
  // Type-specific configuration
  config?: {
    branch?: string;        // For GitHub
    path?: string;          // Path to registry file
    authRequired?: boolean;
    authToken?: string;
  };
}

export interface MCPConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'number' | 'boolean' | 'textarea';
  required: boolean;
  description: string;
  placeholder?: string;
  options?: string[];
  defaultValue?: any;
}

export interface MCPRegistry {
  version: string;
  entries: MCPRegistryEntry[];
}

export interface MCPServerConfig {
  id: string;
  name?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  baseUrl?: string; // Legacy support, prefer 'url'
  headers?: Record<string, string>;
  transport: 'stdio' | 'http' | 'sse';
  enabled?: boolean;  // Added by listServers(), not stored in JSON
  runtime?: {
    type?: 'node' | 'python';
    version?: string;
    source?: 'system' | 'shared';
  };
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

export type MCPConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';