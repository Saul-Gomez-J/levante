/**
 * Tool: todo_create
 *
 * Create a new task for the current session.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { todoService } from '../../../todoService';
import { notifyTodosUpdated } from '../../../todoEvents';

export interface TodoCreateToolConfig {
  sessionId: string;
}

export function createTodoCreateTool(config: TodoCreateToolConfig) {
  return tool({
    description: `Create a new task/todo for the current work session.
Use this to track multi-step work. Keep subjects short and imperative.`,

    inputSchema: z.object({
      subject: z.string().describe('Brief, actionable title in imperative form (e.g., "Fix authentication bug")'),
      description: z.string().describe('Detailed description of what needs to be done'),
      activeForm: z.string().optional().describe('Present continuous form shown while in progress (e.g., "Fixing authentication bug")'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata to attach to the task'),
    }),

    execute: async ({
      subject,
      description,
      activeForm,
      metadata,
    }: {
      subject: string;
      description: string;
      activeForm?: string;
      metadata?: Record<string, unknown>;
    }) => {
      const todo = await todoService.create({
        sessionId: config.sessionId,
        subject,
        description,
        activeForm,
        metadata,
      });

      notifyTodosUpdated(config.sessionId);

      return {
        success: true,
        todo: {
          id: todo.id,
          subject: todo.subject,
          status: todo.status,
        },
      };
    },
  });
}
