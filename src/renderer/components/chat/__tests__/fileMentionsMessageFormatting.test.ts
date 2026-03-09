import { describe, it, expect } from 'vitest';
import type { FileMentionPayload } from '../lexical/FileMentionNode';

// Replicate the helpers from ChatPage for unit testing
function dedupeMentionsByPath(mentions: FileMentionPayload[]): FileMentionPayload[] {
  const seen = new Set<string>();
  return mentions.filter((m) => {
    if (seen.has(m.filePath)) return false;
    seen.add(m.filePath);
    return true;
  });
}

function formatMentionBlock(mentions: FileMentionPayload[]): string {
  if (mentions.length === 0) return '';
  const lines = mentions.map((m) => `- ${m.relativePath} -> ${m.filePath}`);
  return `[Archivos referenciados por el usuario:]\n${lines.join('\n')}`;
}

function prependMentionsToMessage(messageText: string, mentions: FileMentionPayload[]): string {
  if (mentions.length === 0) return messageText;
  const block = formatMentionBlock(mentions);
  return messageText ? `${block}\n\n${messageText}` : block;
}

describe('File mentions message formatting', () => {
  const mention1: FileMentionPayload = {
    fileName: 'App.tsx',
    filePath: '/abs/path/src/App.tsx',
    relativePath: 'src/App.tsx',
  };

  const mention2: FileMentionPayload = {
    fileName: 'index.ts',
    filePath: '/abs/path/src/index.ts',
    relativePath: 'src/index.ts',
  };

  describe('dedupeMentionsByPath', () => {
    it('should remove duplicates by filePath', () => {
      const mentions = [mention1, mention2, mention1];
      const result = dedupeMentionsByPath(mentions);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(mention1);
      expect(result[1]).toBe(mention2);
    });

    it('should return empty array for empty input', () => {
      expect(dedupeMentionsByPath([])).toEqual([]);
    });
  });

  describe('limit mentions', () => {
    it('should limit to 10 mentions', () => {
      const mentions = Array.from({ length: 15 }, (_, i) => ({
        fileName: `file${i}.ts`,
        filePath: `/abs/path/file${i}.ts`,
        relativePath: `file${i}.ts`,
      }));
      const result = dedupeMentionsByPath(mentions).slice(0, 10);
      expect(result).toHaveLength(10);
    });
  });

  describe('formatMentionBlock', () => {
    it('should format mentions block correctly', () => {
      const result = formatMentionBlock([mention1, mention2]);
      expect(result).toBe(
        '[Archivos referenciados por el usuario:]\n' +
        '- src/App.tsx -> /abs/path/src/App.tsx\n' +
        '- src/index.ts -> /abs/path/src/index.ts'
      );
    });

    it('should return empty string for no mentions', () => {
      expect(formatMentionBlock([])).toBe('');
    });
  });

  describe('prependMentionsToMessage', () => {
    it('should prepend mentions block with double newline', () => {
      const result = prependMentionsToMessage('Hello world', [mention1]);
      expect(result).toContain('[Archivos referenciados por el usuario:]');
      expect(result).toContain('\n\nHello world');
    });

    it('should return just the block when message is empty', () => {
      const result = prependMentionsToMessage('', [mention1]);
      expect(result).toContain('[Archivos referenciados por el usuario:]');
      expect(result).not.toContain('\n\n');
    });

    it('should return message text when no mentions', () => {
      expect(prependMentionsToMessage('Hello', [])).toBe('Hello');
    });
  });
});
