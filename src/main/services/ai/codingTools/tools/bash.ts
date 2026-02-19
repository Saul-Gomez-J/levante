/**
 * Herramienta Bash: ejecutar comandos en shell.
 * Adaptada de pi-mono para Vercel AI SDK.
 */

import { tool } from "ai";
import { z } from "zod";
import { executeCommand } from "../utils/shell";
import { truncateTail, formatSize } from "../utils/truncate";

export interface BashToolConfig {
  cwd: string;
  timeout?: number; // ms, default 120000 (2 min)
  maxOutputLines?: number;
  maxOutputBytes?: number;
}

export function createBashTool(config: BashToolConfig) {
  const timeout = config.timeout ?? 120000;
  const maxLines = config.maxOutputLines ?? 2000;
  const maxBytes = config.maxOutputBytes ?? 50 * 1024;

  return tool({
    description: `Execute a bash command in the shell.
Commands run in a bash shell with a ${Math.round(timeout / 1000)}s timeout.
IMPORTANT:
- Do NOT use for file operations (use read, write, edit tools instead)
- Use for: git commands, npm/yarn, build tools, system commands
- Output is truncated to ${maxLines} lines / ${formatSize(maxBytes)}
- Commands run in: ${config.cwd}`,

    inputSchema: z.object({
      command: z.string().describe("The bash command to execute"),
      description: z.string().optional()
        .describe("Brief description of what this command does (for logging)"),
      timeout: z.number().optional()
        .describe(`Timeout in ms (max ${timeout})`),
    }),

    execute: async ({ command, description, timeout: cmdTimeout }: { command: string; description?: string; timeout?: number }) => {
      const effectiveTimeout = Math.min(cmdTimeout ?? timeout, timeout);

      try {
        const result = await executeCommand(command, {
          cwd: config.cwd,
          timeout: effectiveTimeout,
        });

        // Combinar stdout y stderr
        let output = "";
        if (result.stdout) {
          output += result.stdout;
        }
        if (result.stderr) {
          if (output) output += "\n";
          output += result.stderr;
        }

        // Truncar output
        const truncated = truncateTail(output || "(no output)", { maxLines, maxBytes });

        // Construir resultado
        const status = result.timedOut
          ? "timed_out"
          : result.interrupted
            ? "interrupted"
            : result.exitCode === 0
              ? "success"
              : "error";

        return {
          status,
          exitCode: result.exitCode,
          output: truncated.content,
          truncated: truncated.wasTruncated,
          ...(result.timedOut && {
            warning: `Command timed out after ${effectiveTimeout}ms`
          }),
          ...(result.interrupted && {
            warning: "Command was interrupted"
          }),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          status: "error",
          exitCode: 1,
          output: `Failed to execute command: ${message}`,
          error: message,
        };
      }
    },
  });
}
