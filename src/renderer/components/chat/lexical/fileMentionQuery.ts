/**
 * Check if char before offset is a trigger boundary (start of line, space, newline)
 */
export function isTriggerBoundary(text: string, offset: number): boolean {
  if (offset <= 0) return true; // start of text
  const charBefore = text[offset - 1];
  return charBefore === ' ' || charBefore === '\n' || charBefore === '\t';
}

/**
 * Resolve mention query from text up to caret.
 * Returns null if trigger is invalid (no boundary, whitespace in query, etc).
 */
export function resolveMentionQuery(textBeforeCaret: string): string | null {
  const atIndex = textBeforeCaret.lastIndexOf('@');
  if (atIndex === -1) return null;
  if (!isTriggerBoundary(textBeforeCaret, atIndex)) return null;

  const query = textBeforeCaret.substring(atIndex + 1);
  if (/[\s]/.test(query)) return null;

  return query;
}
