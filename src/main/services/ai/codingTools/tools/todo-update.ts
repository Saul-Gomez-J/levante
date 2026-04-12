/**
 * Tool: todo_update
 *
 * Update a task in the current session.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { todoService } from '../../../todoService';
import { notifyTodosUpdated } from '../../../todoEvents';
import { todoPurgeScheduler } from '../../../todoPurgeScheduler';

export interface TodoUpdateToolConfig {
  sessionId: string;
}

export function createTodoUpdateTool(config: TodoUpdateToolConfig) {
  return tool({
    description: `Update a task/todo in the current session. Can change status, subject, description, or delete it.
Set status to 'in_progress' when starting work, 'completed' when done, or 'deleted' to remove.`,

    inputSchema: z.object({
      todoId: z.string().describe('The ID of the task to update'),
      subject: z.string().optional().describe('New subject for the task'),
      description: z.string().optional().describe('New description for the task'),
      activeForm: z.string().optional().describe('Present continuous form shown while in progress'),
      status: z
        .enum(['pending', 'in_progress', 'completed', 'deleted'])
        .optional()
        .describe('New status for the task'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Metadata to merge into the task'),
    }),

    execute: async ({
      todoId,
      subject,
      description,
      activeForm,
      status,
      metadata,
    }: {
      todoId: string;
      subject?: string;
      description?: string;
      activeForm?: string;
      status?: 'pending' | 'in_progress' | 'completed' | 'deleted';
      metadata?: Record<string, unknown>;
    }) => {
      const updated = await todoService.updateBySession(todoId, config.sessionId, {
        subject,
        description,
        activeForm,
        status,
        metadata,
      });

      notifyTodosUpdated(config.sessionId);

      // Schedule or cancel auto-purge
      if (status === 'completed' && updated) {
        todoPurgeScheduler.schedulePurge(todoId, config.sessionId);
      } else if (status) {
        todoPurgeScheduler.cancelPurge(todoId);
      }

      if (status === 'deleted') {
        return {
          success: true,
          deleted: true,
        };
      }

      if (!updated) {
        return {
          success: false,
          error: `Task ${todoId} not found in current session`,
        };
      }

      return {
        success: true,
        todo: {
          id: updated.id,
          subject: updated.subject,
          status: updated.status,
        },
      };
    },
  });
}
