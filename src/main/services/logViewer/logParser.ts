import type { LogEntry, LogCategory, LogLevel, LogEntryUI } from '../../types/logger';
import { randomUUID } from 'crypto';

/**
 * Format types for log files
 */
export type LogFormat = 'json' | 'human-readable';

/**
 * Parse a JSON-formatted log line (production format)
 * Example: {"timestamp":"2025-01-28T14:30:25.123Z","level":"info","category":"core","message":"Test"}
 */
export function parseJsonLog(line: string): LogEntryUI | null {
  try {
    const parsed = JSON.parse(line.trim());

    if (!parsed.timestamp || !parsed.level || !parsed.category || !parsed.message) {
      return null;
    }

    const { timestamp, level, category, message, ...context } = parsed;

    return {
      id: randomUUID(),
      timestamp: new Date(timestamp),
      category: category.toLowerCase() as LogCategory,
      level: level.toLowerCase() as LogLevel,
      message: String(message),
      context: Object.keys(context).length > 0 ? context : undefined,
      raw: line,
    };
  } catch {
    return null;
  }
}

/**
 * Parse a human-readable log line (development format)
 * Example:
 * [2025-01-28 14:30:25] [CORE] [INFO] Test message
 * {"extra": "data"}
 */
export function parseHumanReadableLog(lines: string[]): LogEntryUI | null {
  if (lines.length === 0) return null;

  // Regex pattern for header line
  // Matches: [timestamp] [CATEGORY] [LEVEL] message
  const headerRegex = /^\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.+)$/;

  const match = lines[0].match(headerRegex);
  if (!match) return null;

  const [, timestampStr, categoryStr, levelStr, message] = match;

  // Parse timestamp - Winston uses "YYYY-MM-DD HH:mm:ss" format with timezone
  let timestamp: Date;
  try {
    // Handle timezone offset if present (e.g., "2025-01-28 14:30:25 GMT-0600")
    const cleanTimestamp = timestampStr.replace(/\s+GMT[+-]\d{4}$/, '').trim();
    timestamp = new Date(cleanTimestamp.replace(' ', 'T') + 'Z');
  } catch {
    return null;
  }

  // Parse context if present (subsequent lines as JSON)
  let context: Record<string, any> | undefined;
  if (lines.length > 1) {
    try {
      const contextStr = lines.slice(1).join('\n').trim();
      if (contextStr) {
        context = JSON.parse(contextStr);
      }
    } catch {
      // Context parsing failed - not critical
    }
  }

  return {
    id: randomUUID(),
    timestamp,
    category: categoryStr.toLowerCase() as LogCategory,
    level: levelStr.toLowerCase() as LogLevel,
    message: message.trim(),
    context,
    raw: lines.join('\n'),
  };
}

/**
 * Detect log format from the first line
 */
export function detectLogFormat(firstLine: string): LogFormat {
  if (!firstLine || firstLine.trim().length === 0) {
    return 'human-readable'; // Default
  }

  const trimmed = firstLine.trim();

  // JSON format starts with {
  if (trimmed.startsWith('{')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      return 'human-readable';
    }
  }

  // Human-readable format starts with [
  if (trimmed.startsWith('[')) {
    return 'human-readable';
  }

  return 'human-readable';
}

/**
 * Parse a single log entry based on detected format
 */
export function parseLogEntry(lines: string[], format?: LogFormat): LogEntryUI | null {
  if (lines.length === 0) return null;

  const detectedFormat = format || detectLogFormat(lines[0]);

  if (detectedFormat === 'json') {
    return parseJsonLog(lines[0]);
  } else {
    return parseHumanReadableLog(lines);
  }
}
