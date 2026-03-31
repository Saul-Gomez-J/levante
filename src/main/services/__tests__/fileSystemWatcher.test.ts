import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileSystemService } from '../filesystem/fileSystemService';

describe('FileSystemService watcher', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = realpathSync(await fs.mkdtemp(path.join(os.tmpdir(), 'levante-fsw-')));

    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.gitignore'), 'ignored.txt\n');
    await fs.writeFile(path.join(tmpDir, 'visible.txt'), 'hello');

    fileSystemService.setWorkingDirectory(tmpDir);
  });

  afterEach(async () => {
    await fileSystemService.dispose();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('emits the affected parent directory for nested file additions', async () => {
    let watchStarted!: Promise<void>;

    const eventPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('watch event timeout')), 8000);

      watchStarted = fileSystemService.startWatching((changes) => {
        const match = changes.find(
          (change) =>
            change.path === path.join(tmpDir, 'src', 'new-file.ts') &&
            change.parentPath === path.join(tmpDir, 'src') &&
            change.kind === 'file-added'
        );

        if (match) {
          clearTimeout(timeout);
          resolve(match);
        }
      });
    });

    await watchStarted;
    // Give chokidar time to fully initialize before writing the file
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await fs.writeFile(path.join(tmpDir, 'src', 'new-file.ts'), 'export {};');

    await expect(eventPromise).resolves.toBeTruthy();
  }, 10000);

  it('clears ignore and search caches when .gitignore changes', async () => {
    await fileSystemService.searchFiles('ignored');
    await fileSystemService.startWatching(() => {});

    await fs.writeFile(path.join(tmpDir, 'ignored.txt'), 'content');
    await fs.writeFile(path.join(tmpDir, '.gitignore'), '');

    await new Promise((resolve) => setTimeout(resolve, 800));

    const results = await fileSystemService.searchFiles('ignored');
    expect(results.some((result) => result.name === 'ignored.txt')).toBe(true);
  });
});
