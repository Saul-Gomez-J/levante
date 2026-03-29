import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createPresentFilesTool } from './present-files';

describe('createPresentFilesTool', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'present-files-test-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('resolves relative paths and returns metadata', async () => {
    await writeFile(join(cwd, 'demo.skill'), 'content', 'utf8');

    const tool = createPresentFilesTool({ cwd }) as any;
    const result = await tool.execute({
      files: [{ path: 'demo.skill', description: 'Packaged skill' }],
    });

    expect(result.success).toBe(true);
    expect(result.files[0].exists).toBe(true);
    expect(result.files[0].isSkillPackage).toBe(true);
    expect(result.files[0].name).toBe('demo.skill');
    expect(result.files[0].description).toBe('Packaged skill');
    expect(result.files[0].size).toBeGreaterThan(0);
  });

  it('marks .zip files as skill packages', async () => {
    await writeFile(join(cwd, 'my-skill.zip'), 'content', 'utf8');

    const tool = createPresentFilesTool({ cwd }) as any;
    const result = await tool.execute({
      files: [{ path: 'my-skill.zip' }],
    });

    expect(result.success).toBe(true);
    expect(result.files[0].isSkillPackage).toBe(true);
  });

  it('marks missing files as exists false', async () => {
    const tool = createPresentFilesTool({ cwd }) as any;
    const result = await tool.execute({
      files: [{ path: 'missing.pdf' }],
    });

    expect(result.success).toBe(true);
    expect(result.files[0].exists).toBe(false);
  });

  it('marks directories as non-presentable files', async () => {
    await mkdir(join(cwd, 'folder'));

    const tool = createPresentFilesTool({ cwd }) as any;
    const result = await tool.execute({
      files: [{ path: 'folder' }],
    });

    expect(result.files[0].exists).toBe(false);
    expect(result.files[0].error).toContain('not a file');
  });
});
