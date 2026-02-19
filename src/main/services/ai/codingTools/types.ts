/**
 * Tipos para las coding tools.
 * Adaptados de pi-mono para trabajar con Vercel AI SDK + Zod.
 */

export interface TruncationResult {
  content: string;
  wasTruncated: boolean;
  totalLines: number;
  keptLines: number;
  totalBytes: number;
  keptBytes: number;
}

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  interrupted: boolean;
  timedOut: boolean;
}

export interface EditResult {
  success: boolean;
  diff?: string;
  error?: string;
  linesChanged?: number;
}

export interface ReadResult {
  content: string;
  mimeType?: string;
  isImage?: boolean;
  isBinary?: boolean;
  truncated?: boolean;
}

export interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

export interface GlobMatch {
  path: string;
  isDirectory: boolean;
}

export interface LsResult {
  success: boolean;
  count?: number;
  totalEntries?: number;
  truncated?: boolean;
  entries?: string;
  error?: string;
}
