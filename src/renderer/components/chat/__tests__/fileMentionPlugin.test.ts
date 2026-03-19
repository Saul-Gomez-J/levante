import { describe, expect, it } from 'vitest';
import {
  isTriggerBoundary,
  resolveMentionQuery,
} from '../lexical/fileMentionQuery';

describe('FileMentionPlugin query parsing', () => {
  describe('isTriggerBoundary', () => {
    it('accepts start of text', () => {
      expect(isTriggerBoundary('@', 0)).toBe(true);
    });

    it('accepts whitespace boundaries', () => {
      expect(isTriggerBoundary(' @file', 1)).toBe(true);
      expect(isTriggerBoundary('\n@file', 1)).toBe(true);
      expect(isTriggerBoundary('\t@file', 1)).toBe(true);
    });

    it('rejects non-boundary characters', () => {
      expect(isTriggerBoundary('a@file', 1)).toBe(false);
      expect(isTriggerBoundary('/@file', 1)).toBe(false);
    });
  });

  describe('resolveMentionQuery', () => {
    it('extracts query after a valid trigger', () => {
      expect(resolveMentionQuery('@README')).toBe('README');
      expect(resolveMentionQuery('review @src/App.tsx')).toBe('src/App.tsx');
    });

    it('uses the latest trigger before the caret', () => {
      expect(resolveMentionQuery('@first @second')).toBe('second');
    });

    it('rejects trigger without valid boundary', () => {
      expect(resolveMentionQuery('email@domain')).toBeNull();
      expect(resolveMentionQuery('path/@file')).toBeNull();
    });

    it('rejects queries containing whitespace', () => {
      expect(resolveMentionQuery('@file name')).toBeNull();
      expect(resolveMentionQuery('@file\tname')).toBeNull();
    });

    it('returns empty query when only @ is present', () => {
      expect(resolveMentionQuery('@')).toBe('');
    });
  });
});
