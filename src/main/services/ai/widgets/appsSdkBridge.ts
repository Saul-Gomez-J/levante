/**
 * OpenAI Apps SDK Bridge
 *
 * Injects the window.openai API that ChatGPT Apps SDK widgets expect.
 * Provides globals and methods for widget-to-parent communication.
 *
 * @see https://developers.openai.com/apps-sdk/reference
 * @see https://mcpui.dev/guide/apps-sdk
 */

export interface AppsSdkBridgeOptions {
  toolInput: Record<string, any>;
  toolOutput: Record<string, any>;
  responseMetadata: Record<string, any>;
  locale?: string;
  theme?: 'light' | 'dark' | 'system';
}

/**
 * Inject OpenAI Apps SDK compatible bridge into widget HTML
 * Creates a full window.openai API that Apps SDK widgets expect:
 * - Globals: locale, theme, displayMode, safeArea, userAgent, toolInput, toolOutput, toolResponseMetadata
 * - Methods: callTool, sendFollowUpMessage, requestDisplayMode, openExternal, setWidgetState, requestClose
 *
 * Methods communicate with parent via postMessage using standard 'openai:*' message types
 * Also handles legacy 'openai-bridge-*' format for backwards compatibility
 */
export function injectAppsSdkBridge(html: string, options: AppsSdkBridgeOptions): string {
  const { toolInput, toolOutput, responseMetadata, locale = 'en-US', theme = 'system' } = options;

  // Resolve theme: 'system' will be updated by the parent via postMessage
  // Default to 'light' for initial render if 'system' is specified
  const resolvedTheme = theme === 'system' ? 'light' : theme;

  const bridgeScript = `<script>
    // OpenAI Apps SDK Bridge for Levante
    (function() {
      var pendingCallbacks = {};
      var callbackId = 0;
      var widgetState = {};

      // Initialize window.openai with globals and methods
      window.openai = {
        // Globals (read-only data) - matches OpenAI Apps SDK format
        locale: ${JSON.stringify(locale)},
        theme: ${JSON.stringify(resolvedTheme)},
        displayMode: 'inline',
        maxHeight: 600,
        safeArea: { insets: { top: 0, bottom: 0, left: 0, right: 0 } },
        userAgent: {
          device: { type: 'desktop' },
          capabilities: { hover: true, touch: false }
        },
        toolInput: ${JSON.stringify(toolInput)},
        toolOutput: ${JSON.stringify(toolOutput)},
        toolResponseMetadata: ${JSON.stringify(responseMetadata)},
        widgetState: widgetState,

        // Methods - using standard OpenAI message format (openai:*)
        callTool: function(toolName, args) {
          return new Promise(function(resolve, reject) {
            var id = ++callbackId;
            pendingCallbacks[id] = { resolve: resolve, reject: reject };
            // Use standard OpenAI format
            window.parent.postMessage({
              type: 'openai:callTool',
              callId: id,
              toolName: toolName,
              args: args || {}
            }, '*');
          });
        },

        sendFollowUpMessage: function(message) {
          window.parent.postMessage({
            type: 'openai:sendFollowUpMessage',
            message: message
          }, '*');
        },

        requestDisplayMode: function(options) {
          var mode = typeof options === 'string' ? options : (options && options.mode) || 'inline';
          window.openai.displayMode = mode;
          window.parent.postMessage({
            type: 'openai:requestDisplayMode',
            mode: mode
          }, '*');
        },

        openExternal: function(url) {
          window.parent.postMessage({
            type: 'openai:openExternal',
            url: url
          }, '*');
        },

        requestClose: function() {
          window.parent.postMessage({
            type: 'openai:requestClose'
          }, '*');
        },

        setWidgetState: function(state) {
          widgetState = state;
          window.openai.widgetState = state;
          window.parent.postMessage({
            type: 'openai:setWidgetState',
            state: state
          }, '*');
        },

        // Notify host of widget height change
        notifyIntrinsicHeight: function(height) {
          window.parent.postMessage({
            type: 'openai:resize',
            height: height
          }, '*');
        }
      };

      // Listen for responses from parent
      window.addEventListener('message', function(event) {
        var data = event.data;
        if (!data || !data.type) return;

        // Handle callTool response (both Levante and OpenAI formats)
        if (data.type === 'openai-bridge-call-tool-response' || data.type === 'openai:callTool:response') {
          // Support both payload formats
          var id = data.payload?.id || data.callId;
          var callback = pendingCallbacks[id];
          if (callback) {
            delete pendingCallbacks[id];
            if (data.payload?.error || data.error) {
              callback.reject(new Error(data.payload?.error || data.error));
            } else {
              // Handle both result formats
              var result = data.payload?.result || data.result;
              callback.resolve(result);
            }
          }
        }

        // Handle globals update from parent
        if (data.type === 'openai-bridge-set-globals' || data.type === 'openai:set_globals') {
          var globals = data.payload || data.globals || {};
          if (globals.theme) window.openai.theme = globals.theme;
          if (globals.locale) window.openai.locale = globals.locale;
          if (globals.displayMode) window.openai.displayMode = globals.displayMode;
          if (globals.maxHeight) window.openai.maxHeight = globals.maxHeight;
          if (globals.toolInput) window.openai.toolInput = globals.toolInput;
          if (globals.toolOutput) window.openai.toolOutput = globals.toolOutput;
          if (globals.toolResponseMetadata) window.openai.toolResponseMetadata = globals.toolResponseMetadata;

          // Dispatch event for hooks that listen to globals changes
          window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: globals }));
        }

        // Handle iframeRenderData from @mcp-ui/client
        if (data.type === 'ui-lifecycle-iframe-render-data') {
          var renderData = data.payload && data.payload.renderData;
          if (renderData) {
            // Update toolInput/toolOutput with render data
            window.openai.toolInput = Object.assign({}, window.openai.toolInput, renderData);
            window.openai.toolOutput = Object.assign({}, window.openai.toolOutput, renderData);
            if (renderData.theme) window.openai.theme = renderData.theme;
            if (renderData.locale) window.openai.locale = renderData.locale;

            // Also set legacy variables
            window.__IFRAME_RENDER_DATA__ = renderData;
            window.__data = renderData;
            window.__props = renderData;
          }
        }
      });

      // Auto-resize: Send height to parent
      function sendHeight() {
        if (window.parent && window.parent !== window) {
          var height = Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight
          );
          height = Math.max(200, Math.min(height, 600));
          window.parent.postMessage({
            type: 'ui-size-change',
            payload: { height: height }
          }, '*');
        }
      }

      // Use ResizeObserver for accurate height tracking
      if (typeof ResizeObserver !== 'undefined') {
        var resizeObserver = new ResizeObserver(function(entries) {
          entries.forEach(function(entry) {
            var height = Math.max(200, Math.min(entry.contentRect.height, 600));
            window.parent.postMessage({
              type: 'ui-size-change',
              payload: { height: height }
            }, '*');
          });
        });
        resizeObserver.observe(document.documentElement);
      }

      // Notify parent that iframe is ready
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'ui-lifecycle-iframe-ready' }, '*');
      }

      // Send initial height
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
          setTimeout(sendHeight, 100);
        });
      } else {
        setTimeout(sendHeight, 100);
      }

      window.addEventListener('load', function() {
        setTimeout(sendHeight, 200);
      });
    })();
  </script>`;

  // Inject as first script in head to ensure window.openai is available before widget code
  if (html.includes('<head>')) {
    return html.replace('<head>', `<head>\n${bridgeScript}`);
  }
  if (html.includes('<head ')) {
    return html.replace(/<head[^>]*>/, `$&\n${bridgeScript}`);
  }
  // Try to inject after <html> tag
  if (html.includes('<html')) {
    return html.replace(/<html[^>]*>/, `$&\n<head>${bridgeScript}</head>`);
  }
  // Fallback: prepend to HTML
  return bridgeScript + html;
}
