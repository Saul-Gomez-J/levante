# Adding New MCP Providers

This guide explains how to add support for new MCP server providers (like Smithery, MCP.so, or custom registries) to Levante.

## Overview

The MCP Provider system allows Levante to fetch and display MCP servers from multiple sources. Each provider has:
- A unique ID and metadata
- A fetch method (local, API, or GitHub)
- A normalizer to convert the provider's format to Levante's `MCPRegistryEntry` format

## Step-by-Step Guide

### 1. Add Provider Definition

Add the new provider to `src/renderer/data/mcpProviders.json`:

```json
{
  "providers": [
    // ... existing providers
    {
      "id": "smithery",
      "name": "Smithery",
      "description": "MCP server marketplace",
      "icon": "store",
      "type": "api",
      "endpoint": "https://registry.smithery.ai/servers",
      "enabled": false
    }
  ]
}
```

**Provider fields:**
- `id`: Unique identifier (used in code and cache)
- `name`: Display name in UI
- `description`: Short description
- `icon`: Icon name (from lucide-react)
- `type`: `"local"` | `"api"` | `"github"`
- `endpoint`: URL or path to fetch data
- `enabled`: Whether provider is enabled by default
- `config` (optional): Additional configuration for GitHub providers

### 2. Define Response Types

In `src/main/services/mcp/MCPProviderService.ts`, add TypeScript interfaces for the provider's API response:

```typescript
// Example for Smithery
interface SmitheryServer {
  qualifiedName: string;
  displayName: string;
  description: string;
  homepage?: string;
  useCount?: number;
  isDeployed?: boolean;
  createdAt?: string;
}

interface SmitheryResponse {
  servers: SmitheryServer[];
}
```

### 3. Add Fetch Method (if needed)

If the provider uses a new fetch type, add the method to `MCPProviderService`:

```typescript
private async fetchFromAPI(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Levante-MCP-Client/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`API fetch failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}
```

### 4. Create Normalizer

Add a normalizer method that converts the provider's format to `MCPRegistryEntry[]`:

```typescript
private normalizeSmithery(data: SmitheryResponse, source: string): MCPRegistryEntry[] {
  return data.servers.map(server => ({
    id: `${source}-${server.qualifiedName.replace(/[/@]/g, '-')}`,
    name: server.displayName,
    description: server.description || '',
    category: 'general',
    icon: 'server',
    transport: { type: 'stdio' as const, autoDetect: true },
    source,
    configuration: {
      fields: [],
      defaults: { command: 'npx', args: `-y ${server.qualifiedName}` },
      template: {
        type: 'stdio' as const,
        command: 'npx',
        args: ['-y', server.qualifiedName],
        env: {}
      }
    },
    metadata: {
      useCount: server.useCount,
      homepage: server.homepage
    }
  }));
}
```

**Important considerations:**
- Generate unique `id` by prefixing with source: `${source}-${originalId}`
- Set `source` field to the provider ID
- Map category appropriately or default to `'general'`
- Configure `transport` and `configuration.template` based on how the server runs
- Store provider-specific data in `metadata`

### 5. Register in syncProvider

Update the `syncProvider` method to handle the new provider:

```typescript
async syncProvider(provider: MCPProvider): Promise<MCPRegistryEntry[]> {
  // ... existing code

  try {
    let entries: MCPRegistryEntry[];

    switch (provider.type) {
      case 'local':
        const localData = await this.fetchFromLocal(provider.endpoint);
        entries = this.normalizeLevante(localData, provider.id);
        break;

      case 'api':
        const apiData = await this.fetchFromAPI(provider.endpoint);
        // Route to correct normalizer based on provider ID
        if (provider.id === 'smithery') {
          entries = this.normalizeSmithery(apiData as SmitheryResponse, provider.id);
        } else if (provider.id === 'mcp-so') {
          entries = this.normalizeMcpSo(apiData as McpSoResponse, provider.id);
        } else {
          entries = [];
        }
        break;

      case 'github':
        const githubData = await this.fetchFromGitHub(
          provider.endpoint,
          provider.config?.branch || 'main',
          provider.config?.path || 'servers.json'
        );
        entries = this.normalizeAwesomeMcp(githubData as AwesomeMcpResponse, provider.id);
        break;

      default:
        entries = [];
    }

    // Cache and return
    await mcpCacheService.setCache(provider.id, entries);
    return entries;
  } catch (error) {
    // ... error handling
  }
}
```

### 6. Add Icon (optional)

If using a custom icon, add it to the `providerIcons` map in `src/renderer/components/mcp/store-page/provider-filter.tsx`:

```typescript
import { Home, Store, Globe, Star } from 'lucide-react';

const providerIcons: Record<string, React.ReactNode> = {
  home: <Home className="h-4 w-4" />,
  store: <Store className="h-4 w-4" />,
  globe: <Globe className="h-4 w-4" />,
  star: <Star className="h-4 w-4" />,
};
```

## Complete Example: Adding Smithery

### 1. Update mcpProviders.json

```json
{
  "version": "1.0.0",
  "lastUpdated": "2025-01-14",
  "providers": [
    {
      "id": "levante",
      "name": "Levante",
      "description": "Built-in curated MCP servers",
      "icon": "home",
      "type": "local",
      "endpoint": "mcpRegistry.json",
      "enabled": true
    },
    {
      "id": "smithery",
      "name": "Smithery",
      "description": "MCP server marketplace",
      "icon": "store",
      "type": "api",
      "endpoint": "https://registry.smithery.ai/servers",
      "enabled": false
    }
  ]
}
```

### 2. Update MCPProviderService.ts

```typescript
// Add types
interface SmitheryServer {
  qualifiedName: string;
  displayName: string;
  description: string;
  homepage?: string;
  useCount?: number;
}

interface SmitheryResponse {
  servers: SmitheryServer[];
}

// Add normalizer
private normalizeSmithery(data: SmitheryResponse, source: string): MCPRegistryEntry[] {
  return data.servers.map(server => ({
    id: `${source}-${server.qualifiedName.replace(/[/@]/g, '-')}`,
    name: server.displayName,
    description: server.description || '',
    category: 'general',
    icon: 'server',
    transport: { type: 'stdio' as const, autoDetect: true },
    source,
    configuration: {
      fields: [],
      defaults: { command: 'npx', args: `-y ${server.qualifiedName}` },
      template: {
        type: 'stdio' as const,
        command: 'npx',
        args: ['-y', server.qualifiedName],
        env: {}
      }
    },
    metadata: {
      useCount: server.useCount,
      homepage: server.homepage
    }
  }));
}

// Add fetch method
private async fetchFromAPI(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Levante-MCP-Client/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`API fetch failed: ${response.status}`);
  }

  return response.json();
}

// Update syncProvider
async syncProvider(provider: MCPProvider): Promise<MCPRegistryEntry[]> {
  logger.mcp.info('Syncing provider', { providerId: provider.id });

  try {
    let entries: MCPRegistryEntry[];

    if (provider.type === 'local') {
      const rawData = await this.fetchFromLocal(provider.endpoint);
      entries = this.normalizeLevante(rawData, provider.id);
    } else if (provider.type === 'api') {
      const rawData = await this.fetchFromAPI(provider.endpoint);

      if (provider.id === 'smithery') {
        entries = this.normalizeSmithery(rawData as SmitheryResponse, provider.id);
      } else {
        entries = [];
      }
    } else {
      entries = [];
    }

    await mcpCacheService.setCache(provider.id, entries);
    return entries;
  } catch (error) {
    logger.mcp.error('Failed to sync provider', { providerId: provider.id, error });
    throw error;
  }
}
```

## Testing

1. Enable the provider in `mcpProviders.json` (set `enabled: true`)
2. Run the app and go to MCP Store
3. Select the new provider from the filter dropdown
4. Click the sync button to fetch servers
5. Verify servers appear correctly with proper names, descriptions, and source badges

## Best Practices

1. **Unique IDs**: Always prefix server IDs with the provider source to avoid collisions
2. **Error Handling**: Handle API errors gracefully and log them
3. **Caching**: The cache system handles persistence automatically
4. **Rate Limiting**: Consider adding delays between requests for providers with rate limits
5. **Validation**: Validate API responses before normalizing
6. **Metadata**: Store useful provider-specific data in the `metadata` field

## Troubleshooting

### Servers not appearing
- Check browser console for errors
- Verify the API endpoint is accessible
- Ensure the normalizer returns valid `MCPRegistryEntry` objects

### Cache issues
- Cache is stored in `~/levante/mcp-cache/{providerId}.json`
- Clear cache by deleting the file or calling `mcpCacheService.clearCache(providerId)`

### Type errors
- Ensure all required fields are present in normalized entries
- Check that `transport.type` matches `configuration.template.type`
