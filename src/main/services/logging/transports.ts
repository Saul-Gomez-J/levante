import type { LogTransport, LogEntry, LogLevel } from '../../types/logger';
import * as fs from 'fs';
import * as path from 'path';
import { directoryService } from '../directoryService';

// Shared timezone configuration for all transports
let globalTimezone: string = 'auto';

/**
 * Set the global timezone for all log transports
 * @param timezone IANA timezone identifier (e.g., 'Europe/Madrid') or 'auto' for system timezone
 */
export function setLogTimezone(timezone: string): void {
  globalTimezone = timezone;
}

/**
 * Get the current global timezone setting
 */
export function getLogTimezone(): string {
  return globalTimezone;
}

/**
 * Format a timestamp using the configured timezone
 */
function formatTimestampWithTimezone(timestamp: Date, timezone: string): string {
  try {
    if (timezone === 'auto' || !timezone) {
      // Use local system time
      const year = timestamp.getFullYear();
      const month = String(timestamp.getMonth() + 1).padStart(2, '0');
      const day = String(timestamp.getDate()).padStart(2, '0');
      const hours = String(timestamp.getHours()).padStart(2, '0');
      const minutes = String(timestamp.getMinutes()).padStart(2, '0');
      const seconds = String(timestamp.getSeconds()).padStart(2, '0');
      return `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;
    }

    // Use specified IANA timezone
    const formatted = timestamp.toLocaleString('sv-SE', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).replace(',', '');

    return `[${formatted}]`;
  } catch {
    // Fallback to ISO if timezone is invalid
    return `[${timestamp.toISOString().replace('T', ' ').slice(0, -5)}]`;
  }
}

export class ConsoleTransport implements LogTransport {
  private readonly colors = {
    debug: '\x1b[36m',    // Cyan
    info: '\x1b[32m',     // Green
    warn: '\x1b[33m',     // Yellow
    error: '\x1b[31m',    // Red
    reset: '\x1b[0m',     // Reset
    bold: '\x1b[1m',      // Bold
    category: '\x1b[35m', // Magenta
  };

  write(entry: LogEntry): void {
    const timestamp = this.formatTimestamp(entry.timestamp);
    const category = this.formatCategory(entry.category);
    const level = this.formatLevel(entry.level);
    const message = entry.message;

    let output = `${timestamp} ${category} ${level} ${message}`;

    if (entry.context && Object.keys(entry.context).length > 0) {
      output += '\n' + this.formatContext(entry.context);
    }

    this.writeToConsole(entry.level, output);
  }

  private formatTimestamp(timestamp: Date): string {
    return formatTimestampWithTimezone(timestamp, globalTimezone);
  }

  private formatCategory(category: string): string {
    const categoryUpper = category.toUpperCase().replace('-', '-');
    return `${this.colors.category}[${categoryUpper}]${this.colors.reset}`;
  }

  private formatLevel(level: LogLevel): string {
    const color = this.colors[level];
    const levelUpper = level.toUpperCase();
    return `${color}${this.colors.bold}[${levelUpper}]${this.colors.reset}`;
  }

  private formatContext(context: Record<string, any>): string {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(context)) {
      const formattedValue = this.formatValue(value);
      lines.push(`  ${key}: ${formattedValue}`);
    }
    return lines.join('\n');
  }

  private formatValue(value: any): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return `[${value.map(v => this.formatValue(v)).join(', ')}]`;
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2).replace(/\n/g, '\n  ');
      } catch {
        return '[Object]';
      }
    }
    return String(value);
  }

  private writeToConsole(level: LogLevel, message: string): void {
    switch (level) {
      case 'debug':
        console.log(message);
        break;
      case 'info':
        console.info(message);
        break;
      case 'warn':
        console.warn(message);
        break;
      case 'error':
        console.error(message);
        break;
    }
  }
}

export class FileTransport implements LogTransport {
  private readonly resolvedFilePath: string;

  constructor(private readonly filePath?: string) {
    // Use DirectoryService for consistent path management
    this.resolvedFilePath = filePath 
      ? this.resolveFilePath(filePath)
      : directoryService.getLogsPath();
    
    this.ensureDirectoryExists();
  }

  private resolveFilePath(filePath: string): string {
    // If relative path, use DirectoryService to resolve within ~/levante/
    if (!path.isAbsolute(filePath)) {
      return directoryService.getFilePath(filePath);
    }
    return filePath;
  }

  private ensureDirectoryExists(): void {
    try {
      // Ensure directory exists synchronously for constructor
      const directory = path.dirname(this.resolvedFilePath);
      require('fs').mkdirSync(directory, { recursive: true });
    } catch (error) {
      console.error('Failed to create log directory:', error);
    }
  }

  write(entry: LogEntry): void {
    try {
      const logLine = this.formatEntry(entry);
      
      // Append to file synchronously (for simplicity and reliability)
      fs.appendFileSync(this.resolvedFilePath, logLine + '\n', 'utf8');
    } catch (error) {
      // Fallback to console if file writing fails
      console.error('Failed to write to log file:', error);
      // Don't use ConsoleTransport to avoid infinite loops
      console.log(this.formatEntry(entry));
    }
  }

  private formatEntry(entry: LogEntry): string {
    const timestamp = this.formatTimestamp(entry.timestamp);
    const category = `[${entry.category.toUpperCase()}]`;
    const level = `[${entry.level.toUpperCase()}]`;
    
    let output = `${timestamp} ${category} ${level} ${entry.message}`;
    
    if (entry.context && Object.keys(entry.context).length > 0) {
      output += ' ' + this.formatContext(entry.context);
    }
    
    return output;
  }

  private formatTimestamp(timestamp: Date): string {
    return formatTimestampWithTimezone(timestamp, globalTimezone);
  }

  private formatContext(context: Record<string, any>): string {
    try {
      return JSON.stringify(context);
    } catch {
      return '[Context serialization failed]';
    }
  }
}