/**
 * Herramienta Write: escribir archivos.
 * Adaptada de pi-mono para Vercel AI SDK.
 */

import { tool } from "ai";
import { z } from "zod";
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import { resolveToCwd } from "../utils/path-utils";
import { notifyFileChanged } from "../../../../preview/bridge";

export interface WriteToolConfig {
  cwd: string;
}

export function createWriteTool(config: WriteToolConfig) {
  return tool({
    description: `Write content to a file. Creates parent directories if needed.
The file_path must be an absolute path or relative to the current directory.
IMPORTANT: This will overwrite existing files. Always read a file first before writing if it exists.`,

    inputSchema: z.object({
      file_path: z.string().describe("The path to the file to write"),
      content: z.string().describe("The content to write to the file"),
    }),

    execute: async ({ file_path, content }: { file_path: string; content: string }) => {
      try {
        const resolvedPath = resolveToCwd(file_path, config.cwd);

        // Crear directorio padre si no existe
        await mkdir(dirname(resolvedPath), { recursive: true });

        // Escribir archivo
        await writeFile(resolvedPath, content, "utf8");

        // Notify preview window for auto-refresh
        notifyFileChanged(resolvedPath);

        const lines = content.split("\n").length;
        const bytes = Buffer.byteLength(content, "utf8");

        return {
          success: true,
          path: resolvedPath,
          message: `Successfully wrote ${lines} lines (${bytes} bytes) to ${file_path}`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `Failed to write file: ${message}`,
        };
      }
    },
  });
}
