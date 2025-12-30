/**
 * MCP Apps Bridge (SEP-1865) with OpenAI Apps SDK Compatibility
 *
 * Injects the window.mcpApp API for MCP Apps widgets.
 * Also provides window.openai compatibility layer for OpenAI Apps SDK widgets.
 * Uses JSON-RPC 2.0 protocol over postMessage.
 *
 * MCP Apps API (window.mcpApp):
 * - toolInput: Tool input arguments
 * - toolResult: Tool execution result
 * - hostContext: Host context (theme, locale, etc.)
 * - callTool(name, args): Call another MCP tool
 * - readResource(uri): Read an MCP resource
 * - openLink(url): Open external link
 * - sendMessage(text): Send message to chat
 * - resize(width, height): Notify host of size change
 *
 * OpenAI Apps SDK API (window.openai):
 * - toolInput, toolOutput: Tool I/O
 * - widgetSessionId: Unique session ID per widget instance
 * - widgetPrefersBorder: Visual hint for border styling
 * - invocationStatusText: Status text (invoking/invoked)
 * - theme, locale, displayMode, maxHeight, safeArea, userAgent
 * - callTool, sendFollowUpMessage, requestDisplayMode, openExternal
 * - requestClose, setWidgetState, resize
 *
 * Events:
 * - mcp:tool-input: Tool input received
 * - mcp:tool-result: Tool result received
 * - mcp:tool-cancelled: Tool execution was cancelled
 * - mcp:context-change: Host context changed
 * - mcp:teardown: Widget is about to be torn down
 *
 * @see https://github.com/anthropics/mcp/blob/main/proposals/sep-1865.md
 * @see https://platform.openai.com/docs/apps-sdk
 */

import type { WidgetBridgeOptions, WidgetHostContext } from './types';

/**
 * Generate the MCP Apps bridge script to inject into widget HTML
 * This provides the window.mcpApp API following SEP-1865
 */
export function generateMcpAppsBridgeScript(options: WidgetBridgeOptions): string {
  const {
    widgetId,
    widgetSessionId = widgetId, // Fallback to widgetId if not provided
    toolInput,
    toolOutput,
    responseMetadata = {},
    locale = 'en-US',
    theme = 'light',
    widgetPrefersBorder = false,
    invocationStatusText,
    annotations = {},
    userLocation,
  } = options;

  const hostContext: WidgetHostContext = {
    theme: theme === 'system' ? 'light' : theme,
    locale,
    displayMode: 'inline',
    maxHeight: 600,
    safeArea: { insets: { top: 0, bottom: 0, left: 0, right: 0 } },
    userAgent: {
      device: { type: 'desktop' },
      capabilities: { hover: true, touch: false },
    },
  };

  return `
<script>
(function() {
  // MCP Apps Bridge (SEP-1865) for Levante
  // Provides window.mcpApp API with JSON-RPC 2.0 protocol

  // Shim for APIs that don't work in iframes
  if (navigator.keyboard && navigator.keyboard.lock) {
    const originalLock = navigator.keyboard.lock.bind(navigator.keyboard);
    navigator.keyboard.lock = function(keyCodes) {
      return originalLock(keyCodes).catch(() => {});
    };
  }
  const originalRequestFullscreen = Element.prototype.requestFullscreen;
  if (originalRequestFullscreen) {
    Element.prototype.requestFullscreen = function(options) {
      return originalRequestFullscreen.call(this, options).catch(() => {});
    };
  }

  let _rpcId = 0;
  const _pendingRequests = new Map();
  const _widgetId = '${widgetId}';

  // Helper to create JSON-RPC 2.0 request
  function createRequest(method, params) {
    return {
      jsonrpc: '2.0',
      id: ++_rpcId,
      method: method,
      params: params || {}
    };
  }

  // Helper to create JSON-RPC 2.0 notification (no response expected)
  function createNotification(method, params) {
    return {
      jsonrpc: '2.0',
      method: method,
      params: params || {}
    };
  }

  // Send JSON-RPC request and wait for response
  function sendRequest(method, params) {
    return new Promise(function(resolve, reject) {
      var request = createRequest(method, params);
      _pendingRequests.set(request.id, { resolve: resolve, reject: reject });

      window.parent.postMessage(request, '*');

      // Timeout after 30 seconds
      setTimeout(function() {
        if (_pendingRequests.has(request.id)) {
          _pendingRequests.delete(request.id);
          reject(new Error('Request timeout: ' + method));
        }
      }, 30000);
    });
  }

  // Send JSON-RPC notification (no response expected)
  function sendNotification(method, params) {
    window.parent.postMessage(createNotification(method, params), '*');
  }

  // Initialize window.mcpApp API
  window.mcpApp = {
    // Data properties
    toolInput: ${JSON.stringify(toolInput)},
    toolResult: ${JSON.stringify(toolOutput)},
    hostContext: ${JSON.stringify(hostContext)},

    // Call another MCP tool
    async callTool(name, args) {
      console.log('[MCP Apps] Calling tool:', name, args);
      return sendRequest('tools/call', { name: name, arguments: args || {} });
    },

    // Read an MCP resource
    async readResource(uri) {
      console.log('[MCP Apps] Reading resource:', uri);
      return sendRequest('resources/read', { uri: uri });
    },

    // Open external link
    async openLink(url) {
      console.log('[MCP Apps] Opening link:', url);
      sendNotification('ui/open-link', { url: url });
      // Also try to open via window.open
      window.open(url, '_blank', 'noopener,noreferrer');
    },

    // Send message to chat
    async sendMessage(text) {
      console.log('[MCP Apps] Sending message:', text);
      sendNotification('ui/message', { text: text });
    },

    // Notify host of size change
    resize(width, height) {
      sendNotification('ui/size-change', { width: width, height: height });
    }
  };

  // Also provide window.openai for compatibility with OpenAI Apps SDK
  if (!window.openai) {
    // Merge annotations into responseMetadata for OpenAI SDK compatibility
    var responseMetadataWithAnnotations = Object.assign({}, ${JSON.stringify(responseMetadata)}, {
      annotations: ${JSON.stringify(annotations)}
    });

    window.openai = {
      // Data properties
      toolInput: window.mcpApp.toolInput,
      toolOutput: window.mcpApp.toolResult,
      toolResponseMetadata: responseMetadataWithAnnotations,
      theme: window.mcpApp.hostContext.theme,
      locale: window.mcpApp.hostContext.locale,
      displayMode: window.mcpApp.hostContext.displayMode,
      maxHeight: window.mcpApp.hostContext.maxHeight,
      safeArea: window.mcpApp.hostContext.safeArea,
      userAgent: window.mcpApp.hostContext.userAgent,
      widgetState: {},

      // OpenAI Apps SDK specific properties
      widgetSessionId: '${widgetSessionId}',
      widgetPrefersBorder: ${widgetPrefersBorder},
      invocationStatusText: ${JSON.stringify(invocationStatusText || {})},
      annotations: ${JSON.stringify(annotations)},
      userLocation: ${JSON.stringify(userLocation || null)},

      // Methods
      callTool: function(name, args) {
        return window.mcpApp.callTool(name, args);
      },
      sendFollowUpMessage: function(message) {
        return window.mcpApp.sendMessage(typeof message === 'string' ? message : message.prompt);
      },
      requestDisplayMode: function(options) {
        var mode = typeof options === 'string' ? options : (options && options.mode) || 'inline';
        window.openai.displayMode = mode;
        sendNotification('ui/display-mode', { mode: mode });
      },
      openExternal: function(options) {
        var url = typeof options === 'string' ? options : options.href;
        return window.mcpApp.openLink(url);
      },
      requestClose: function() {
        sendNotification('ui/close', {});
      },
      setWidgetState: function(state) {
        window.openai.widgetState = state;
        sendNotification('ui/widget-state', { state: state });
      },
      resize: function(height) {
        // OpenAI SDK uses single height parameter
        window.mcpApp.resize(undefined, height);
      },
      requestModal: function(options) {
        // Request modal from host
        // Options can include: url, title, width, height
        return new Promise(function(resolve, reject) {
          var modalId = 'modal-' + Date.now();
          var request = {
            jsonrpc: '2.0',
            id: ++_rpcId,
            method: 'ui/request-modal',
            params: {
              modalId: modalId,
              url: options.url,
              title: options.title,
              width: options.width || 600,
              height: options.height || 400,
            }
          };
          _pendingRequests.set(request.id, { resolve: resolve, reject: reject });
          window.parent.postMessage(request, '*');

          // Timeout after 60 seconds for modals
          setTimeout(function() {
            if (_pendingRequests.has(request.id)) {
              _pendingRequests.delete(request.id);
              reject(new Error('Modal request timeout'));
            }
          }, 60000);
        });
      }
    };
  }

  // Listen for JSON-RPC responses and notifications
  window.addEventListener('message', function(event) {
    var data = event.data;
    if (!data) return;

    // Handle JSON-RPC 2.0 response
    if (data.jsonrpc === '2.0' && data.id !== undefined) {
      var pending = _pendingRequests.get(data.id);
      if (pending) {
        _pendingRequests.delete(data.id);
        if (data.error) {
          pending.reject(new Error(data.error.message || 'RPC Error'));
        } else {
          pending.resolve(data.result);
        }
      }
      return;
    }

    // Handle JSON-RPC 2.0 notifications from host
    if (data.jsonrpc === '2.0' && data.method) {
      var params = data.params || {};

      switch (data.method) {
        case 'ui/notifications/tool-input':
          window.mcpApp.toolInput = params;
          window.openai.toolInput = params;
          window.dispatchEvent(new CustomEvent('mcp:tool-input', { detail: params }));
          break;

        case 'ui/notifications/tool-result':
          window.mcpApp.toolResult = params;
          window.openai.toolOutput = params;
          window.dispatchEvent(new CustomEvent('mcp:tool-result', { detail: params }));
          break;

        case 'ui/host-context-change':
          Object.assign(window.mcpApp.hostContext, params);
          if (params.theme) window.openai.theme = params.theme;
          if (params.locale) window.openai.locale = params.locale;
          if (params.displayMode) window.openai.displayMode = params.displayMode;
          window.dispatchEvent(new CustomEvent('mcp:context-change', { detail: params }));
          break;

        case 'ui/notifications/tool-cancelled':
          window.dispatchEvent(new CustomEvent('mcp:tool-cancelled', { detail: params }));
          break;

        case 'ui/notifications/teardown':
          window.dispatchEvent(new CustomEvent('mcp:teardown', { detail: params }));
          break;
      }
      return;
    }

    // Handle legacy OpenAI format messages for compatibility
    if (data.type) {
      switch (data.type) {
        case 'openai:set_globals':
        case 'openai-bridge-set-globals':
          var globals = data.globals || data.payload || {};
          Object.assign(window.mcpApp.hostContext, {
            theme: globals.theme || window.mcpApp.hostContext.theme,
            locale: globals.locale || window.mcpApp.hostContext.locale,
            displayMode: globals.displayMode || window.mcpApp.hostContext.displayMode
          });
          window.openai.theme = window.mcpApp.hostContext.theme;
          window.openai.locale = window.mcpApp.hostContext.locale;
          window.openai.displayMode = window.mcpApp.hostContext.displayMode;
          window.dispatchEvent(new CustomEvent('mcp:context-change', { detail: globals }));
          break;

        case 'openai:callTool:response':
        case 'openai-bridge-call-tool-response':
          // This is handled by the openai bridge if present
          break;
      }
    }
  });

  // Notify parent that widget is initialized
  sendNotification('ui/notifications/initialized', { widgetId: _widgetId });

  // Also send legacy ready message
  window.parent.postMessage({ type: 'ui-lifecycle-iframe-ready' }, '*');
  window.parent.postMessage({ type: 'openai:bridge-ready', toolId: _widgetId }, '*');

  console.log('[MCP Apps] Bridge initialized for widget:', _widgetId);
})();
</script>`;
}

/**
 * Inject MCP Apps bridge into widget HTML
 */
export function injectMcpAppsBridge(html: string, options: WidgetBridgeOptions): string {
  const bridgeScript = generateMcpAppsBridgeScript(options);

  // Inject as first script in head to ensure window.mcpApp is available before widget code
  if (html.includes('<head>')) {
    return html.replace('<head>', `<head>\n${bridgeScript}`);
  }
  if (html.includes('<head ')) {
    return html.replace(/<head[^>]*>/, `$&\n${bridgeScript}`);
  }
  if (html.includes('<html')) {
    return html.replace(/<html[^>]*>/, `$&\n<head>${bridgeScript}</head>`);
  }
  // Fallback: prepend to HTML
  return bridgeScript + html;
}
