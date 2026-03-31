import { describe, expect, it } from 'vitest';
import {
  findNearestLoadedAncestor,
  pruneEntriesSubtree,
  type DirectoryEntry,
} from '../fileBrowserStore';

function emptyEntriesMap(): Map<string, DirectoryEntry[]> {
  return new Map<string, DirectoryEntry[]>([
    ['/root', []],
    ['/root/src', []],
    ['/root/src/components', []],
    ['/root/docs', []],
  ]);
}

describe('fileBrowserStore helpers', () => {
  it('finds the nearest loaded ancestor', () => {
    const loadedDirs = new Set(['/root', '/root/src', '/root/src/components']);

    expect(
      findNearestLoadedAncestor('/root/src/components/Button.tsx', loadedDirs, '/root')
    ).toBe('/root/src/components');

    expect(
      findNearestLoadedAncestor('/root/src/new/Button.tsx', loadedDirs, '/root')
    ).toBe('/root/src');

    expect(
      findNearestLoadedAncestor('/root/unknown/file.txt', new Set(['/root']), '/root')
    ).toBe('/root');
  });

  it('removes the full cached subtree for a deleted directory', () => {
    const next = pruneEntriesSubtree(emptyEntriesMap(), '/root/src');

    expect(next.has('/root/src')).toBe(false);
    expect(next.has('/root/src/components')).toBe(false);
    expect(next.has('/root/docs')).toBe(true);
  });
});
