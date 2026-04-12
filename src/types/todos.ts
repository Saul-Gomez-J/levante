export type AgentTodoStatus = 'pending' | 'in_progress' | 'completed';

export interface AgentTodo {
  id: string;
  sessionId: string;
  subject: string;
  description: string;
  activeForm?: string;
  status: AgentTodoStatus;
  sortOrder: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface CreateTodoInput {
  sessionId: string;
  subject: string;
  description: string;
  activeForm?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateTodoInput {
  subject?: string;
  description?: string;
  activeForm?: string | null;
  status?: AgentTodoStatus | 'deleted';
  metadata?: Record<string, unknown>;
}

export interface TodoListItem {
  id: string;
  subject: string;
  activeForm?: string;
  status: AgentTodoStatus;
  sortOrder: number;
}

export interface TodoListResult {
  todos: TodoListItem[];
  counts: {
    pending: number;
    inProgress: number;
    completed: number;
    total: number;
  };
}
