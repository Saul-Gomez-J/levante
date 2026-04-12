/**
 * Tool: todo_get
 *
 * Get full details of a specific task in the current session.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { todoService } from '../../../todoService';

export interface TodoGetToolConfig {
  sessionId: string;
}

export function createTodoGetTool(config: TodoGetToolConfig) {
  return tool({
    description: `Get full details of a specific task/todo by its ID. Only returns tasks belonging to the current session.`,

    inputSchema: z.object({
      todoId: z.string().describe('The ID of the task to retrieve'),
    }),

    execute: async ({ todoId }: { todoId: string }) => {
      const todo = await todoService.getBySession(todoId, config.sessionId);

      if (!todo) {
        return {
          success: false,
          error: `Task ${todoId} not found in current session`,
        };
      }

      return {
        success: true,
        todo,
      };
    },
  });
}
