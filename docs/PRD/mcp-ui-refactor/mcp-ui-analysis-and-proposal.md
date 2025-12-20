
# MCP-UI Integration Analysis and Refactor Proposal

**Date:** 2025-12-19
**Updated:** 2025-12-20
**Status:** ✅ Production Ready (Core complete, testing pending)
**Branch:** `feature/mcp-ui-refactor`
**Related Issue:** [#101 - MCP UI Widgets Phase 5 & 6](https://github.com/levante-hub/levante/issues/101)
**Research:** [raw-deep-research-mcp-ui.md](./raw-deep-research-mcp-ui.md)

---

## Implementation Progress Summary

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 0 | ✅ Complete | Dependency updates (`@modelcontextprotocol/sdk` → 1.25.1) |
| Phase 1 | ✅ Complete | Template removal (`widgets/templates/` deleted) |
| Phase 2 | ✅ Complete | Detection improvement (text/html, text/html+skybridge, text/html;profile=mcp-app) |
| Phase 3 | ✅ Complete | Testing with MCP-UI servers (standard widgets work) |
| Phase 4 | ✅ Complete | Documentation updates |
| Phase 5 | ✅ Complete | Apps SDK naming refactor (`skybridgeBridge` → `appsSdkBridge`) |
| Phase 6 | ✅ Complete | Apps SDK detection (openai/outputTemplate, skybridge mimeType, widgetCSP) |
| Phase 7 | ✅ Complete | Widget HTTP Proxy (CSP bypass, bridge injection, security) |
| Phase 8 | ✅ Complete | MCP Apps (SEP-1865) support with JSON-RPC 2.0 protocol |
| Phase 9 | ✅ Complete | Polish (theme sync, visual separation, dynamic baseUrl) |
| Phase 10 | ✅ Complete | Apps SDK testing (arcade, regex_playground widgets) |

**Key Changes Made:**
- Deleted `src/main/services/ai/widgets/templates/` folder (weatherCard.ts, calculator.ts, etc.)
- Renamed `skybridgeBridge.ts` → `appsSdkBridge.ts` with updated function/type names
- **NEW:** Created `src/main/services/ai/widgets/mcpAppsBridge.ts` for SEP-1865 support
- **NEW:** Created `src/main/services/ai/widgets/types.ts` for shared widget types
- **NEW:** Created `src/main/services/widgetProxy.ts` HTTP proxy server
- **NEW:** Created `src/main/ipc/widgetHandlers.ts` for IPC communication
- Updated `mcpToolsAdapter.ts` to handle MCP Apps and OpenAI SDK widgets
- Updated `UIResourceMessage.tsx` with MIME type detection for `text/html;profile=mcp-app`
- Added `ChatMessageItem.tsx` visual separation between ToolCall and widget
- Added theme synchronization from Levante settings (not OS directly)
- Added dynamic baseUrl resolution (removed hardcoded server references)
- TypeCheck passes ✅

**Testing Results:**
- ✅ Standard MCP-UI widgets work (piano with keyboard interaction)
- ✅ OpenAI Apps SDK widgets work (regex_playground with toolInput/toolOutput)
- ✅ MCP Apps (SEP-1865) widgets work (arcade FIFA World Cup)
- ✅ Theme synchronization verified
- ✅ Visual separation during streaming verified

---

## NEW: Widget HTTP Proxy Architecture

### Overview

All HTML widgets are served through a local HTTP proxy server to solve CSP issues and enable proper bridge injection:

```
Host (Levante React) → Proxy Page (iframe #1) → Widget Content (iframe #2)
```

### Why HTTP Proxy?

1. **Real origin**: Widgets get `http://127.0.0.1:{port}` instead of `null` from srcdoc
2. **Permissive CSP**: External scripts and resources can load properly
3. **Bridge injection**: Automatic injection of `window.mcpApp` or `window.openai` APIs
4. **Security isolation**: Double-iframe sandbox architecture

### Key Files

| File | Purpose |
|------|---------|
| `src/main/services/widgetProxy.ts` | HTTP server, bridge injection, proxy logic |
| `src/main/services/ai/widgets/mcpAppsBridge.ts` | MCP Apps (SEP-1865) bridge script |
| `src/main/services/ai/widgets/types.ts` | Shared widget type definitions |
| `src/main/ipc/widgetHandlers.ts` | IPC handlers for widget storage |

### Widget Store Entry

```typescript
interface WidgetStoreEntry {
  html: string;
  createdAt: number;
  protocol: 'openai-sdk' | 'mcp-apps' | 'mcp-ui';
  bridgeOptions?: WidgetBridgeOptions;
  baseUrl?: string;  // Dynamic, extracted from HTML content
}
```

### Request Flow

1. **Store widget**: Renderer calls IPC `levante/widget/store` with HTML and options
2. **Generate URL**: Proxy returns `http://127.0.0.1:{port}/proxy/{widgetId}?secret={token}`
3. **Load proxy page**: Creates outer iframe with message relay
4. **Load widget content**: Inner iframe loads from `/widget/{widgetId}` with injected bridge
5. **Message relay**: postMessage forwarded between host ↔ proxy ↔ widget

---

## NEW: MCP Apps (SEP-1865) Support

### Overview

MCP Apps is a protocol proposal (SEP-1865) that uses JSON-RPC 2.0 over postMessage for widget communication.

### Detection

MCP Apps widgets are detected by:
1. `ui/resourceUri` in tool metadata
2. `text/html;profile=mcp-app` MIME type

### window.mcpApp API

```javascript
window.mcpApp = {
  // Data properties (injected on load)
  toolInput: { ... },     // Tool input arguments
  toolResult: { ... },    // Tool execution result
  hostContext: { ... },   // Host context (theme, locale, displayMode, etc.)

  // Methods
  async callTool(name, args),      // Call another MCP tool
  async readResource(uri),         // Read an MCP resource
  async openLink(url),             // Open external link
  async sendMessage(text),         // Send message to chat
  resize(width, height),           // Notify host of size change
};
```

### Events

```javascript
window.addEventListener('mcp:tool-input', (e) => { ... });
window.addEventListener('mcp:tool-result', (e) => { ... });
window.addEventListener('mcp:tool-cancelled', (e) => { ... });
window.addEventListener('mcp:context-change', (e) => { ... });
window.addEventListener('mcp:teardown', (e) => { ... });
```

### JSON-RPC 2.0 Protocol

**Requests (with response):**
```javascript
{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "...", arguments: {} } }
```

**Notifications (no response):**
```javascript
{ jsonrpc: "2.0", method: "ui/notifications/initialized", params: { widgetId: "..." } }
```

### Supported Methods

| Method | Direction | Description |
|--------|-----------|-------------|
| `tools/call` | Widget → Host | Call an MCP tool |
| `resources/read` | Widget → Host | Read an MCP resource |
| `ui/open-link` | Widget → Host | Open external URL |
| `ui/message` | Widget → Host | Send message to chat |
| `ui/size-change` | Widget → Host | Notify of size change |
| `ui/notifications/initialized` | Widget → Host | Widget finished initializing |
| `ui/notifications/tool-input` | Host → Widget | Send tool input |
| `ui/notifications/tool-result` | Host → Widget | Send tool result |
| `ui/notifications/tool-cancelled` | Host → Widget | Tool was cancelled |
| `ui/host-context-change` | Host → Widget | Theme or context changed |
| `ui/notifications/teardown` | Host → Widget | Widget is about to be torn down |

---

## NEW: Theme Synchronization

### Problem
Widgets were using OS theme directly instead of Levante settings.

### Solution
Theme is now passed from Levante preferences through `bridgeOptions`:

```typescript
// In mcpToolsAdapter.ts
const bridgeOptions = {
  toolInput: args,
  toolOutput: result.structuredContent || {},
  theme: preferenceTheme,  // From Levante settings
  locale: preferenceLocale,
};
```

### How it works
1. `UIResourceMessage.tsx` uses `useThemeDetector()` hook to get effective theme
2. Theme is passed to `widgetProxy.ts` via IPC `levante/widget/store`
3. Bridge script injects theme into `hostContext.theme` or `window.openai.theme`
4. Theme changes propagate via `ui/host-context-change` or `openai:set_globals`

---

## NEW: Dynamic Base URL Resolution

### Problem
Hardcoded references to specific MCP servers (e.g., `arcade.xmcp.dev`) broke generic widget support.

### Solution
Base URL is now extracted dynamically:

1. **From HTML content**: Extract first `https://` URL from script/link tags
2. **From resource URI**: Use origin if available
3. **Store in widget entry**: `baseUrl` field in `WidgetStoreEntry`
4. **Use for proxying**: `handleNextImageProxy()` uses stored baseUrl

```typescript
function extractBaseUrlFromHtml(html: string): string | undefined {
  const patterns = [
    { pattern: /<script[^>]+src=["'](https?:\/\/[^/"']+)/i, name: 'script-src' },
    { pattern: /<link[^>]+href=["'](https?:\/\/[^/"']+)/i, name: 'link-href' },
    // ...
  ];
  // Returns first match
}
```

---

## NEW: Visual Separation During Streaming

### Problem
During streaming, ToolCall and widget were visually merged without separation.

### Solution
Added margin between components in `ChatMessageItem.tsx`:

```tsx
{uiResources.length > 0 && (
  <div className="my-4">
    {uiResources.map((resource, resourceIdx) => (
      <UIResourceMessage ... />
    ))}
  </div>
)}
```

---

## Updated File Structure (Post-Refactor)

```
src/main/services/ai/
├── mcpToolsAdapter.ts              # Tool execution, widget detection
├── schemaSanitizer/                # Provider-specific schema sanitization
└── widgets/
    ├── index.ts                    # Exports utilities (no generateWidgetHtml)
    ├── htmlUtils.ts                # Data injection utilities
    ├── appsSdkBridge.ts            # OpenAI Apps SDK bridge
    ├── mcpAppsBridge.ts            # MCP Apps (SEP-1865) bridge  ← NEW
    └── types.ts                    # Shared widget types         ← NEW

src/main/services/
└── widgetProxy.ts                  # HTTP proxy server            ← NEW

src/main/ipc/
└── widgetHandlers.ts               # Widget IPC handlers          ← NEW

src/renderer/components/chat/
├── UIResourceMessage.tsx           # Widget rendering with MIME detection
└── ChatMessageItem.tsx             # Visual separation for streaming
```

---

## Implementation Checklist

### Phase 1-4: Template Removal & Detection ✅ COMPLETE
- [x] Delete `src/main/services/ai/widgets/templates/` folder
- [x] Remove template imports from `widgets/index.ts`
- [x] Remove `generateWidgetHtml()` function
- [x] Detect `text/html`, `text/html+skybridge`, `text/html;profile=mcp-app`

### Phase 5-6: Apps SDK Compatibility ✅ COMPLETE
- [x] Rename `skybridgeBridge.ts` → `appsSdkBridge.ts`
- [x] Update function/type names
- [x] Detect `openai/outputTemplate` metadata
- [x] Handle `openai/widgetCSP` for CSP extraction

### Phase 7: Widget HTTP Proxy ✅ COMPLETE
- [x] Create HTTP server for widgets (`widgetProxy.ts`)
- [x] Secret token authentication
- [x] Double-iframe sandbox architecture
- [x] Base URL injection for relative paths
- [x] Next.js image proxy support
- [x] Dynamic baseUrl resolution (no hardcoded servers)

### Phase 8: MCP Apps (SEP-1865) ✅ COMPLETE
- [x] Create `mcpAppsBridge.ts` with JSON-RPC 2.0 protocol
- [x] Implement `window.mcpApp` API
- [x] All events: tool-input, tool-result, tool-cancelled, context-change, teardown
- [x] All methods: tools/call, resources/read, ui/open-link, ui/message, ui/size-change
- [x] Compatibility layer with `window.openai`

### Phase 9: Polish ✅ COMPLETE
- [x] Theme from Levante settings (not OS)
- [x] Visual separation between ToolCall and widget
- [x] toolInput/toolOutput injection fixed
- [x] API shimming (Keyboard.lock, requestFullscreen)
- [x] Dynamic baseUrl resolution

### Phase 10: Testing ✅ COMPLETE
- [x] Standard MCP-UI widgets (piano)
- [x] OpenAI Apps SDK widgets (regex_playground)
- [x] MCP Apps (SEP-1865) widgets (arcade FIFA World Cup)
- [x] Theme synchronization
- [x] Streaming visual separation

---

## Security Model

### Content Security Policy

The widget proxy uses a permissive CSP:

```
default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;
script-src * 'unsafe-inline' 'unsafe-eval' data: blob:;
style-src * 'unsafe-inline' data: blob:;
connect-src *;
```

### Iframe Sandbox Attributes

```html
<iframe sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-top-navigation-by-user-activation" />
```

### Security Features

- **Double-iframe architecture**: Origin isolation between host and widget
- **Secret token authentication**: `?secret={token}` prevents unauthorized access
- **API shimming**: Graceful handling of `Keyboard.lock()`, `requestFullscreen()`
- **No hardcoded servers**: Dynamic baseUrl extraction

---

## Protocol Comparison

| Feature | MCP Apps (SEP-1865) | OpenAI Apps SDK | MCP-UI |
|---------|---------------------|-----------------|--------|
| Protocol | JSON-RPC 2.0 | Custom postMessage | UIActionResult |
| API | `window.mcpApp` | `window.openai` | `onUIAction` callback |
| Detection | `ui/resourceUri` | `openai/outputTemplate` | `ui://` URI |
| MIME Type | `text/html;profile=mcp-app` | `text/html+skybridge` | `text/html` |
| State | Not supported | localStorage | Via callback |
| Modal | Not supported | Supported | Not supported |

---

## Executive Summary

The current MCP-UI implementation in Levante has a fundamental architectural flaw: **hardcoded widget templates** that attempt to generate HTML on the client side. According to the MCP-UI specification and `@mcp-ui/client` library, the server should provide the UI content, not the client.

This document analyzes the current implementation, identifies issues, and proposes a refactoring plan to align with the proper MCP-UI protocol.

---

## 1. Current Implementation Analysis

### 1.1 File Structure

> **Note:** This section shows the BEFORE state. See Section 5 for the current post-refactor structure.

```
src/main/services/ai/
├── mcpToolsAdapter.ts          # Main adapter (500 lines)
├── schemaSanitizer/            # Provider-specific schema sanitization (OK)
└── widgets/
    ├── index.ts                # generateWidgetHtml() - PROBLEM ✅ REMOVED
    ├── htmlUtils.ts            # injectDataIntoHtml() - OK
    ├── skybridgeBridge.ts      # injectSkybridgeBridge() - OK ✅ RENAMED to appsSdkBridge.ts
    └── templates/              # SHOULD NOT EXIST ✅ DELETED
        ├── weatherCard.ts      # Hardcoded template
        ├── calculator.ts       # Hardcoded template
        ├── textAnalysis.ts     # Hardcoded template
        └── generic.ts          # Generic fallback

src/renderer/
├── components/chat/
│   └── UIResourceMessage.tsx   # Uses @mcp-ui/client UIResourceRenderer (OK) ✅ UPDATED
├── hooks/
│   └── useUIResourceActions.ts # Handles UI actions (OK)
└── types/
    └── ui-resource.ts          # Type definitions (OK)
```

### 1.2 Current Flow

```
MCP Server returns tool result
        ↓
mcpToolsAdapter.ts processes result
        ↓
Checks for widgetMeta in _meta['mcp-use/widget']
        ↓
handleMcpUseWidget():
  - If widgetMeta.html exists → injectDataIntoHtml() ✓ CORRECT
  - If widgetMeta.html is missing → generateWidgetHtml() ✗ WRONG
        ↓
Creates synthetic UIResource with generated HTML
        ↓
Renderer: UIResourceMessage → UIResourceRenderer
```

### 1.3 The Core Problem

The `generateWidgetHtml()` function in [widgets/index.ts](../../../src/main/services/ai/widgets/index.ts) uses a switch statement to pick hardcoded templates:

```typescript
// src/main/services/ai/widgets/index.ts (PROBLEMATIC CODE)
export function generateWidgetHtml(widgetMeta: WidgetMeta, data: Record<string, any>): string {
  const { name } = widgetMeta;

  switch (name) {
    case 'weather-card':
      return generateWeatherCardHtml(data);  // Hardcoded template
    case 'calculator-result':
      return generateCalculatorResultHtml(data);
    case 'text-analysis-chart':
      return generateTextAnalysisChartHtml(data);
    default:
      return generateGenericWidgetHtml(name, data);  // Another hardcoded template
  }
}
```

**Why this is wrong:**

1. **Violates MCP-UI Protocol**: The server should provide UI content; the client should only render it
2. **Doesn't Scale**: There are potentially thousands of MCP servers with different UI needs
3. **Maintenance Burden**: Every new widget type requires client-side code changes
4. **Couples Client to Server**: The client has specific knowledge of server widget types
5. **Examples Don't Work**: MCP servers that follow the spec (providing their own HTML) may not work correctly

---

## 2. MCP-UI Protocol Specification

### 2.1 The UIResource Contract

According to the [MCP-UI specification](https://mcpui.dev), a UIResource should look like:

```typescript
interface UIResource {
  type: 'resource';
  resource: {
    uri: string;       // Schema: ui://component-name/instance-id
    mimeType: 'text/html' | 'text/uri-list' | 'application/vnd.mcp-ui.remote-dom+javascript';
    text?: string;     // The actual HTML content
    blob?: string;     // Base64 encoded content
    _meta?: {
      title?: string;
      description?: string;
      'mcpui.dev/ui-preferred-frame-size'?: { width: number; height: number };
      'mcpui.dev/ui-initial-render-data'?: Record<string, unknown>;
    };
  };
}
```

### 2.2 Content Delivery Methods

| Type | mimeType | How Content is Delivered |
|------|----------|--------------------------|
| Raw HTML | `text/html` | Server provides HTML in `text` field |
| External URL | `text/uri-list` | Server provides URL in `text` field |
| Remote DOM | `application/vnd.mcp-ui.remote-dom+javascript` | Server provides script |

### 2.3 The Correct Flow

```
MCP Server returns tool result with UIResource
        ↓
UIResource contains:
  - uri: "ui://weather-widget/12345"
  - mimeType: "text/html"
  - text: "<html>...server-provided HTML...</html>"
        ↓
Client passes UIResource to UIResourceRenderer
        ↓
UIResourceRenderer:
  - Creates sandboxed iframe
  - Sets srcDoc to the HTML
  - Sets up postMessage bridge
  - Passes iframeRenderData (theme, locale, data)
```

---

## 3. Why Examples Don't Work

When testing MCP-UI examples from other projects, they likely fail because:

1. **Servers return UIResources directly**: They don't use `_meta['mcp-use/widget']`
2. **Current detection logic**: Only checks for `mcp-use/widget` or `openai/outputTemplate`
3. **Missing direct UIResource detection**: The code doesn't properly detect when a tool returns a UIResource in the content array

### Current Detection Flow (Incomplete)

```typescript
// mcpToolsAdapter.ts - handleMcpUseWidget is only called when:
const widgetMeta = result._meta?.['mcp-use/widget'];
const openaiOutputTemplate = result._meta?.['openai/outputTemplate'];

if (widgetMeta) {
  return handleMcpUseWidget(...);  // Only mcp-use format
} else if (openaiOutputTemplate) {
  return handleSkybridgeWidget(...);  // Only OpenAI format
}
```

### What's Missing

Standard MCP-UI servers return UIResources like this:

```typescript
// Server response
{
  content: [
    { type: 'text', text: 'Here is the weather data' },
    {
      type: 'resource',
      resource: {
        uri: 'ui://weather/12345',
        mimeType: 'text/html',
        text: '<html>...complete HTML...</html>'
      }
    }
  ]
}
```

This format should be detected by checking the `content` array for resources with `ui://` URIs, which the code does in `processToolResult()` but doesn't fully preserve the structure for rendering.

---

## 4. Proposed Refactoring Plan

### 4.1 Phase 1: Remove Hardcoded Templates

**Files to Delete:**
- `src/main/services/ai/widgets/templates/weatherCard.ts`
- `src/main/services/ai/widgets/templates/calculator.ts`
- `src/main/services/ai/widgets/templates/textAnalysis.ts`
- `src/main/services/ai/widgets/templates/generic.ts`
- `src/main/services/ai/widgets/templates/index.ts`

**Files to Modify:**
- `src/main/services/ai/widgets/index.ts` - Remove `generateWidgetHtml()`

### 4.2 Phase 2: Simplify Widget Handling

Refactor `handleMcpUseWidget()` to require server-provided HTML:

```typescript
// PROPOSED: handleMcpUseWidget() in mcpToolsAdapter.ts
function handleMcpUseWidget(
  serverId: string,
  mcpTool: Tool,
  args: any,
  result: any,
  widgetMeta: any
) {
  // Server MUST provide HTML
  if (!widgetMeta.html || typeof widgetMeta.html !== 'string') {
    logger.aiSdk.warn("Widget missing HTML content - server should provide it", {
      toolName: mcpTool.name,
      widgetName: widgetMeta.name,
    });

    // Fall back to text representation of the data
    return {
      text: `[Widget: ${widgetMeta.name}] ${JSON.stringify(result.structuredContent || args)}`,
      content: result.content,
      _meta: result._meta,
    };
  }

  const widgetData = result.structuredContent || args;
  const widgetHtml = injectDataIntoHtml(widgetMeta.html, widgetData);

  // Create UIResource
  const uiResource = {
    type: "resource",
    resource: {
      uri: `ui://widget/${widgetMeta.name}.html`,
      mimeType: "text/html",
      text: widgetHtml,
      _meta: {
        widgetName: widgetMeta.name,
        widgetType: widgetMeta.type,
        widgetData: widgetData,
      }
    }
  };

  return {
    text: `[UI Widget: ${widgetMeta.name}]`,
    content: result.content,
    uiResources: [uiResource],
    _meta: result._meta,
  };
}
```

### 4.3 Phase 3: Improve UIResource Detection

Enhance `processToolResult()` to better detect and preserve UIResources:

```typescript
// PROPOSED: Enhanced processToolResult()
async function processToolResult(serverId: string, mcpTool: Tool, result: any) {
  if (!result.content || !Array.isArray(result.content)) {
    return result;
  }

  const textParts: string[] = [];
  const uiResources: any[] = [];

  for (const item of result.content) {
    if (item.type === "text") {
      textParts.push(item.text || "");
      continue;
    }

    if (item.type === "resource") {
      const resourceData = item.resource || item;
      const uri = resourceData?.uri || "";
      const mimeType = resourceData?.mimeType || "";

      // Check if this is a UI resource
      if (uri.startsWith("ui://") || mimeType.startsWith("text/html")) {
        // Fetch content if not inline
        if (!resourceData.text && !resourceData.blob && uri) {
          try {
            const fetched = await mcpService.readResource(serverId, uri);
            if (fetched?.contents?.[0]) {
              Object.assign(resourceData, {
                text: fetched.contents[0].text,
                blob: fetched.contents[0].blob,
                mimeType: fetched.contents[0].mimeType || mimeType,
              });
            }
          } catch (error) {
            logger.aiSdk.error("Failed to fetch UI resource", { uri, error });
          }
        }

        // Preserve as UIResource for rendering
        uiResources.push({
          type: "resource",
          resource: resourceData
        });
        textParts.push(`[UI Widget: ${uri}]`);
        continue;
      }

      // Non-UI resource
      textParts.push(`[Resource: ${JSON.stringify(resourceData)}]`);
    }
  }

  if (uiResources.length > 0) {
    return {
      text: textParts.join("\n"),
      content: result.content,
      uiResources: uiResources,
      _meta: result._meta,
    };
  }

  return textParts.join("\n");
}
```

### 4.4 Phase 4: Keep Essential Utilities

**Keep these files (they're useful):**

1. **`htmlUtils.ts`** - `injectDataIntoHtml()` is needed for servers that provide HTML templates without embedded data scripts

2. **`appsSdkBridge.ts`** (rename from `skybridgeBridge.ts`) - `injectAppsSdkBridge()` is essential for ChatGPT Apps SDK compatibility

**Simplified `widgets/index.ts`:**

```typescript
// PROPOSED: Simplified widgets/index.ts
export { escapeHtml, injectDataIntoHtml } from './htmlUtils';
export { injectAppsSdkBridge } from './appsSdkBridge';
export type { AppsSdkBridgeOptions } from './appsSdkBridge';

// No more generateWidgetHtml - servers must provide their HTML
```

---

## 5. Updated File Structure (Post-Refactor) ✅ IMPLEMENTED

```
src/main/services/ai/
├── mcpToolsAdapter.ts          # Simplified adapter (no template generation)
├── schemaSanitizer/            # Unchanged
└── widgets/
    ├── index.ts                # Only exports utilities (no generateWidgetHtml)
    ├── htmlUtils.ts            # Data injection utilities
    ├── appsSdkBridge.ts        # OpenAI Apps SDK bridge (renamed from skybridgeBridge.ts)
    ├── mcpAppsBridge.ts        # MCP Apps (SEP-1865) bridge ← NEW
    └── types.ts                # Shared widget types ← NEW
    # templates/ folder DELETED ✅

src/main/services/
└── widgetProxy.ts              # HTTP proxy server for widgets ← NEW

src/main/ipc/
└── widgetHandlers.ts           # Widget IPC handlers ← NEW

src/renderer/components/chat/
├── UIResourceMessage.tsx       # Updated with MIME type detection
└── ChatMessageItem.tsx         # Visual separation for streaming
```

---

## 6. Testing Plan

### 6.1 Test Cases

1. **MCP-UI Standard Server**: Server returns UIResource in content array
   - Expected: HTML renders in iframe ✅

2. **mcp-use Format**: Server returns `_meta['mcp-use/widget'].html`
   - Expected: HTML renders with data injection ✅

3. **mcp-use Without HTML**: Server returns `_meta['mcp-use/widget']` but no `.html`
   - Expected: Falls back to text representation ✅

4. **OpenAI Apps SDK Format**: Server returns `_meta['openai/outputTemplate']`
   - Expected: Fetches template, injects Apps SDK bridge, renders ✅

5. **MCP Apps (SEP-1865)**: Server returns `ui/resourceUri` with `text/html;profile=mcp-app`
   - Expected: Fetches HTML, injects MCP Apps bridge, renders ✅

6. **External URL**: Server returns `text/uri-list` mimeType
   - Expected: iframe loads external URL

### 6.2 MCP-UI Test Servers

Use these for validation:
- [MCP-UI Examples](https://github.com/nicholasgriffintn/mcp-ui/tree/main/examples)
- mcp-use widget examples
- ChatGPT Apps that use the Apps SDK
- Arcade (arcade.xmcp.dev) - MCP Apps (SEP-1865)
- Regex Playground - OpenAI Apps SDK

---

## 7. Migration Guide for Existing Code

### For Developers Using Custom Widgets

If you have MCP servers that relied on Levante's hardcoded templates (weather-card, calculator-result, etc.), you need to:

1. **Update your server** to return complete HTML in `_meta['mcp-use/widget'].html`
2. **Or** return standard UIResources in the content array

### Example Migration

**Before (relied on client templates):**
```typescript
// Server returned this
return {
  content: [{ type: 'text', text: 'Temperature: 25°C' }],
  _meta: { 'mcp-use/widget': { name: 'weather-card', type: 'html' } },
  structuredContent: { city: 'Madrid', temperature: 25 }
};
```

**After (server provides HTML):**
```typescript
// Server must return this
return {
  content: [{ type: 'text', text: 'Temperature: 25°C' }],
  _meta: {
    'mcp-use/widget': {
      name: 'weather-card',
      type: 'html',
      html: `<!DOCTYPE html>
<html>
<head><style>/* your styles */</style></head>
<body>
  <div id="app"></div>
  <script>
    // Access data via window.__data or window.openai.toolOutput
    const data = window.__data || {};
    document.getElementById('app').innerHTML = \`
      <h1>\${data.city}</h1>
      <p>\${data.temperature}°C</p>
    \`;
  </script>
</body>
</html>`
    }
  },
  structuredContent: { city: 'Madrid', temperature: 25 }
};
```

---

## 8. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing MCP servers that relied on templates | High | Provide migration guide; consider deprecation period |
| Some servers don't provide HTML | Medium | Fall back to text representation with clear logging |
| Performance of HTML injection | Low | Current `injectDataIntoHtml()` is efficient |

---

## 9. Conclusion

The current implementation's hardcoded templates are fundamentally misaligned with the MCP-UI specification. By removing these templates and trusting servers to provide their UI content, Levante will:

1. **Work with any MCP-UI compliant server** out of the box
2. **Reduce maintenance burden** - no client-side changes for new widget types
3. **Follow the specification** - proper separation of concerns
4. **Enable future extensibility** - Remote DOM, external URLs, etc.

The refactor is relatively straightforward since the renderer (`UIResourceMessage.tsx`) already correctly uses `UIResourceRenderer` from `@mcp-ui/client`. The main changes are in the backend adapter logic.

---

## 10. ChatGPT Apps SDK Compatibility (Extended)

Based on official documentation from [mcpui.dev/guide/apps-sdk](https://mcpui.dev/guide/apps-sdk) and [developers.openai.com/apps-sdk/reference](https://developers.openai.com/apps-sdk/reference).

### 10.1 Overview

MCP-UI provides **dual compatibility** with both native MCP hosts and ChatGPT through the OpenAI Apps SDK. The key mechanism is:

1. **MimeType switching**: `text/html` → `text/html+skybridge` (MCP-UI adapter convention)
2. **Bridge injection**: Automatic injection of the Apps SDK bridge script that provides `window.openai`
3. **API translation**: MCP-UI primitives translated to `window.openai` calls

> **Note**: The `text/html+skybridge` mimeType is a convention used by MCP-UI's Apps SDK adapter, not an official OpenAI standard. It signals that the HTML content is designed to work with the `window.openai` bridge API.

### 10.2 The `window.openai` API (Complete Reference)

The host injects `window.openai` with these capabilities:

#### State & Data Properties (Read-Only)

| Property | Type | Description |
|----------|------|-------------|
| `toolInput` | `object` | Arguments passed when the tool was invoked |
| `toolOutput` | `object` | Structured content returned to the model |
| `toolResponseMetadata` | `object` | The `_meta` payload visible only to widgets |
| `widgetState` | `object` | Snapshot of UI state persisted between renders |
| `theme` | `'light' \| 'dark'` | Current color scheme |
| `displayMode` | `'inline' \| 'pip' \| 'fullscreen'` | Current layout presentation |
| `maxHeight` | `number` | Available vertical space |
| `safeArea` | `object` | Safe rendering boundaries |
| `locale` | `string` | BCP 47 locale (e.g., "en-US") |
| `userAgent` | `string` | Browser identification |

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `callTool` | `(name: string, args: object) => Promise<any>` | Invoke MCP tools from the widget |
| `sendFollowUpMessage` | `({ prompt: string }) => void` | Ask ChatGPT to post a follow-up message |
| `setWidgetState` | `(state: object) => void` | Store UI state snapshot synchronously |
| `requestDisplayMode` | `(mode: string) => void` | Switch between inline/pip/fullscreen |
| `requestClose` | `() => void` | Programmatically close the widget |
| `notifyIntrinsicHeight` | `(height: number) => void` | Report dynamic height to avoid clipping |
| `openExternal` | `({ href: string }) => void` | Open vetted external link in browser |
| `uploadFile` | `(file: File) => Promise<{ fileId: string }>` | Upload user-selected file |
| `getFileDownloadUrl` | `({ fileId: string }) => Promise<{ url: string }>` | Get temporary download URL |

### 10.3 Server-Side Metadata Keys

Servers must include specific `_meta` fields for ChatGPT compatibility:

#### Tool Descriptor `_meta`

```typescript
{
  // Template reference (required for UI widgets)
  'openai/outputTemplate': 'ui://widget-name/template.html',

  // Enable component-initiated tool calls
  'openai/widgetAccessible': true,

  // Model visibility control
  'openai/visibility': 'public' | 'private',

  // Status text during execution (max 64 chars)
  'openai/toolInvocation': {
    'invoking': 'Calculating...',
    'invoked': 'Calculation complete'
  },

  // File input field names
  'openai/fileParams': ['imageFile', 'documentFile']
}
```

#### Component Resource `_meta`

```typescript
{
  // Human-readable summary for the model
  'openai/widgetDescription': 'Interactive weather forecast display',

  // Request bordered card presentation
  'openai/widgetPrefersBorder': true,

  // Content Security Policy
  'openai/widgetCSP': {
    'connect_domains': ['api.weather.com'],
    'resource_domains': ['cdn.example.com'],
    'frame_domains': [],
    'redirect_domains': []
  },

  // Optional subdomain override
  'openai/widgetDomain': 'weather-app'
}
```

### 10.4 Current Implementation Status

Analyzing [appsSdkBridge.ts](../../../src/main/services/ai/widgets/appsSdkBridge.ts) and [widgetProxy.ts](../../../src/main/services/widgetProxy.ts):

| Feature | Current Status | Required |
|---------|----------------|----------|
| `toolInput` / `toolOutput` | ✅ Implemented | Yes |
| `callTool()` | ✅ Implemented | Yes |
| `sendFollowUpMessage()` | ✅ Implemented | Yes |
| `locale` / `theme` | ✅ Implemented (from Levante settings) | Yes |
| `setWidgetState()` | ✅ Implemented (via postMessage) | Optional |
| `requestDisplayMode()` | ✅ Implemented (via postMessage) | Optional |
| `requestClose()` | ✅ Implemented (via postMessage) | Optional |
| `openExternal()` | ✅ Implemented (via postMessage) | Optional |
| `notifyIntrinsicHeight()` | ✅ Via resize() | Recommended |
| `uploadFile()` / `getFileDownloadUrl()` | ❌ Not supported | Optional |
| `widgetState` persistence | ✅ Via postMessage (host handles storage) | Optional |
| `openai:set_globals` event | ✅ Implemented | Recommended |

---

## 11. References

- [SEP-1865: MCP Apps Proposal](https://github.com/anthropics/mcp/blob/main/proposals/sep-1865.md)
- [MCP-UI Documentation](https://mcpui.dev)
- [MCP-UI Apps SDK Guide](https://mcpui.dev/guide/apps-sdk)
- [OpenAI Apps SDK Reference](https://developers.openai.com/apps-sdk/reference)
- [OpenAI Build ChatGPT UI](https://developers.openai.com/apps-sdk/build/chatgpt-ui)
- [@mcp-ui/client npm](https://www.npmjs.com/package/@mcp-ui/client)
- [@mcp-ui/server npm](https://www.npmjs.com/package/@mcp-ui/server)
