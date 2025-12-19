/**
 * Text Analysis Chart Widget Template
 */

import { escapeHtml } from '../htmlUtils';

/**
 * Generate Text analysis chart widget HTML
 */
export function generateTextAnalysisChartHtml(data: Record<string, any>): string {
  const { wordCount, charCount, sentenceCount, avgWordLength } = data;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .chart {
      background: #fff;
      border-radius: 15px;
      padding: 25px;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 5px 20px rgba(0, 0, 0, 0.1);
    }
    .title {
      font-size: 18px;
      font-weight: 600;
      color: #333;
      margin-bottom: 20px;
    }
    .stat {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #eee;
    }
    .stat:last-child { border-bottom: none; }
    .stat-label { color: #666; }
    .stat-value { font-weight: 600; color: #333; }
  </style>
</head>
<body>
  <div class="chart">
    <div class="title">Text Analysis</div>
    <div class="stat">
      <span class="stat-label">Words</span>
      <span class="stat-value">${escapeHtml(String(wordCount ?? 0))}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Characters</span>
      <span class="stat-value">${escapeHtml(String(charCount ?? 0))}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Sentences</span>
      <span class="stat-value">${escapeHtml(String(sentenceCount ?? 0))}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Avg. Word Length</span>
      <span class="stat-value">${escapeHtml(String(avgWordLength ?? 0))}</span>
    </div>
  </div>
</body>
</html>`;
}
