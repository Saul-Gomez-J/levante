/**
 * Tool: getTaskOutput
 *
 * Read output from a background task started via bash(run_in_background=true).
 */

import { tool } from "ai";
import { z } from "zod";
import { taskManager } from "../../../tasks";

export interface TaskOutputToolConfig {
  cwd: string;
}

export function createTaskOutputTool(config: TaskOutputToolConfig) {
  return tool({
    description: `Get output from a background task started with bash(run_in_background=true).
Use this to inspect logs from long-running commands.
Current cowork directory: ${config.cwd}`,

    inputSchema: z.object({
      taskId: z.string().min(1).describe("Background task ID"),
      tail: z.number().int().positive().max(5000).optional().describe("Return only the last N lines"),
      includeTimestamps: z.boolean().optional().describe("Include timestamps and stream labels"),
    }),

    execute: async ({
      taskId,
      tail,
      includeTimestamps,
    }: {
      taskId: string;
      tail?: number;
      includeTimestamps?: boolean;
    }) => {
      const task = taskManager.getStatus(taskId);

      if (!task) {
        return {
          success: false,
          error: `Task not found: ${taskId}`,
        };
      }

      const output = taskManager.getOutput(taskId, {
        ...(tail !== undefined ? { tail } : {}),
        ...(includeTimestamps !== undefined ? { includeTimestamps } : {}),
      });

      return {
        success: true,
        taskId,
        status: task.status,
        pid: task.pid,
        exitCode: task.exitCode,
        completedAt: task.completedAt?.toISOString() ?? null,
        output: output ?? "",
      };
    },
  });
}
