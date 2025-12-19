/**
 * Widgets Module
 *
 * Provides widget HTML generation and injection utilities for MCP tools.
 * Supports mcp-use widgets and Skybridge/OpenAI compatible widgets.
 */

// HTML utilities
export { escapeHtml, injectDataIntoHtml } from './htmlUtils';

// Skybridge bridge injection
export { injectSkybridgeBridge } from './skybridgeBridge';
export type { SkybridgeOptions } from './skybridgeBridge';

// Widget templates
export {
  generateWeatherCardHtml,
  generateCalculatorResultHtml,
  generateTextAnalysisChartHtml,
  generateGenericWidgetHtml,
  getWeatherEmoji,
} from './templates';

/**
 * Widget metadata interface
 */
export interface WidgetMeta {
  name: string;
  description?: string;
  type: string;
  html?: string;
}

/**
 * Generate HTML for an mcp-use widget
 * Creates a self-contained HTML document that renders the widget
 */
export function generateWidgetHtml(
  widgetMeta: WidgetMeta,
  data: Record<string, any>
): string {
  const { name } = widgetMeta;

  // Import templates dynamically to avoid circular dependencies
  const {
    generateWeatherCardHtml,
    generateCalculatorResultHtml,
    generateTextAnalysisChartHtml,
    generateGenericWidgetHtml,
  } = require('./templates');

  // Generate widget-specific HTML based on the widget name
  switch (name) {
    case 'weather-card':
      return generateWeatherCardHtml(data);
    case 'calculator-result':
      return generateCalculatorResultHtml(data);
    case 'text-analysis-chart':
      return generateTextAnalysisChartHtml(data);
    default:
      // Generic widget fallback
      return generateGenericWidgetHtml(name, data);
  }
}
