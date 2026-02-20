/**
 * Tool: listTasks
 *
 * List background tasks and summary stats.
 */

import { tool } from "ai";
import { z } from "zod";
import { taskManager, TaskStatus } from "../../../tasks";

type ListStatus = "running" | "completed" | "failed" | "killed" | "all";

export interface ListTasksToolConfig {
  cwd: string;
}

export function createListTasksTool(config: ListTasksToolConfig) {
  return tool({
    description: `List background tasks with status, pid and timing info.
Use this to inspect active and completed background jobs.
Current cowork directory: ${config.cwd}`,

    inputSchema: z.object({
      status: z
        .enum(["running", "completed", "failed", "killed", "all"])
        .optional()
        .describe("Optional status filter. Default: all"),
    }),

    execute: async ({ status }: { status?: ListStatus }) => {
      const filter =
        status && status !== "all"
          ? { status: status as TaskStatus }
          : undefined;

      const tasks = taskManager.list(filter);
      const stats = taskManager.getStatistics();

      return {
        success: true,
        tasks: tasks.map((task) => ({
          taskId: task.id,
          command:
            task.command.length > 160
              ? `${task.command.slice(0, 160)}...`
              : task.command,
          status: task.status,
          pid: task.pid,
          exitCode: task.exitCode,
          startedAt: task.startedAt.toISOString(),
          completedAt: task.completedAt?.toISOString() ?? null,
        })),
        stats: {
          total: stats.total,
          running: stats.running,
          completed: stats.completed,
          failed: stats.failed,
          killed: stats.killed,
        },
      };
    },
  });
}
