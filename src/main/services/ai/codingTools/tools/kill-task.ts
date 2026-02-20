/**
 * Tool: killTask
 *
 * Stop a running background task by taskId.
 */

import { tool } from "ai";
import { z } from "zod";
import { taskManager, TaskStatus } from "../../../tasks";

export interface KillTaskToolConfig {
  cwd: string;
}

export function createKillTaskTool(config: KillTaskToolConfig) {
  return tool({
    description: `Kill a running background task.
Use this when a dev server/watch/build is no longer needed.
Current cowork directory: ${config.cwd}`,

    inputSchema: z.object({
      taskId: z.string().min(1).describe("Task ID to kill"),
    }),

    execute: async ({ taskId }: { taskId: string }) => {
      const task = taskManager.getStatus(taskId);

      if (!task) {
        return {
          success: false,
          error: `Task not found: ${taskId}`,
        };
      }

      if (task.status !== TaskStatus.RUNNING) {
        return {
          success: false,
          error: `Task is not running (status: ${task.status})`,
          exitCode: task.exitCode,
        };
      }

      const killed = taskManager.kill(taskId);

      if (!killed) {
        return {
          success: false,
          error: `Failed to kill task: ${taskId}`,
        };
      }

      const updated = taskManager.getStatus(taskId);
      const output = taskManager.getOutput(taskId, { tail: 100 }) ?? "";

      return {
        success: true,
        taskId,
        status: updated?.status ?? TaskStatus.KILLED,
        exitCode: updated?.exitCode ?? null,
        output,
        message: `Task ${taskId} killed successfully`,
      };
    },
  });
}
