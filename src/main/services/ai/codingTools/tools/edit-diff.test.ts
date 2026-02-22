import { describe, expect, it } from 'vitest';
import { countDiffChanges, generateDiffString } from './edit-diff';

describe('edit-diff utilities', () => {
  it('countDiffChanges devuelve 0/0 cuando no hay cambios reales', () => {
    const diff = generateDiffString('hola\n', 'hola\n', 'a.txt');
    const counts = countDiffChanges(diff);

    expect(diff.length).toBeGreaterThan(0);
    expect(counts.added).toBe(0);
    expect(counts.removed).toBe(0);
  });

  it('countDiffChanges cuenta líneas añadidas y eliminadas', () => {
    const diff = generateDiffString('a\nb\n', 'a\nc\n', 'a.txt');
    const counts = countDiffChanges(diff);

    expect(counts.added).toBeGreaterThan(0);
    expect(counts.removed).toBeGreaterThan(0);
  });
});
