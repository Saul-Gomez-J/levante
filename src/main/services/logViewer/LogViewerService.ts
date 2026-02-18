import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { directoryService } from '../directoryService';
import { parseLogEntry, detectLogFormat, type LogFormat } from './logParser';
import type { LogEntryUI } from '../../types/logger';
import { getLogger } from '../logging';

/**
 * Service for watching and streaming log files to the renderer process
 */
export class LogViewerService {
  private watcher: fs.FSWatcher | null = null;
  private currentLogFile: string | null = null;
  private logFormat: LogFormat = 'human-readable';
  private filePosition: number = 0;
  private buffer: LogEntryUI[] = [];
  private readonly maxBufferSize = 1000;
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly debounceDelay = 100; // ms
  private logger = getLogger();
  private mainWindow: BrowserWindow | null = null;

  /**
   * Start watching the current log file
   */
  startWatching(window: BrowserWindow): void {
    if (this.watcher) {
      this.logger.core.warn('LogViewerService: Already watching logs');
      return;
    }

    this.mainWindow = window;
    this.currentLogFile = this.getCurrentLogFile();

    if (!this.currentLogFile) {
      this.logger.core.error('LogViewerService: Could not determine log file path');
      throw new Error('Could not determine log file path');
    }

    // Detect format from existing file
    this.detectFormatFromFile();

    // Set initial file position to end (we'll read recent entries separately)
    try {
      const stats = fs.statSync(this.currentLogFile);
      this.filePosition = stats.size;
    } catch (error) {
      this.logger.core.warn('LogViewerService: Could not get initial file size', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.filePosition = 0;
    }

    // Start watching
    this.watcher = fs.watch(this.currentLogFile, (eventType) => {
      if (eventType === 'change') {
        this.handleFileChange();
      }
    });

    this.logger.core.info('LogViewerService: Started watching logs', {
      file: this.currentLogFile,
      format: this.logFormat,
    });
  }

  /**
   * Stop watching the log file
   */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.mainWindow = null;
    this.logger.core.info('LogViewerService: Stopped watching logs');
  }

  /**
   * Check if currently watching logs
   */
  isWatching(): boolean {
    return this.watcher !== null;
  }

  /**
   * Get recent log entries from the current file
   */
  async getRecentEntries(limit: number = 500): Promise<LogEntryUI[]> {
    const logFile = this.getCurrentLogFile();
    if (!logFile) {
      return [];
    }

    try {
      const content = await fs.promises.readFile(logFile, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim().length > 0);

      // Detect format
      const format = lines.length > 0 ? detectLogFormat(lines[0]) : this.logFormat;

      const entries: LogEntryUI[] = [];
      let currentLines: string[] = [];

      for (const line of lines) {
        if (format === 'json') {
          // Each line is a complete entry
          const entry = parseLogEntry([line], format);
          if (entry) {
            entries.push(entry);
          }
        } else {
          // Human-readable format - header lines start with [
          if (line.startsWith('[')) {
            // New entry - parse previous if exists
            if (currentLines.length > 0) {
              const entry = parseLogEntry(currentLines, format);
              if (entry) {
                entries.push(entry);
              }
            }
            currentLines = [line];
          } else {
            // Context line - add to current entry
            currentLines.push(line);
          }
        }
      }

      // Parse last entry in human-readable mode
      if (format === 'human-readable' && currentLines.length > 0) {
        const entry = parseLogEntry(currentLines, format);
        if (entry) {
          entries.push(entry);
        }
      }

      // Return last N entries
      return entries.slice(-limit);
    } catch (error) {
      this.logger.core.error('LogViewerService: Failed to read recent entries', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get the current log file path
   */
  getCurrentLogFile(): string {
    // Winston daily rotate creates files like: levante-YYYY-MM-DD.log
    const logsDir = path.dirname(directoryService.getLogsPath());
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const currentLogFile = path.join(logsDir, `levante-${today}.log`);

    // Check if file exists, if not fall back to base log path
    if (fs.existsSync(currentLogFile)) {
      return currentLogFile;
    }

    // Fallback to the base log file
    return directoryService.getLogsPath();
  }

  /**
   * Get the logs directory path
   */
  getLogDirectory(): string {
    return path.dirname(directoryService.getLogsPath());
  }

  /**
   * Handle file change events (debounced)
   */
  private handleFileChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.readNewEntries();
    }, this.debounceDelay);
  }

  /**
   * Read new entries from the file since last position
   */
  private readNewEntries(): void {
    if (!this.currentLogFile || !this.mainWindow) {
      return;
    }

    try {
      const stats = fs.statSync(this.currentLogFile);
      const currentSize = stats.size;

      // File was truncated or rotated
      if (currentSize < this.filePosition) {
        this.filePosition = 0;
      }

      // No new data
      if (currentSize === this.filePosition) {
        return;
      }

      // Read new data
      const stream = fs.createReadStream(this.currentLogFile, {
        start: this.filePosition,
        end: currentSize - 1,
        encoding: 'utf-8',
      });

      let buffer = '';

      stream.on('data', (chunk: string | Buffer) => {
        buffer += chunk.toString();
      });

      stream.on('end', () => {
        const lines = buffer.split('\n').filter((line) => line.trim().length > 0);

        if (lines.length === 0) {
          return;
        }

        const entries: LogEntryUI[] = [];
        let currentLines: string[] = [];

        for (const line of lines) {
          if (this.logFormat === 'json') {
            const entry = parseLogEntry([line], this.logFormat);
            if (entry) {
              entries.push(entry);
            }
          } else {
            // Human-readable format
            if (line.startsWith('[')) {
              // New entry
              if (currentLines.length > 0) {
                const entry = parseLogEntry(currentLines, this.logFormat);
                if (entry) {
                  entries.push(entry);
                }
              }
              currentLines = [line];
            } else {
              currentLines.push(line);
            }
          }
        }

        // Parse last entry in human-readable mode
        if (this.logFormat === 'human-readable' && currentLines.length > 0) {
          const entry = parseLogEntry(currentLines, this.logFormat);
          if (entry) {
            entries.push(entry);
          }
        }

        // Emit each new entry
        entries.forEach((entry) => {
          this.mainWindow?.webContents.send('levante/logs/new-entry', entry);
        });

        // Update position
        this.filePosition = currentSize;
      });

      stream.on('error', (error) => {
        this.logger.core.error('LogViewerService: Error reading new entries', {
          error: error.message,
        });
      });
    } catch (error) {
      this.logger.core.error('LogViewerService: Error in readNewEntries', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Detect log format from existing file
   */
  private detectFormatFromFile(): void {
    if (!this.currentLogFile) {
      return;
    }

    try {
      const content = fs.readFileSync(this.currentLogFile, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim().length > 0);

      if (lines.length > 0) {
        this.logFormat = detectLogFormat(lines[0]);
        this.logger.core.debug('LogViewerService: Detected log format', {
          format: this.logFormat,
        });
      }
    } catch (error) {
      this.logger.core.warn('LogViewerService: Could not detect format, using default', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Cleanup on service destruction
   */
  dispose(): void {
    this.stopWatching();
    this.buffer = [];
  }
}

// Singleton instance
export const logViewerService = new LogViewerService();
