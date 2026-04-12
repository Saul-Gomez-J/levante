import { InValue } from '@libsql/client';
import { databaseService } from './databaseService';
import { getLogger } from './logging';
import type {
  AgentTodo,
  AgentTodoStatus,
  CreateTodoInput,
  UpdateTodoInput,
  TodoListResult,
} from '../../types/todos';

const logger = getLogger();

class TodoService {
  async create(input: CreateTodoInput): Promise<AgentTodo> {
    const now = Date.now();
    const id = crypto.randomUUID();

    const maxResult = await databaseService.execute(
      'SELECT COALESCE(MAX(sort_order), 0) FROM agent_todos WHERE session_id = ?',
      [input.sessionId]
    );
    const maxOrder = Number(maxResult.rows[0]?.[0] ?? 0);
    const sortOrder = maxOrder + 1;

    await databaseService.execute(
      `INSERT INTO agent_todos (
        id, session_id, subject, description, active_form, status,
        sort_order, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [
        id,
        input.sessionId,
        input.subject,
        input.description,
        input.activeForm ?? null,
        sortOrder,
        input.metadata ? JSON.stringify(input.metadata) : null,
        now,
        now,
      ]
    );

    logger.database.debug('Todo created', { id, sessionId: input.sessionId });
    return {
      id,
      sessionId: input.sessionId,
      subject: input.subject,
      description: input.description,
      activeForm: input.activeForm,
      status: 'pending',
      sortOrder,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getBySession(todoId: string, sessionId: string): Promise<AgentTodo | null> {
    const result = await databaseService.execute(
      'SELECT * FROM agent_todos WHERE id = ? AND session_id = ?',
      [todoId, sessionId]
    );
    if (result.rows.length === 0) return null;
    return this.rowToTodo(result.rows[0] as Record<string, unknown>);
  }

  async list(sessionId: string): Promise<TodoListResult> {
    const result = await databaseService.execute(
      `SELECT * FROM agent_todos
       WHERE session_id = ?
       ORDER BY sort_order ASC, created_at ASC, id ASC`,
      [sessionId]
    );

    const todos = result.rows.map((row) => {
      const todo = this.rowToTodo(row as Record<string, unknown>);
      return {
        id: todo.id,
        subject: todo.subject,
        activeForm: todo.activeForm,
        status: todo.status,
        sortOrder: todo.sortOrder,
      };
    });

    return {
      todos,
      counts: {
        pending: todos.filter((t) => t.status === 'pending').length,
        inProgress: todos.filter((t) => t.status === 'in_progress').length,
        completed: todos.filter((t) => t.status === 'completed').length,
        total: todos.length,
      },
    };
  }

  async updateBySession(
    todoId: string,
    sessionId: string,
    input: UpdateTodoInput
  ): Promise<AgentTodo | null> {
    const existing = await this.getBySession(todoId, sessionId);
    if (!existing) return null;

    if (input.status === 'deleted') {
      await databaseService.execute(
        'DELETE FROM agent_todos WHERE id = ? AND session_id = ?',
        [todoId, sessionId]
      );
      return null;
    }

    const now = Date.now();
    const updates: string[] = [];
    const values: InValue[] = [];

    if (input.subject !== undefined) {
      updates.push('subject = ?');
      values.push(input.subject);
    }
    if (input.description !== undefined) {
      updates.push('description = ?');
      values.push(input.description);
    }
    if (input.activeForm !== undefined) {
      updates.push('active_form = ?');
      values.push(input.activeForm);
    }
    if (input.status !== undefined) {
      updates.push('status = ?');
      values.push(input.status);
      updates.push('completed_at = ?');
      values.push(input.status === 'completed' ? now : null);
    }
    if (input.metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(input.metadata));
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push('updated_at = ?');
    values.push(now);
    values.push(todoId, sessionId);

    await databaseService.execute(
      `UPDATE agent_todos SET ${updates.join(', ')}
       WHERE id = ? AND session_id = ?`,
      values
    );

    return this.getBySession(todoId, sessionId);
  }

  async purgeIfCompleted(todoId: string, sessionId: string): Promise<boolean> {
    const result = await databaseService.execute(
      'DELETE FROM agent_todos WHERE id = ? AND session_id = ? AND status = ?',
      [todoId, sessionId, 'completed']
    );
    return Number(result.rowsAffected ?? 0) > 0;
  }

  async deleteBySession(sessionId: string): Promise<number> {
    const result = await databaseService.execute(
      'DELETE FROM agent_todos WHERE session_id = ?',
      [sessionId]
    );
    return Number(result.rowsAffected ?? 0);
  }

  private rowToTodo(row: Record<string, unknown>): AgentTodo {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      subject: row.subject as string,
      description: (row.description as string) ?? '',
      activeForm: (row.active_form as string | null) ?? undefined,
      status: row.status as AgentTodoStatus,
      sortOrder: Number(row.sort_order),
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      completedAt: row.completed_at ? Number(row.completed_at) : undefined,
    };
  }
}

export const todoService = new TodoService();
