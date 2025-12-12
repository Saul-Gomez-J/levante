export interface LevanteAPIResponse {
  version: string;
  provider: {
    id: string;
    name: string;
    homepage: string;
  };
  servers: LevanteAPIServer[];
}

export interface LevanteAPIServer {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  logoUrl?: string;
  provider: string;  // "levante" | "aitempl" | etc.
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, EnvFieldConfig | string>;
  metadata?: {
    useCount?: number;
    homepage?: string;
    author?: string;
    repository?: string;
  };
}

export interface EnvFieldConfig {
  label: string;
  required: boolean;
  type: string;
  default?: string;
}

export interface MCPRegistryEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  logoUrl?: string; // URL de logo, opcional
  source?: string; // Mantener para compatibilidad (será "levante-store")
  provider?: string; // NUEVO: origen real del MCP ("levante", "aitempl", etc.)
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
  type: 'api';  // Solo tipo API ahora
  endpoint: string;
  enabled: boolean;
  homepage?: string;
  lastSynced?: string;
  serverCount?: number;
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
  baseUrl?: string;
  headers?: Record<string, string>;
  transport: 'stdio' | 'http' | 'sse';
  enabled?: boolean;  // Added by listServers(), not stored in JSON
  runtime?: {
    type?: string;
    version?: string;
    source?: 'system' | 'levante';
    path?: string;
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