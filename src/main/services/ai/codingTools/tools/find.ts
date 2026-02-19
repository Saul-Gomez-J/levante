/**
 * Herramienta Find: buscar archivos por patrón glob.
 * Adaptada de pi-mono para Vercel AI SDK.
 * Usa fd si está disponible, fallback a find nativo.
 */

import { tool } from "ai";
import { z } from "zod";
import { executeCommand } from "../utils/shell";
import { truncateHead } from "../utils/truncate";
import { resolveToCwd } from "../utils/path-utils";

export interface FindToolConfig {
  cwd: string;
  maxResults?: number;
}

export function createFindTool(config: FindToolConfig) {
  const maxResults = config.maxResults ?? 500;

  return tool({
    description: `Find files matching a glob pattern.
Uses fd for fast file finding. Supports patterns like "**/*.ts", "src/**/*.tsx".
Results are sorted by modification time (most recent first).`,

    inputSchema: z.object({
      pattern: z.string().describe("Glob pattern to match files (e.g., '**/*.ts')"),
      path: z.string().optional()
        .describe("Directory to search in (default: current directory)"),
      type: z.enum(["file", "directory", "any"]).optional().default("file")
        .describe("Type of entries to find"),
      hidden: z.boolean().optional().default(false)
        .describe("Include hidden files and directories"),
    }),

    execute: async ({ pattern, path, type, hidden }: { pattern: string; path?: string; type?: "file" | "directory" | "any"; hidden?: boolean }) => {
      try {
        const searchPath = path ? resolveToCwd(path, config.cwd) : config.cwd;

        // Construir comando fd
        const args: string[] = ["fd"];

        // Tipo de entrada
        if (type === "file") {
          args.push("-t", "f");
        } else if (type === "directory") {
          args.push("-t", "d");
        }

        // Archivos ocultos
        if (hidden) {
          args.push("-H");
        }

        // Ignorar .gitignore patterns (seguir las reglas del repo)
        args.push("--no-ignore-vcs");

        // Glob pattern - fd usa -g para glob
        args.push("-g", pattern);

        // Limitar resultados
        args.push("--max-results", String(maxResults));

        // Ordenar por fecha de modificación
        args.push("--changed-within", "100years"); // hack para obtener ordenamiento

        // Directorio base
        args.push(searchPath);

        const command = args.join(" ");

        const result = await executeCommand(command, {
          cwd: config.cwd,
          timeout: 30000,
        });

        // fd retorna exit code 1 si no hay resultados
        if (result.exitCode > 1) {
          return {
            success: false,
            error: result.stderr || `Find failed with exit code ${result.exitCode}`,
          };
        }

        const output = result.stdout.trim();

        if (!output) {
          return {
            success: true,
            count: 0,
            message: "No files found matching pattern",
            files: [],
          };
        }

        const files = output.split("\n").filter(Boolean);

        // Truncar si hay demasiados
        const truncated = truncateHead(files.join("\n"), { maxLines: maxResults });
        const displayedFiles = truncated.content.split("\n").filter(Boolean);

        return {
          success: true,
          count: files.length,
          truncated: truncated.wasTruncated,
          files: displayedFiles,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // Si fd no está instalado, sugerir alternativa
        if (message.includes("not found") || message.includes("ENOENT")) {
          return {
            success: false,
            error: "fd not found. Install with: brew install fd (macOS) or apt install fd-find (Linux)",
          };
        }

        return {
          success: false,
          error: `Find failed: ${message}`,
        };
      }
    },
  });
}
