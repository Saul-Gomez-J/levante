import { getLogger } from '../services/logging';
import { notifyPreviewFileChanged } from './window';

const logger = getLogger();

/**
 * Notifies preview window about file changes from coding tools (write/edit)
 * This provides immediate refresh without waiting for file watcher debounce
 */
export function notifyFileChanged(filePath: string): void {
  logger.core.debug('Coding tool file change notification', { filePath });
  notifyPreviewFileChanged(filePath);
}
