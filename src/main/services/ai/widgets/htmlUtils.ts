/**
 * HTML utility functions for widget rendering
 */

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Inject data into widget HTML template
 * Adds a script that:
 * 1. Sets window variables for immediate access (fallback)
 * 2. Implements @mcp-ui/client postMessage protocol to receive iframeRenderData
 *
 * The postMessage protocol:
 * - Parent sends 'ui-lifecycle-iframe-render-data' with payload.renderData
 * - Iframe notifies parent with 'ui-lifecycle-iframe-ready' when ready
 */
export function injectDataIntoHtml(html: string, data: Record<string, any>): string {
  // Escape data for safe inclusion in script
  const jsonData = JSON.stringify(data);

  const dataScript = `<script>
    // Fallback: Set data immediately for templates that read from window variables
    window.__data = ${jsonData};
    window.__props = ${jsonData};
    window.__widgetData = ${jsonData};
    window.__IFRAME_RENDER_DATA__ = ${jsonData};

    // mcp-use Apps SDK format: window.openai with toolInput and toolOutput
    // useWidget hook reads props from toolInput, output from toolOutput
    window.openai = window.openai || {};
    window.openai.toolInput = ${jsonData};
    window.openai.toolOutput = ${jsonData};

    // @mcp-ui/client postMessage protocol for receiving iframeRenderData
    (function() {
      var renderDataReceived = false;

      // Listen for render data from parent (UIResourceRenderer)
      window.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'ui-lifecycle-iframe-render-data') {
          if (renderDataReceived) return;
          renderDataReceived = true;

          var renderData = event.data.payload && event.data.payload.renderData;
          if (renderData) {
            // Update window variables with data from parent
            window.__data = renderData;
            window.__props = renderData;
            window.__widgetData = renderData;
            window.__IFRAME_RENDER_DATA__ = renderData;

            // mcp-use Apps SDK format
            window.openai = window.openai || {};
            window.openai.toolInput = renderData;
            window.openai.toolOutput = renderData;

            // Dispatch custom event for templates that listen for data
            window.dispatchEvent(new CustomEvent('mcp-render-data', { detail: renderData }));

            // If template has a renderUI function, call it
            if (typeof window.renderUI === 'function') {
              window.renderUI(renderData);
            }

            // If template has updateUI function, call it
            if (typeof window.updateUI === 'function') {
              window.updateUI(renderData);
            }
          }
        }
      });

      // Notify parent that iframe is ready to receive data
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'ui-lifecycle-iframe-ready' }, '*');
      }

      // Auto-resize: Send height to parent using @mcp-ui/client protocol
      // Uses 'ui-size-change' message type as per mcp-ui documentation
      function sendHeight() {
        if (window.parent && window.parent !== window) {
          var height = Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight
          );
          // Minimum height of 200px, maximum of 600px
          height = Math.max(200, Math.min(height, 600));
          window.parent.postMessage({
            type: 'ui-size-change',
            payload: { height: height }
          }, '*');
        }
      }

      // Use ResizeObserver for accurate height tracking (recommended by mcp-ui)
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

      // Fallback: Send height on load
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
          setTimeout(sendHeight, 100);
        });
      } else {
        setTimeout(sendHeight, 100);
      }

      // Also send height after window load (for images, etc.)
      window.addEventListener('load', function() {
        setTimeout(sendHeight, 200);
      });
    })();
  </script>`;

  // Try to inject after <head> tag
  if (html.includes('<head>')) {
    return html.replace('<head>', `<head>\n${dataScript}`);
  }
  // Try to inject after <html> tag
  if (html.includes('<html')) {
    return html.replace(/<html[^>]*>/, `$&\n<head>${dataScript}</head>`);
  }
  // Fallback: prepend to HTML
  return dataScript + html;
}
