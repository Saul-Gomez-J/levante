import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { useTodoStore } from '@/stores/todoStore';
import { cn } from '@/lib/utils';

export function TodoPanel() {
  const { t } = useTranslation('chat');
  const { todos, counts, expanded, setExpanded } = useTodoStore();

  if (counts.total === 0) return null;

  return (
    <div className="border-b border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span>{t('todo_panel.title')}</span>
        <span className="ml-auto flex items-center gap-2 text-xs">
          {counts.inProgress > 0 && (
            <span className="flex items-center gap-1 text-blue-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              {counts.inProgress}
            </span>
          )}
          {counts.pending > 0 && (
            <span>{t('todo_panel.pending', { count: counts.pending })}</span>
          )}
          <span className="text-green-600">
            {t('todo_panel.completed_ratio', {
              completed: counts.completed,
              total: counts.total,
            })}
          </span>
        </span>
      </button>

      {expanded && (
        <div className="space-y-1 px-4 pb-3">
          {todos.map((todo) => (
            <div
              key={todo.id}
              className={cn(
                'flex items-center gap-2 py-1 text-sm',
                todo.status === 'completed' && 'text-muted-foreground line-through'
              )}
            >
              {todo.status === 'completed' && (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
              )}
              {todo.status === 'in_progress' && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
              )}
              {todo.status === 'pending' && (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">
                {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.subject}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
