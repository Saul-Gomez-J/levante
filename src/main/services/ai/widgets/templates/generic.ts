/**
 * Generic Widget Template (Fallback)
 */

import { escapeHtml } from '../htmlUtils';

/**
 * Generate Generic widget fallback HTML
 */
export function generateGenericWidgetHtml(name: string, data: Record<string, any>): string {
  const dataEntries = Object.entries(data)
    .filter(([key]) => !key.startsWith('_'))
    .map(([key, value]) => `
      <div class="item">
        <span class="key">${escapeHtml(key)}</span>
        <span class="value">${escapeHtml(String(value))}</span>
      </div>
    `).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f8f9fa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .widget {
      background: #fff;
      border-radius: 12px;
      padding: 20px;
      width: 100%;
      max-width: 350px;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
    }
    .title {
      font-size: 16px;
      font-weight: 600;
      color: #333;
      margin-bottom: 15px;
      text-transform: capitalize;
    }
    .item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #eee;
    }
    .item:last-child { border-bottom: none; }
    .key { color: #666; text-transform: capitalize; }
    .value { font-weight: 500; color: #333; }
  </style>
</head>
<body>
  <div class="widget">
    <div class="title">${escapeHtml(name.replace(/-/g, ' '))}</div>
    ${dataEntries}
  </div>
</body>
</html>`;
}
