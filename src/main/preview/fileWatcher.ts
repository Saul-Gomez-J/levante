import chokidar, { FSWatcher } from 'chokidar';
import { getLogger } from '../services/logging';
import { preferencesService } from '../services/preferencesService';
import { notifyPreviewFileChanged } from './window';

const logger = getLogger();

let watcher: FSWatcher | null = null;
let currentCwd: string | null = null;
let unwatchPreference: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const DEBOUNCE_MS = 300;

// Directories to ignore
const IGNORED_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  '__pycache__',
  '.turbo',
  '.vite',
];

// File extensions to watch
const WATCHED_EXTENSIONS = [
  'html',
  'css',
  'scss',
  'sass',
  'less',
  'js',
  'jsx',
  'ts',
  'tsx',
  'json',
  'vue',
  'svelte',
  'astro',
  'md',
  'mdx',
];

/**
 * Initializes the file watcher based on coworkModeCwd preference
 */
export async function initializeFileWatcher(): Promise<void> {
  const cwd = preferencesService.get<string | null>('coworkModeCwd') ?? null;

  if (cwd) {
    startFileWatcher(cwd);
  }

  // Subscribe to preference changes
  if (!unwatchPreference) {
    unwatchPreference = preferencesService.onPreferenceChanged('coworkModeCwd', (next) => {
      if (!next) {
        stopFileWatcher();
        return;
      }
      if (next !== currentCwd) {
        startFileWatcher(next);
      }
    });
  }

  logger.core.info('Preview file watcher initialized');
}

/**
 * Starts watching a directory for file changes
 */
export function startFileWatcher(cwd: string): void {
  // Stop existing watcher if any
  if (watcher) {
    stopFileWatcher();
  }

  currentCwd = cwd;

  // Build ignore patterns
  const ignoredPattern = IGNORED_DIRS.map(dir => `**/${dir}/**`);

  // Build extension pattern
  const extensionPattern = WATCHED_EXTENSIONS.map(ext => `**/*.${ext}`);

  logger.core.info('Starting preview file watcher', {
    cwd,
    extensions: WATCHED_EXTENSIONS.length,
    ignoredDirs: IGNORED_DIRS.length,
  });

  try {
    watcher = chokidar.watch(extensionPattern, {
      cwd,
      ignored: ignoredPattern,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    watcher.on('change', (filePath: string) => {
      handleFileChange(filePath);
    });

    watcher.on('add', (filePath: string) => {
      handleFileChange(filePath);
    });

    watcher.on('error', (error: unknown) => {
      logger.core.error('File watcher error', {
        error: error instanceof Error ? error.message : String(error),
        cwd,
      });
    });

    watcher.on('ready', () => {
      logger.core.debug('File watcher ready', { cwd });
    });
  } catch (error) {
    logger.core.error('Failed to start file watcher', {
      error: error instanceof Error ? error.message : String(error),
      cwd,
    });
  }
}

/**
 * Handles file change with debouncing
 */
function handleFileChange(filePath: string): void {
  // Clear existing debounce timer
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  // Set new debounce timer
  debounceTimer = setTimeout(() => {
    const fullPath = currentCwd ? `${currentCwd}/${filePath}` : filePath;
    logger.core.debug('File changed', { filePath: fullPath });
    notifyPreviewFileChanged(fullPath);
    debounceTimer = null;
  }, DEBOUNCE_MS);
}

/**
 * Stops the file watcher
 */
export function stopFileWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (watcher) {
    watcher.close();
    watcher = null;
    logger.core.info('File watcher stopped', { cwd: currentCwd });
  }

  currentCwd = null;
}

/**
 * Gets the current file watcher state
 */
export function getFileWatcherState(): { isRunning: boolean; cwd: string | null } {
  return {
    isRunning: watcher !== null,
    cwd: currentCwd,
  };
}
