/**
 * Herramienta Edit: editar archivos con string replacement.
 * Adaptada de pi-mono para Vercel AI SDK.
 */

import { tool } from "ai";
import { z } from "zod";
import { readFile, writeFile } from "fs/promises";
import { resolveToCwd } from "../utils/path-utils";
import { fuzzyFindText, generateDiffString, countDiffChanges } from "./edit-diff";
import { notifyFileChanged } from "../../../../preview/bridge";

export interface EditToolConfig {
  cwd: string;
}

export function createEditTool(config: EditToolConfig) {
  return tool({
    description: `Edit a file by replacing exact string matches.
The old_string must be unique in the file, or the edit will fail.
Use replace_all: true to replace all occurrences.
IMPORTANT: Always read the file first before editing to ensure old_string is exact.`,

    inputSchema: z.object({
      file_path: z.string().describe("The path to the file to edit"),
      old_string: z.string().describe("The exact string to find and replace"),
      new_string: z.string().describe("The string to replace with"),
      replace_all: z.boolean().optional().default(false)
        .describe("If true, replace all occurrences instead of requiring unique match"),
    }),

    execute: async ({ file_path, old_string, new_string, replace_all }: { file_path: string; old_string: string; new_string: string; replace_all?: boolean }) => {
      try {
        const resolvedPath = resolveToCwd(file_path, config.cwd);

        // Leer archivo
        const content = await readFile(resolvedPath, "utf8");

        // Verificar que old_string !== new_string
        if (old_string === new_string) {
          return {
            success: false,
            error: "old_string and new_string are identical. No changes needed.",
          };
        }

        // Buscar el texto
        const match = fuzzyFindText(content, old_string);

        if (!match.found) {
          // Dar contexto útil para debugging
          const preview = content.slice(0, 500);
          return {
            success: false,
            error: `Could not find old_string in file. Make sure you read the file first and copy the exact text.`,
            hint: `File preview (first 500 chars):\n${preview}`,
          };
        }

        // Si no es replace_all, verificar unicidad
        if (!replace_all) {
          const occurrences = content.split(old_string).length - 1;
          if (occurrences > 1) {
            return {
              success: false,
              error: `old_string appears ${occurrences} times in the file. Either provide more context to make it unique, or use replace_all: true.`,
            };
          }
        }

        // Realizar reemplazo
        let newContent: string;
        let replacements: number;

        if (replace_all) {
          const parts = content.split(old_string);
          replacements = parts.length - 1;
          newContent = parts.join(new_string);
        } else {
          newContent = content.slice(0, match.startIndex) +
                       new_string +
                       content.slice(match.endIndex);
          replacements = 1;
        }

        // Generar diff
        const diff = generateDiffString(content, newContent, file_path);
        const changes = countDiffChanges(diff);

        // Escribir archivo
        await writeFile(resolvedPath, newContent, "utf8");

        // Notify preview window for auto-refresh
        notifyFileChanged(resolvedPath);

        return {
          success: true,
          replacements,
          linesAdded: changes.added,
          linesRemoved: changes.removed,
          diff,
          message: `Successfully edited ${file_path}: ${replacements} replacement(s), +${changes.added}/-${changes.removed} lines`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.includes("ENOENT")) {
          return {
            success: false,
            error: `File not found: ${file_path}. Use the write tool to create new files.`,
          };
        }

        return {
          success: false,
          error: `Failed to edit file: ${message}`,
        };
      }
    },
  });
}
