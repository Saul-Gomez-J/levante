/**
 * Herramienta Ls: listar contenido de directorios.
 * Adaptada de pi-mono para Vercel AI SDK.
 */

import { tool } from "ai";
import { z } from "zod";
import { readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import { resolveToCwd } from "../utils/path-utils";
import { truncateHead, formatSize, DEFAULT_MAX_BYTES } from "../utils/truncate";

export interface LsToolConfig {
  cwd: string;
  defaultLimit?: number;
}

const DEFAULT_LIMIT = 500;

export function createLsTool(config: LsToolConfig) {
  const defaultLimit = config.defaultLimit ?? DEFAULT_LIMIT;

  return tool({
    description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to ${defaultLimit} entries or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first).`,

    inputSchema: z.object({
      path: z.string().optional()
        .describe("Directory to list (default: current directory)"),
      limit: z.number().optional()
        .describe(`Maximum number of entries to return (default: ${defaultLimit})`),
    }),

    execute: async ({ path, limit }: { path?: string; limit?: number }) => {
      try {
        const dirPath = resolveToCwd(path || ".", config.cwd);
        const effectiveLimit = limit ?? defaultLimit;

        // Check if path exists
        if (!existsSync(dirPath)) {
          return {
            success: false,
            error: `Path not found: ${dirPath}`,
          };
        }

        // Check if path is a directory
        const stat = statSync(dirPath);
        if (!stat.isDirectory()) {
          return {
            success: false,
            error: `Not a directory: ${dirPath}. Use read tool for files.`,
          };
        }

        // Read directory entries
        let entries: string[];
        try {
          entries = readdirSync(dirPath);
        } catch (e: any) {
          return {
            success: false,
            error: `Cannot read directory: ${e.message}`,
          };
        }

        // Sort alphabetically (case-insensitive)
        entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

        // Format entries with directory indicators
        const results: string[] = [];
        let entryLimitReached = false;

        for (const entry of entries) {
          if (results.length >= effectiveLimit) {
            entryLimitReached = true;
            break;
          }

          const fullPath = join(dirPath, entry);
          let suffix = "";

          try {
            const entryStat = statSync(fullPath);
            if (entryStat.isDirectory()) {
              suffix = "/";
            }
          } catch {
            // Skip entries we can't stat
            continue;
          }

          results.push(entry + suffix);
        }

        if (results.length === 0) {
          return {
            success: true,
            count: 0,
            message: "(empty directory)",
            entries: [],
          };
        }

        // Apply byte truncation
        const rawOutput = results.join("\n");
        const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });

        // Build notices
        const notices: string[] = [];

        if (entryLimitReached) {
          notices.push(`${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`);
        }

        if (truncation.wasTruncated) {
          notices.push(`${formatSize(DEFAULT_MAX_BYTES)} size limit reached`);
        }

        let output = truncation.content;
        if (notices.length > 0) {
          output += `\n\n[${notices.join(". ")}]`;
        }

        return {
          success: true,
          count: results.length,
          totalEntries: entries.length,
          truncated: entryLimitReached || truncation.wasTruncated,
          entries: output,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `Failed to list directory: ${message}`,
        };
      }
    },
  });
}
