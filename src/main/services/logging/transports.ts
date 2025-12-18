import type { LogTransport, LogEntry, LogLevel, LogRotationConfig } from '../../types/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
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

/**
 * Manages log file rotation, compression, and cleanup
 */
class LogRotationManager {
  constructor(
    private readonly baseFilePath: string,
    private readonly config: LogRotationConfig
  ) { }

  /**
   * Check if rotation is needed based on file size
   */
  public shouldRotate(): boolean {
    try {
      if (!fs.existsSync(this.baseFilePath)) return false;
      const stats = fs.statSync(this.baseFilePath);
      return stats.size >= this.config.maxSize;
    } catch {
      // File doesn't exist or can't be accessed
      return false;
    }
  }

  /**
   * Perform log rotation
   */
  public async rotate(): Promise<void> {
    try {
      // Generate timestamp for rotated file
      const timestamp = this.formatTimestamp(new Date());
      const ext = path.extname(this.baseFilePath);
      const basename = path.basename(this.baseFilePath, ext);
      const dirname = path.dirname(this.baseFilePath);

      // Create rotated filename: levante-2025-01-18-143025.log
      const rotatedFileName = `${basename}-${timestamp}${ext}`;
      const rotatedFilePath = path.join(dirname, rotatedFileName);

      // Rename current log file
      if (fs.existsSync(this.baseFilePath)) {
        fs.renameSync(this.baseFilePath, rotatedFilePath);
      }

      // Compress if enabled, then cleanup (must be sequential)
      if (this.config.compress) {
        this.compressFile(rotatedFilePath)
          .then(() => {
            return this.cleanupOldFiles();
          })
          .catch(error => {
            console.error('Failed to compress log file:', error);
            // Still try cleanup even if compression fails
            return this.cleanupOldFiles();
          });
      } else {
        this.cleanupOldFiles().catch(error => {
          console.error('Failed to cleanup old log files:', error);
        });
      }

    } catch (error) {
      console.error('Failed to rotate log file:', error);
    }
  }

  /**
   * Compress a rotated log file
   */
  private async compressFile(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const gzipPath = `${filePath}.gz`;

      // Skip if already compressed or doesn't exist
      if (!fs.existsSync(filePath) || fs.existsSync(gzipPath)) {
        resolve();
        return;
      }

      const readStream = fs.createReadStream(filePath);
      const writeStream = fs.createWriteStream(gzipPath);
      const gzip = zlib.createGzip();

      readStream
        .pipe(gzip)
        .pipe(writeStream)
        .on('finish', () => {
          // Delete original file after successful compression
          try {
            fs.unlinkSync(filePath);
            resolve();
          } catch (error) {
            reject(error);
          }
        })
        .on('error', reject);
    });
  }

  /**
   * Clean up old log files based on maxFiles and maxAge
   */
  private async cleanupOldFiles(): Promise<void> {
    try {
      const dirname = path.dirname(this.baseFilePath);
      const ext = path.extname(this.baseFilePath);
      const basename = path.basename(this.baseFilePath, ext);

      // Get all rotated log files (including compressed)
      const files = fs.readdirSync(dirname);
      const logFiles = files
        .filter(file => {
          return file.startsWith(`${basename}-`) &&
            (file.endsWith(ext) || file.endsWith(`${ext}.gz`));
        })
        .map(file => {
          const filePath = path.join(dirname, file);
          const stats = fs.statSync(filePath);
          return {
            path: filePath,
            name: file,
            mtime: stats.mtime,
            size: stats.size
          };
        })
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()); // Newest first

      // Delete files exceeding maxFiles limit
      if (logFiles.length > this.config.maxFiles) {
        const filesToDelete = logFiles.slice(this.config.maxFiles);
        for (const file of filesToDelete) {
          try {
            fs.unlinkSync(file.path);
          } catch (error) {
            console.error(`Failed to delete log file ${file.name}:`, error);
          }
        }
      }

      // Delete files older than maxAge
      const maxAgeMs = this.config.maxAge * 24 * 60 * 60 * 1000;
      const now = Date.now();

      for (const file of logFiles) {
        const age = now - file.mtime.getTime();
        if (age > maxAgeMs) {
          try {
            fs.unlinkSync(file.path);
          } catch (error) {
            console.error(`Failed to delete old log file ${file.name}:`, error);
          }
        }
      }

    } catch (error) {
      console.error('Failed to cleanup log files:', error);
    }
  }

  /**
   * Format timestamp for rotated file names
   */
  private formatTimestamp(date: Date): string {
    const pattern = this.config.datePattern || 'YYYY-MM-DD-HHmmss';

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return pattern
      .replace('YYYY', String(year))
      .replace('MM', month)
      .replace('DD', day)
      .replace('HH', hours)
      .replace('mm', minutes)
      .replace('ss', seconds);
  }
}

export class FileTransport implements LogTransport {
  private readonly resolvedFilePath: string;
  private rotationManager?: LogRotationManager;
  private rotationPromise?: Promise<void>;

  constructor(
    private readonly filePath?: string,
    private readonly rotationConfig?: LogRotationConfig
  ) {
    // Use DirectoryService for consistent path management
    this.resolvedFilePath = filePath
      ? this.resolveFilePath(filePath)
      : directoryService.getLogsPath();

    this.ensureDirectoryExists();

    // Initialize rotation manager if config provided
    if (rotationConfig) {
      this.rotationManager = new LogRotationManager(
        this.resolvedFilePath,
        rotationConfig
      );
    }
  }

  private resolveFilePath(filePath: string): string {
    if (!path.isAbsolute(filePath)) {
      return directoryService.getFilePath(filePath);
    }
    return filePath;
  }

  private ensureDirectoryExists(): void {
    try {
      const directory = path.dirname(this.resolvedFilePath);
      require('fs').mkdirSync(directory, { recursive: true });
    } catch (error) {
      console.error('Failed to create log directory:', error);
    }
  }

  write(entry: LogEntry): void {
    try {
      // Check if rotation is needed (before writing)
      if (this.rotationManager && this.rotationManager.shouldRotate()) {
        this.performRotation();
      }

      const logLine = this.formatEntry(entry);
      fs.appendFileSync(this.resolvedFilePath, logLine + '\n', 'utf8');
    } catch (error) {
      console.error('Failed to write to log file:', error);
      console.log(this.formatEntry(entry));
    }
  }

  private performRotation(): void {
    // Prevent concurrent rotation
    if (this.rotationPromise) {
      return;
    }

    // Perform rotation asynchronously
    this.rotationPromise = this.rotationManager!
      .rotate()
      .finally(() => {
        this.rotationPromise = undefined;
      });
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