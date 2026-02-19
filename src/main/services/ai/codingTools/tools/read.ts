/**
 * Herramienta Read: leer archivos.
 * Adaptada de pi-mono para Vercel AI SDK.
 */

import { tool } from "ai";
import { z } from "zod";
import { readFile, stat } from "fs/promises";
import { resolveReadPath } from "../utils/path-utils";
import { truncateHead, formatSize } from "../utils/truncate";

export interface ReadToolConfig {
  cwd: string;
  maxLines?: number;
  maxBytes?: number;
}

// Tipos MIME soportados para imágenes
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export function createReadTool(config: ReadToolConfig) {
  return tool({
    description: `Read the contents of a file.
Returns file content with line numbers (cat -n format).
For images, returns base64 encoded data.
The file_path must be an absolute path or relative to current directory.`,

    inputSchema: z.object({
      file_path: z.string().describe("The absolute path to the file to read"),
      offset: z.number().optional().describe("Line number to start reading from (0-indexed)"),
      limit: z.number().optional().describe("Maximum number of lines to read"),
    }),

    execute: async ({ file_path, offset, limit }: { file_path: string; offset?: number; limit?: number }) => {
      try {
        const resolvedPath = resolveReadPath(file_path, config.cwd);

        // Verificar que existe
        const stats = await stat(resolvedPath);

        if (stats.isDirectory()) {
          return {
            success: false,
            error: `Path is a directory, not a file: ${file_path}. Use ls command to list directory contents.`,
          };
        }

        // Detectar si es imagen
        const ext = file_path.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
        if (IMAGE_EXTENSIONS.has(ext)) {
          const buffer = await readFile(resolvedPath);
          const mimeType = ext === ".png" ? "image/png"
            : ext === ".gif" ? "image/gif"
            : ext === ".webp" ? "image/webp"
            : "image/jpeg";

          return {
            success: true,
            isImage: true,
            mimeType,
            data: buffer.toString("base64"),
            size: stats.size,
          };
        }

        // Leer archivo de texto
        const content = await readFile(resolvedPath, "utf8");
        const lines = content.split("\n");
        const totalLines = lines.length;

        // Aplicar offset y limit
        const startLine = offset ?? 0;
        const endLine = limit ? startLine + limit : totalLines;
        const selectedLines = lines.slice(startLine, endLine);

        // Formatear con números de línea (cat -n style)
        const formatted = selectedLines
          .map((line, idx) => {
            const lineNum = startLine + idx + 1;
            return `${String(lineNum).padStart(6, " ")}\t${line}`;
          })
          .join("\n");

        // Truncar si es muy largo
        const maxLines = config.maxLines ?? 2000;
        const maxBytes = config.maxBytes ?? 50 * 1024;

        const truncated = truncateHead(formatted, { maxLines, maxBytes });

        return {
          success: true,
          content: truncated.content,
          totalLines,
          displayedLines: selectedLines.length,
          truncated: truncated.wasTruncated,
          size: formatSize(stats.size),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.includes("ENOENT")) {
          return {
            success: false,
            error: `File not found: ${file_path}`,
          };
        }

        return {
          success: false,
          error: `Failed to read file: ${message}`,
        };
      }
    },
  });
}
