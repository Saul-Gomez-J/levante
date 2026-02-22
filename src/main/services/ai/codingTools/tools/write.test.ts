import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createWriteTool } from './write';

describe('createWriteTool', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'write-tool-test-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('genera diff para archivo nuevo', async () => {
    const tool = createWriteTool({ cwd }) as any;
    const result = await tool.execute({
      file_path: 'a.txt',
      content: 'linea1\nlinea2\n',
    });

    expect(result.success).toBe(true);
    expect(result.linesAdded).toBeGreaterThan(0);
    expect(result.linesRemoved).toBe(0);
    expect(result.diff).toContain('@@');

    const finalContent = await readFile(join(cwd, 'a.txt'), 'utf8');
    expect(finalContent).toBe('linea1\nlinea2\n');
  });

  it('genera diff para archivo existente con cambios', async () => {
    await writeFile(join(cwd, 'b.txt'), 'uno\ndos\n', 'utf8');

    const tool = createWriteTool({ cwd }) as any;
    const result = await tool.execute({
      file_path: 'b.txt',
      content: 'uno\ntres\n',
    });

    expect(result.success).toBe(true);
    expect((result.linesAdded ?? 0) + (result.linesRemoved ?? 0)).toBeGreaterThan(0);
    expect(result.diff).toContain('@@');
  });

  it('reporta cero cambios cuando el contenido es idéntico', async () => {
    await writeFile(join(cwd, 'same.txt'), 'igual\n', 'utf8');

    const tool = createWriteTool({ cwd }) as any;
    const result = await tool.execute({
      file_path: 'same.txt',
      content: 'igual\n',
    });

    expect(result.success).toBe(true);
    expect(result.linesAdded).toBe(0);
    expect(result.linesRemoved).toBe(0);
  });

  it('no silencia errores de lectura distintos de ENOENT', async () => {
    await mkdir(join(cwd, 'dir-as-file'), { recursive: true });

    const tool = createWriteTool({ cwd }) as any;
    const result = await tool.execute({
      file_path: 'dir-as-file',
      content: 'contenido',
    });

    expect(result.success).toBe(false);
    expect(String(result.error || '')).toContain('Failed to write file');
  });
});
