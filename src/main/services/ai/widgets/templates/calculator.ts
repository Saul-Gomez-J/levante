/**
 * Calculator Result Widget Template
 */

import { escapeHtml } from '../htmlUtils';

/**
 * Generate Calculator result widget HTML
 */
export function generateCalculatorResultHtml(data: Record<string, any>): string {
  const { expression, result } = data;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .calculator {
      background: #16213e;
      border-radius: 15px;
      padding: 25px;
      min-width: 280px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    }
    .expression {
      font-size: 18px;
      color: #888;
      text-align: right;
      margin-bottom: 10px;
      font-family: 'SF Mono', Monaco, monospace;
    }
    .result {
      font-size: 42px;
      font-weight: 300;
      color: #fff;
      text-align: right;
      font-family: 'SF Mono', Monaco, monospace;
    }
  </style>
</head>
<body>
  <div class="calculator">
    <div class="expression">${escapeHtml(expression || '')}</div>
    <div class="result">= ${escapeHtml(String(result ?? ''))}</div>
  </div>
</body>
</html>`;
}
