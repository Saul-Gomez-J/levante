# MCP Discovery Tool

The MCP Discovery tool enables the AI to proactively suggest relevant MCP servers when a user's request cannot be fulfilled with currently configured tools. This bridges the gap between user intent and available capabilities.

## Overview

When a user asks for something that requires an MCP server they haven't configured (e.g., "Can you access my GitHub?"), the AI can:

1. Search the MCP Shop for relevant servers
2. Present matching options with configure buttons
3. Allow one-click configuration without leaving the chat
4. Continue helping once the server is configured

## User Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ User: "Can you access my GitHub repositories?"                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ AI: Checks available tools                                      │
│     → No GitHub tools found                                     │
│     → Calls mcp_discovery tool with query "github"              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ mcp_discovery: Searches MCP Shop API                            │
│     → Finds matching servers                                    │
│     → Filters out already-configured servers                    │
│     → Returns results with deep links                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ AI Response:                                                    │
│                                                                 │
│ "To access GitHub, I found this MCP server you can configure:  │
│                                                                 │
│ **GitHub** - Access repositories, issues, and pull requests    │
│                                                                 │
│ [Configure GitHub]  ← Rendered as a button                     │
│                                                                 │
│ *Requires: GitHub Personal Access Token*                       │
│                                                                 │
│ Click the button to add it."                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ User: Clicks configure button                                   │
│       → Modal opens over the chat                               │
│       → User enters API key                                     │
│       → Server connects                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ User: "Now list my repositories"                                │
│ AI: Uses the newly configured GitHub tools                      │
└─────────────────────────────────────────────────────────────────┘
```

## Tool Definition

### `mcp_discovery`

**Description:** Search for MCP servers in the Levante MCP Shop.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | - | Search query (e.g., "github", "database", "email") |
| `limit` | number | No | 5 | Maximum results to return (1-10) |

**Response:**

```typescript
interface MCPDiscoveryToolResponse {
  results: MCPDiscoveryResult[];
  totalMatches: number;
  message: string;
}

interface MCPDiscoveryResult {
  id: string;                    // Server identifier
  name: string;                  // Display name
  description: string;           // What the server does
  category: string;              // e.g., "development", "database"
  icon?: string;                 // Emoji or icon
  transport: string;             // "stdio" | "http" | "sse"
  configureUrl: string;          // Deep link URL
  hasApiKeyRequirement: boolean; // Requires credentials
}
```

**Example Response:**

```json
{
  "results": [
    {
      "id": "github",
      "name": "GitHub",
      "description": "Access GitHub repositories, issues, and pull requests",
      "category": "development",
      "icon": "🐙",
      "transport": "stdio",
      "configureUrl": "levante://mcp/configure/github",
      "hasApiKeyRequirement": true
    }
  ],
  "totalMatches": 1,
  "message": "Found 1 MCP server(s) matching \"github\"."
}
```

## Deep Link Format

The discovery tool generates deep links in the format:

```
levante://mcp/configure/{server-id}
```

When clicked:
1. The app fetches the server configuration from the MCP Shop registry
2. Opens the configuration modal with pre-filled settings
3. User provides any required credentials
4. Server is added and connected

## Button Rendering

Configure links in AI responses are automatically rendered as buttons:

**Markdown Input:**
```markdown
[Configure GitHub](levante://mcp/configure/github)
```

**Rendered Output:**
A styled button with:
- Primary theme colors
- Settings icon
- Hover and focus states
- Click triggers the configuration modal

## Search Algorithm

The discovery tool uses a scoring algorithm to rank results:

| Match Type | Score |
|------------|-------|
| Name contains query | +10 |
| ID contains query | +8 |
| Category matches query | +5 |
| Description contains term | +1 per term |

Results are:
1. Filtered to exclude already-configured servers
2. Sorted by score (highest first)
3. Limited to the requested count

## Configuration

The discovery tool is enabled by default. It can be disabled via preferences:

```typescript
// In ui-preferences.json
{
  "ai": {
    "mcpDiscovery": false  // Set to false to disable
  }
}
```

## System Prompt Integration

When enabled, the AI receives these instructions:

```
MCP DISCOVERY:
You have access to the `mcp_discovery` tool to search for MCP servers.

Use this tool when:
- Users ask about adding capabilities or tools you don't have
- Users want to connect to external services
- Users ask "Can you access X?" or "Is there a tool for Y?"
- You cannot fulfill a request with current tools

When presenting results:
1. Show each server with its name and description
2. Include the configure URL as a markdown link (renders as button)
3. Mention if API keys are required
4. Offer to help once configured
```

## Implementation Files

| File | Purpose |
|------|---------|
| `src/main/services/ai/builtInTools.ts` | Tool definition and search logic |
| `src/main/services/ai/systemPromptBuilder.ts` | AI instructions |
| `src/main/services/deepLinkService.ts` | Deep link parsing |
| `src/main/lifecycle/window.ts` | Handle clicks on levante:// links |
| `src/main/ipc/mcpHandlers/providers.ts` | Registry entry lookup |
| `src/renderer/App.tsx` | Modal opening logic |
| `src/renderer/components/ai-elements/response.tsx` | Button rendering |

## API Endpoints

The tool uses the MCP Shop API:

**Registry Fetch:**
```
GET https://services.levanteapp.com/api/mcps.json
```

**Entry Lookup (IPC):**
```typescript
window.levante.mcp.providers.getEntry(serverId)
```

## Security Considerations

1. **Server Validation**: All servers come from the curated MCP Shop registry
2. **User Confirmation**: Configuration requires explicit user action via modal
3. **Credential Protection**: API keys are stored encrypted via electron-store
4. **Protocol Isolation**: Only `levante://` links are handled internally; others open externally

## Examples

### Example 1: Database Access

**User:** "Can you query my PostgreSQL database?"

**AI Response:**
```
I don't have database access configured. I found this MCP server:

**PostgreSQL** - Query and manage PostgreSQL databases

[Configure PostgreSQL](levante://mcp/configure/postgresql)

*Requires: Database connection string*

Click to add it, then I can help with your queries.
```

### Example 2: File System

**User:** "Read the files in my project folder"

**AI Response:**
```
I found a file system server you can configure:

**Filesystem** - Read and write files on your computer

[Configure Filesystem](levante://mcp/configure/filesystem)

This server needs access to specific directories. Click to configure.
```

### Example 3: No Results

**User:** "Can you control my smart home?"

**AI Response:**
```
I searched for smart home MCP servers but didn't find any matches.
Try searching the MCP Shop manually, or check if there's a
community server available for your smart home platform.
```

## Troubleshooting

### Button not appearing

- Ensure the AI is using the correct markdown format: `[Label](levante://...)`
- Check that `mcpDiscovery` is not disabled in preferences

### Modal not opening

- Check the browser console for errors
- Verify the server ID exists in the registry
- Ensure the deep link service is properly initialized

### Server not found

- The server may have been removed from the registry
- Try searching with different terms
- Check if the server requires a different provider

## Related Documentation

- [Deep Linking](./DEEP_LINKING.md) - Full deep link protocol documentation
- [MCP Deep Link Security](./MCP_DEEP_LINK_SECURITY.md) - Security considerations
- [Architecture](./ARCHITECTURE.md) - System architecture overview
