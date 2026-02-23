/**
 * Herramienta Write: escribir archivos.
 * Adaptada de pi-mono para Vercel AI SDK.
 */

import { tool } from "ai";
import { z } from "zod";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { resolveToCwd } from "../utils/path-utils";
import { countDiffChanges, generateDiffString } from "./edit-diff";

export interface WriteToolConfig {
  cwd: string;
}

export function createWriteTool(config: WriteToolConfig) {
  return tool({
    needsApproval: true,
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

        // Leer contenido previo solo para generar diff.
        // Ignorar únicamente ENOENT (archivo no existe todavía).
        let previousContent = "";
        try {
          previousContent = await readFile(resolvedPath, "utf8");
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          if (err.code !== "ENOENT") {
            throw error;
          }
        }

        // Crear directorio padre si no existe
        await mkdir(dirname(resolvedPath), { recursive: true });

        // Escribir archivo
        await writeFile(resolvedPath, content, "utf8");

        const lines = content.split("\n").length;
        const bytes = Buffer.byteLength(content, "utf8");

        // Generar diff y métricas de cambios
        const diff = generateDiffString(previousContent, content, file_path);
        const changes = countDiffChanges(diff);

        return {
          success: true,
          path: resolvedPath,
          diff,
          linesAdded: changes.added,
          linesRemoved: changes.removed,
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
