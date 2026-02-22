# MCP Tool Selection - Progress Report

## Status: COMPLETE

All phases have been implemented successfully.

---

## Completed (All Phases)

### Phase 1-4: Types, Preferences, IPC Handlers, Store (Previously completed)

- **Types** (`src/main/types/mcp.ts`): `ServerTool`, `ToolsCache`, `DisabledTools`
- **Preferences Schema**: Added `toolsCache` and `disabledTools` to mcp object
- **IPC Handlers** (`src/main/ipc/mcpHandlers/tools.ts`): All CRUD handlers for tools
- **Preload API** (`src/preload/api/mcp.ts`): Exposed methods to renderer
- **Store** (`src/renderer/stores/mcpStore.ts`): State and actions for tools management

### Phase 5.2: aiService Update

**File:** `src/main/services/aiService.ts`

Updated both `getMCPTools()` calls to pass `disabledTools`:
- Line ~944: In `streamChat()` method
- Line ~1770: In `generateText()` method

Both locations now:
1. Import preferencesService dynamically
2. Get `disabledTools` from preferences
3. Pass to `getMCPTools(disabledTools)`

### Phase 6.1: ToolSelector Component

**File:** `src/renderer/components/settings/ToolSelector.tsx`

A collapsible component that:
- Shows tools per server with enable/disable checkboxes
- Has "Select all" toggle
- Shows enabled count badge
- Has refresh button to reload tools
- Supports search filtering

### Phase 6.2: ToolsWarning Component

**File:** `src/renderer/components/settings/ToolsWarning.tsx`

Warning alert that shows when:
- 40+ tools enabled: Yellow warning
- 80+ tools enabled: Red destructive warning

### Phase 6.3: ToolsMenu Integration

**File:** `src/renderer/components/chat/ToolsMenu.tsx`

Completely rewritten to include:
- MCP master toggle
- Total active tools badge
- ToolsWarning component
- Expandable server sections with tool lists
- Search filtering across all servers
- Per-server enable/disable all toggle
- Per-tool enable/disable checkboxes

### Phase 7: Initialization

Handled in ToolsMenu component's `useEffect`:
- Calls `loadToolsCache()` on mount
- Calls `loadDisabledTools()` on mount

### Phase 8.1: tools/list_changed Handler

**File:** `src/main/services/mcp/mcpUseService.ts`

Added `setupToolsListChangedHandler()` method:
- Listens for `notifications/tools/list_changed` on connector
- Updates tools cache in preferences
- Sends `levante/mcp/tools-updated` IPC event to renderer

### Phase 8.2: useMCPEvents Hook

**Files:**
- `src/renderer/hooks/useMCPEvents.ts` - New hook
- `src/preload/api/mcp.ts` - Added `onToolsUpdated` listener
- `src/renderer/App.tsx` - Integrated hook

The hook:
- Listens for `levante/mcp/tools-updated` events
- Reloads tools cache when notified

---

## Files Created

| File | Description |
|------|-------------|
| `src/renderer/components/settings/ToolSelector.tsx` | Tool selection UI component |
| `src/renderer/components/settings/ToolsWarning.tsx` | Warning for too many tools |
| `src/renderer/hooks/useMCPEvents.ts` | MCP event listener hook |

## Files Modified

| File | Changes |
|------|---------|
| `src/main/services/aiService.ts` | Pass disabledTools to getMCPTools |
| `src/main/services/mcp/mcpUseService.ts` | Add tools/list_changed handler |
| `src/preload/api/mcp.ts` | Add onToolsUpdated event listener |
| `src/renderer/components/chat/ToolsMenu.tsx` | Complete rewrite with tool selection |
| `src/renderer/App.tsx` | Add useMCPEvents hook |

---

## How It Works

1. **Connection**: When MCP server connects, tools are fetched and cached
2. **UI**: ToolsMenu shows all servers with their tools
3. **Selection**: User can enable/disable individual tools or all tools for a server
4. **Persistence**: Disabled tools stored in `ui-preferences.json` under `mcp.disabledTools`
5. **Filtering**: When AI requests tools, `getMCPTools()` filters out disabled ones
6. **Updates**: If server sends `tools/list_changed`, cache updates automatically

## Testing Checklist

- [ ] Connect MCP server - all tools enabled by default
- [ ] Disable a tool - verify it doesn't appear in AI responses
- [ ] Enable tool again - verify it works
- [ ] Disable all tools for server
- [ ] Enable all tools for server
- [ ] Restart app - verify selections persist
- [ ] Add 40+ tools - verify warning appears
- [ ] Add 80+ tools - verify critical warning appears
- [ ] Remove server - verify tools data cleaned up
