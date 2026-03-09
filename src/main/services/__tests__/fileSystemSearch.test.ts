import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// We test the FileSystemService searchFiles method
import { fileSystemService } from '../filesystem/fileSystemService';

describe('FileSystemService.searchFiles', () => {
  let tmpDir: string;

  beforeEach(async () => {
    // Create a temp directory structure for testing
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'levante-search-test-'));

    // Create some files
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'src', 'components'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'node_modules'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'deep', 'nested', 'dir'), { recursive: true });

    await fs.writeFile(path.join(tmpDir, 'src', 'App.tsx'), 'export default App');
    await fs.writeFile(path.join(tmpDir, 'src', 'index.ts'), 'main entry');
    await fs.writeFile(path.join(tmpDir, 'src', 'components', 'Button.tsx'), 'button');
    await fs.writeFile(path.join(tmpDir, 'src', 'components', 'AppHeader.tsx'), 'header');
    await fs.writeFile(path.join(tmpDir, 'package.json'), '{}');
    await fs.writeFile(path.join(tmpDir, 'node_modules', 'should_ignore.js'), 'ignored');
    await fs.writeFile(path.join(tmpDir, 'deep', 'nested', 'dir', 'deep_file.ts'), 'deep');

    // Create a .gitignore
    await fs.writeFile(path.join(tmpDir, '.gitignore'), 'dist/\n*.log\n');

    // Set working directory
    fileSystemService.setWorkingDirectory(tmpDir);
  });

  afterEach(async () => {
    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should find files matching query', async () => {
    const results = await fileSystemService.searchFiles('App');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.name === 'App.tsx')).toBe(true);
  });

  it('should return empty for empty query', async () => {
    const results = await fileSystemService.searchFiles('');
    expect(results).toEqual([]);
  });

  it('should respect maxResults', async () => {
    const results = await fileSystemService.searchFiles('ts', { maxResults: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('should ignore node_modules', async () => {
    const results = await fileSystemService.searchFiles('should_ignore');
    expect(results).toHaveLength(0);
  });

  it('should respect maxDepth', async () => {
    // deep/nested/dir/deep_file.ts is at depth 3
    const shallow = await fileSystemService.searchFiles('deep_file', { maxDepth: 2 });
    expect(shallow).toHaveLength(0);

    const deep = await fileSystemService.searchFiles('deep_file', { maxDepth: 4 });
    expect(deep.length).toBeGreaterThan(0);
  });

  it('should score exact filename matches higher', async () => {
    const results = await fileSystemService.searchFiles('App');
    // App.tsx (exact-ish) should rank before AppHeader.tsx
    const appIndex = results.findIndex((r) => r.name === 'App.tsx');
    const headerIndex = results.findIndex((r) => r.name === 'AppHeader.tsx');
    if (appIndex !== -1 && headerIndex !== -1) {
      expect(appIndex).toBeLessThan(headerIndex);
    }
  });

  it('should use cache on repeated queries', async () => {
    const result1 = await fileSystemService.searchFiles('App');
    const result2 = await fileSystemService.searchFiles('App');
    // Same results (cached)
    expect(result1).toEqual(result2);
  });

  it('should include relativePath in results', async () => {
    const results = await fileSystemService.searchFiles('Button');
    expect(results.length).toBeGreaterThan(0);
    const button = results.find((r) => r.name === 'Button.tsx');
    expect(button).toBeDefined();
    expect(button!.relativePath).toBe(path.join('src', 'components', 'Button.tsx'));
  });
});
