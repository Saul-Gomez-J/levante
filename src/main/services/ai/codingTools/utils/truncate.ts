/**
 * Utilidades de truncado para limitar output de herramientas.
 * Migrado de pi-mono/packages/coding-agent
 */

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB
export const DEFAULT_MAX_LINE_CHARS = 2000;

export interface TruncationOptions {
  maxLines?: number;
  maxBytes?: number;
  maxLineChars?: number;
}

export interface TruncationResult {
  content: string;
  wasTruncated: boolean;
  totalLines: number;
  keptLines: number;
  totalBytes: number;
  keptBytes: number;
}

/**
 * Truncar líneas largas individuales
 */
export function truncateLine(
  line: string,
  maxChars: number = DEFAULT_MAX_LINE_CHARS
): { text: string; wasTruncated: boolean } {
  if (line.length <= maxChars) {
    return { text: line, wasTruncated: false };
  }
  return {
    text: line.slice(0, maxChars) + "... [truncated]",
    wasTruncated: true,
  };
}

/**
 * Truncar desde el inicio (mantener últimas líneas).
 * Útil para bash donde los errores aparecen al final.
 */
export function truncateTail(
  content: string,
  options: TruncationOptions = {}
): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLineChars = options.maxLineChars ?? DEFAULT_MAX_LINE_CHARS;

  const totalBytes = Buffer.byteLength(content, "utf8");
  const lines = content.split("\n");
  const totalLines = lines.length;

  // Truncar líneas individuales largas
  const truncatedLines = lines.map((line) => truncateLine(line, maxLineChars).text);

  // Si ya está dentro de los límites
  if (truncatedLines.length <= maxLines) {
    const result = truncatedLines.join("\n");
    const resultBytes = Buffer.byteLength(result, "utf8");
    if (resultBytes <= maxBytes) {
      return {
        content: result,
        wasTruncated: totalBytes !== resultBytes,
        totalLines,
        keptLines: truncatedLines.length,
        totalBytes,
        keptBytes: resultBytes,
      };
    }
  }

  // Mantener las últimas N líneas
  const keptLines = truncatedLines.slice(-maxLines);
  let result = keptLines.join("\n");
  let resultBytes = Buffer.byteLength(result, "utf8");

  // Si aún excede maxBytes, reducir más líneas
  while (resultBytes > maxBytes && keptLines.length > 1) {
    keptLines.shift();
    result = keptLines.join("\n");
    resultBytes = Buffer.byteLength(result, "utf8");
  }

  const header = `[... ${totalLines - keptLines.length} lines truncated ...]\n`;

  return {
    content: header + result,
    wasTruncated: true,
    totalLines,
    keptLines: keptLines.length,
    totalBytes,
    keptBytes: resultBytes + Buffer.byteLength(header, "utf8"),
  };
}

/**
 * Truncar desde el final (mantener primeras líneas).
 * Útil para archivos donde el inicio es más relevante.
 */
export function truncateHead(
  content: string,
  options: TruncationOptions = {}
): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLineChars = options.maxLineChars ?? DEFAULT_MAX_LINE_CHARS;

  const totalBytes = Buffer.byteLength(content, "utf8");
  const lines = content.split("\n");
  const totalLines = lines.length;

  // Truncar líneas individuales
  const truncatedLines = lines.map((line) => truncateLine(line, maxLineChars).text);

  if (truncatedLines.length <= maxLines) {
    const result = truncatedLines.join("\n");
    const resultBytes = Buffer.byteLength(result, "utf8");
    if (resultBytes <= maxBytes) {
      return {
        content: result,
        wasTruncated: totalBytes !== resultBytes,
        totalLines,
        keptLines: truncatedLines.length,
        totalBytes,
        keptBytes: resultBytes,
      };
    }
  }

  // Mantener las primeras N líneas
  const keptLines = truncatedLines.slice(0, maxLines);
  let result = keptLines.join("\n");
  let resultBytes = Buffer.byteLength(result, "utf8");

  while (resultBytes > maxBytes && keptLines.length > 1) {
    keptLines.pop();
    result = keptLines.join("\n");
    resultBytes = Buffer.byteLength(result, "utf8");
  }

  const footer = `\n[... ${totalLines - keptLines.length} lines truncated ...]`;

  return {
    content: result + footer,
    wasTruncated: true,
    totalLines,
    keptLines: keptLines.length,
    totalBytes,
    keptBytes: resultBytes + Buffer.byteLength(footer, "utf8"),
  };
}

/**
 * Formatear tamaño en bytes de forma legible
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
