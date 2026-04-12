import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────
const { mockPurgeIfCompleted } = vi.hoisted(() => ({
  mockPurgeIfCompleted: vi.fn(),
}));

const { mockNotifyTodosUpdated } = vi.hoisted(() => ({
  mockNotifyTodosUpdated: vi.fn(),
}));

// ── Module mocks ─────────────────────────────────────────────────────────
vi.mock('../logging', () => {
  const makeCategoryLogger = () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });
  return {
    getLogger: () => ({
      database: makeCategoryLogger(),
      core: makeCategoryLogger(),
    }),
  };
});

vi.mock('../todoService', () => ({
  todoService: {
    purgeIfCompleted: mockPurgeIfCompleted,
  },
}));

vi.mock('../todoEvents', () => ({
  notifyTodosUpdated: mockNotifyTodosUpdated,
}));

// ── Import after mocks ──────────────────────────────────────────────────
import { todoPurgeScheduler } from '../todoPurgeScheduler';

describe('TodoPurgeScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockPurgeIfCompleted.mockResolvedValue(true);
  });

  afterEach(() => {
    todoPurgeScheduler.cancelAll();
    vi.useRealTimers();
  });

  it('purges a completed todo after the delay', async () => {
    todoPurgeScheduler.schedulePurge('todo-1', 'session-1');

    await vi.advanceTimersByTimeAsync(2000);

    expect(mockPurgeIfCompleted).toHaveBeenCalledOnce();
    expect(mockPurgeIfCompleted).toHaveBeenCalledWith('todo-1', 'session-1');
    expect(mockNotifyTodosUpdated).toHaveBeenCalledOnce();
    expect(mockNotifyTodosUpdated).toHaveBeenCalledWith('session-1');
  });

  it('does not purge if cancelled before the delay', async () => {
    todoPurgeScheduler.schedulePurge('todo-1', 'session-1');
    todoPurgeScheduler.cancelPurge('todo-1');

    await vi.advanceTimersByTimeAsync(2000);

    expect(mockPurgeIfCompleted).not.toHaveBeenCalled();
    expect(mockNotifyTodosUpdated).not.toHaveBeenCalled();
  });

  it('cancels all pending timers on cancelAll', async () => {
    todoPurgeScheduler.schedulePurge('todo-1', 'session-1');
    todoPurgeScheduler.schedulePurge('todo-2', 'session-1');

    todoPurgeScheduler.cancelAll();

    await vi.advanceTimersByTimeAsync(2000);

    expect(mockPurgeIfCompleted).not.toHaveBeenCalled();
    expect(mockNotifyTodosUpdated).not.toHaveBeenCalled();
  });

  it('does not notify if purgeIfCompleted returns false', async () => {
    mockPurgeIfCompleted.mockResolvedValue(false);

    todoPurgeScheduler.schedulePurge('todo-1', 'session-1');

    await vi.advanceTimersByTimeAsync(2000);

    expect(mockPurgeIfCompleted).toHaveBeenCalledOnce();
    expect(mockNotifyTodosUpdated).not.toHaveBeenCalled();
  });

  it('re-schedule for the same todoId overwrites the previous timer', async () => {
    todoPurgeScheduler.schedulePurge('todo-1', 'session-1');
    todoPurgeScheduler.schedulePurge('todo-1', 'session-1');

    await vi.advanceTimersByTimeAsync(2000);

    expect(mockPurgeIfCompleted).toHaveBeenCalledOnce();
  });
});
