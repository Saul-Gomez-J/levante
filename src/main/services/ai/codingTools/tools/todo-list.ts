/**
 * Tool: todo_list
 *
 * List all tasks for the current session.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { todoService } from '../../../todoService';

export interface TodoListToolConfig {
  sessionId: string;
}

export function createTodoListTool(config: TodoListToolConfig) {
  return tool({
    description: `List all tasks/todos for the current work session with status counts.`,

    inputSchema: z.object({}),

    execute: async () => {
      const result = await todoService.list(config.sessionId);

      return {
        success: true,
        ...result,
      };
    },
  });
}
