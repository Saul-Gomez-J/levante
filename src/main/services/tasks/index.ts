/**
 * Background Tasks Service
 *
 * Exports for background task management functionality.
 */

export { taskManager } from './BackgroundTaskManager';
export { TaskStatus } from './types';
export type {
  TaskInfo,
  TaskInfoDTO,
  SpawnTaskOptions,
  GetOutputOptions,
  WaitTaskOptions,
  TaskStats,
  TaskStream,
  TaskEvents,
  TaskEntry,
  TaskOutputLine,
} from './types';
