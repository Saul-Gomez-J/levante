/**
 * Herramienta Grep: buscar contenido en archivos.
 * Adaptada de pi-mono para Vercel AI SDK.
 * Usa ripgrep (rg) si está disponible, fallback a grep nativo.
 */

import { tool } from "ai";
import { z } from "zod";
import { executeCommand } from "../utils/shell";
import { truncateHead } from "../utils/truncate";
import { resolveToCwd } from "../utils/path-utils";

export interface GrepToolConfig {
  cwd: string;
  maxResults?: number;
}

export function createGrepTool(config: GrepToolConfig) {
  const maxResults = config.maxResults ?? 100;

  return tool({
    description: `Search for patterns in files using regex.
Uses ripgrep (rg) for fast searching with full regex support.
Returns matching file paths by default, or content with context.`,

    inputSchema: z.object({
      pattern: z.string().describe("Regular expression pattern to search for"),
      path: z.string().optional()
        .describe("Directory or file to search in (default: current directory)"),
      glob: z.string().optional()
        .describe("Glob pattern to filter files (e.g., '*.ts', '*.{js,jsx}')"),
      output_mode: z.enum(["files_with_matches", "content", "count"]).optional()
        .default("files_with_matches")
        .describe("Output mode: files_with_matches, content (with lines), or count"),
      case_insensitive: z.boolean().optional().default(false)
        .describe("Case insensitive search (-i flag)"),
      context_lines: z.number().optional()
        .describe("Lines of context before and after match (-C flag)"),
    }),

    execute: async ({
      pattern,
      path,
      glob,
      output_mode,
      case_insensitive,
      context_lines
    }: {
      pattern: string;
      path?: string;
      glob?: string;
      output_mode?: "files_with_matches" | "content" | "count";
      case_insensitive?: boolean;
      context_lines?: number;
    }) => {
      try {
        const searchPath = path ? resolveToCwd(path, config.cwd) : config.cwd;

        // Construir comando rg
        const args: string[] = ["rg"];

        // Modo de output
        if (output_mode === "files_with_matches") {
          args.push("-l"); // solo nombres de archivo
        } else if (output_mode === "count") {
          args.push("-c"); // contar matches
        } else {
          args.push("-n"); // mostrar números de línea
          if (context_lines) {
            args.push(`-C${context_lines}`);
          }
        }

        // Opciones
        if (case_insensitive) {
          args.push("-i");
        }

        // Glob filter
        if (glob) {
          args.push(`--glob=${glob}`);
        }

        // Limitar resultados
        args.push(`-m${maxResults}`);

        // Pattern y path
        args.push("--", pattern, searchPath);

        const command = args.join(" ");

        const result = await executeCommand(command, {
          cwd: config.cwd,
          timeout: 30000, // 30 segundos para búsqueda
        });

        // rg retorna exit code 1 si no hay matches (no es error)
        if (result.exitCode > 1) {
          return {
            success: false,
            error: result.stderr || `Search failed with exit code ${result.exitCode}`,
          };
        }

        const output = result.stdout.trim();

        if (!output) {
          return {
            success: true,
            matches: 0,
            message: "No matches found",
            results: [],
          };
        }

        // Parsear resultados según modo
        const lines = output.split("\n").filter(Boolean);

        if (output_mode === "count") {
          // Formato: file:count
          const counts = lines.map(line => {
            const [file, count] = line.split(":");
            return { file, count: parseInt(count, 10) };
          });
          const total = counts.reduce((sum, c) => sum + c.count, 0);

          return {
            success: true,
            matches: total,
            filesWithMatches: counts.length,
            results: counts,
          };
        }

        // Truncar si es necesario
        const truncated = truncateHead(output, { maxLines: 500 });

        return {
          success: true,
          matches: lines.length,
          truncated: truncated.wasTruncated,
          results: truncated.content,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // Si rg no está instalado, sugerir instalación
        if (message.includes("not found") || message.includes("ENOENT")) {
          return {
            success: false,
            error: "ripgrep (rg) not found. Install with: brew install ripgrep (macOS) or apt install ripgrep (Linux)",
          };
        }

        return {
          success: false,
          error: `Search failed: ${message}`,
        };
      }
    },
  });
}
