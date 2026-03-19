import { useEffect } from 'react';
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $createTextNode,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_NORMAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type ElementNode,
  type TextNode,
  type LexicalEditor,
} from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createFileMentionNode,
  $isFileMentionNode,
  type FileMentionPayload,
} from './FileMentionNode';
import { isTriggerBoundary, resolveMentionQuery } from './fileMentionQuery';

export { isTriggerBoundary, resolveMentionQuery } from './fileMentionQuery';

interface FileMentionPluginProps {
  onQueryChange: (query: string | null, anchorRect: DOMRect | null) => void;
  onRequestSelectActive: () => void;
  onRequestMove: (delta: number) => void;
  pickerOpen: boolean;
}

/**
 * Get the anchor rect for the current cursor position
 */
function getCaretRect(editor: LexicalEditor): DOMRect | null {
  const rootElement = editor.getRootElement();
  if (!rootElement) return null;

  const domSelection = window.getSelection();
  if (!domSelection || domSelection.rangeCount === 0) return null;

  const range = domSelection.getRangeAt(0).cloneRange();
  range.collapse(true);

  // Prefer client rects for collapsed caret when available.
  const rects = range.getClientRects();
  if (rects.length > 0) {
    return rects[0];
  }

  const rect = range.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) {
    return rect;
  }

  // Fallback without mutating DOM.
  const container = range.startContainer;
  if (container instanceof Element) {
    return container.getBoundingClientRect();
  }
  if (container.parentElement) {
    return container.parentElement.getBoundingClientRect();
  }

  return null;
}

function getMentionSiblingAtBoundary(
  anchorNode: TextNode | ElementNode,
  anchorOffset: number,
  direction: 'backward' | 'forward'
) {
  if ($isTextNode(anchorNode)) {
    const textLength = anchorNode.getTextContentSize();

    if (direction === 'backward') {
      // Common case after insertion: [mention][single-space-text-node]
      if (
        anchorOffset === 1 &&
        anchorNode.getTextContent() === ' ' &&
        $isFileMentionNode(anchorNode.getPreviousSibling())
      ) {
        return anchorNode.getPreviousSibling();
      }

      if (anchorOffset === 0 && $isFileMentionNode(anchorNode.getPreviousSibling())) {
        return anchorNode.getPreviousSibling();
      }
    } else if (anchorOffset === textLength && $isFileMentionNode(anchorNode.getNextSibling())) {
      return anchorNode.getNextSibling();
    }
  }

  if ($isElementNode(anchorNode)) {
    if (direction === 'backward' && anchorOffset > 0) {
      const prevChild = anchorNode.getChildAtIndex(anchorOffset - 1);
      if ($isFileMentionNode(prevChild)) return prevChild;
    }
    if (direction === 'forward') {
      const nextChild = anchorNode.getChildAtIndex(anchorOffset);
      if ($isFileMentionNode(nextChild)) return nextChild;
    }
  }

  return null;
}

function removeAdjacentMention(direction: 'backward' | 'forward'): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return false;
  }

  const anchorNode = selection.anchor.getNode();
  const anchorOffset = selection.anchor.offset;

  if ($isFileMentionNode(anchorNode)) {
    const prev = anchorNode.getPreviousSibling();
    const next = anchorNode.getNextSibling();
    anchorNode.remove();

    if ($isTextNode(next)) {
      next.select(0, 0);
      return true;
    }
    if ($isTextNode(prev)) {
      const end = prev.getTextContentSize();
      prev.select(end, end);
      return true;
    }
    return true;
  }

  if (!$isTextNode(anchorNode) && !$isElementNode(anchorNode)) {
    return false;
  }

  const mentionNode = getMentionSiblingAtBoundary(anchorNode, anchorOffset, direction);
  if (!mentionNode) return false;

  mentionNode.remove();
  return true;
}

function isEditorComposing(editor: LexicalEditor): boolean {
  const editorAny = editor as unknown as { isComposing?: () => boolean };
  if (typeof editorAny.isComposing === 'function') {
    return editorAny.isComposing();
  }

  const rootElement = editor.getRootElement();
  if (!rootElement) return false;
  return Boolean((rootElement as unknown as { __lexicalIsComposing?: boolean }).__lexicalIsComposing);
}

export function FileMentionPlugin({
  onQueryChange,
  onRequestSelectActive,
  onRequestMove,
  pickerOpen,
}: FileMentionPluginProps) {
  const [editor] = useLexicalComposerContext();

  // Track text changes to detect @ trigger
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          onQueryChange(null, null);
          return;
        }

        const anchorNode = selection.anchor.getNode();
        if (!$isTextNode(anchorNode)) {
          onQueryChange(null, null);
          return;
        }

        const anchorOffset = selection.anchor.offset;
        const textContent = anchorNode.getTextContent();
        if (anchorOffset > textContent.length) {
          onQueryChange(null, null);
          return;
        }

        const textBeforeCaret = textContent.substring(0, anchorOffset);
        const query = resolveMentionQuery(textBeforeCaret);
        if (query === null) {
          onQueryChange(null, null);
          return;
        }

        if (isEditorComposing(editor)) return;

        const rect = getCaretRect(editor);
        onQueryChange(query, rect);
      });
    });
  }, [editor, onQueryChange]);

  // Handle keyboard navigation when picker is open
  useEffect(() => {
    if (!pickerOpen) return;

    const removeDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => {
        event?.preventDefault();
        onRequestMove(1);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );

    const removeUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => {
        event?.preventDefault();
        onRequestMove(-1);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );

    const removeEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        event?.preventDefault();
        onRequestSelectActive();
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );

    const removeTab = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => {
        event?.preventDefault();
        onRequestSelectActive();
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );

    const removeEscape = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => {
        event?.preventDefault();
        onQueryChange(null, null);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );

    return () => {
      removeDown();
      removeUp();
      removeEnter();
      removeTab();
      removeEscape();
    };
  }, [editor, pickerOpen, onRequestSelectActive, onRequestMove, onQueryChange]);

  // Ensure mentions are removable with keyboard in all cursor states.
  useEffect(() => {
    const removeBackspace = editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => {
        const removed = removeAdjacentMention('backward');
        if (removed) {
          event?.preventDefault();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_NORMAL
    );

    const removeDelete = editor.registerCommand(
      KEY_DELETE_COMMAND,
      (event) => {
        const removed = removeAdjacentMention('forward');
        if (removed) {
          event?.preventDefault();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_NORMAL
    );

    return () => {
      removeBackspace();
      removeDelete();
    };
  }, [editor]);

  return null;
}

/**
 * Replace the @query text with a FileMentionNode + space
 */
export function replaceTriggerWithFileMention(
  editor: LexicalEditor,
  payload: FileMentionPayload
): void {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;

    const anchorNode = selection.anchor.getNode();
    const anchorOffset = selection.anchor.offset;
    const textContent = anchorNode.getTextContent();

    // Find the @ trigger
    const textBeforeCaret = textContent.substring(0, anchorOffset);
    const atIndex = textBeforeCaret.lastIndexOf('@');
    if (atIndex === -1) return;

    // Split the text node: [before@query] -> [before][mentionNode][ ][after]
    const textBefore = textContent.substring(0, atIndex);
    const textAfter = textContent.substring(anchorOffset);

    const mentionNode = $createFileMentionNode(payload);
    const spaceNode = $createTextNode(' ');

    if (textBefore || textAfter) {
      // Replace the anchor node content
      const parent = anchorNode.getParent();
      if (!parent) return;

      const newNodes: any[] = [];
      if (textBefore) {
        newNodes.push($createTextNode(textBefore));
      }
      newNodes.push(mentionNode);
      newNodes.push(spaceNode);
      if (textAfter) {
        newNodes.push($createTextNode(textAfter));
      }

      // Replace anchor node with new nodes
      for (const node of newNodes) {
        anchorNode.insertBefore(node);
      }
      anchorNode.remove();

      // Place caret after space
      spaceNode.select(1, 1);
    } else {
      // Simple case: entire node is @query
      anchorNode.insertBefore(mentionNode);
      anchorNode.insertBefore(spaceNode);
      anchorNode.remove();
      spaceNode.select(1, 1);
    }
  });
}

/**
 * Insert a FileMentionNode at the current selection (used by drag & drop)
 */
export function insertFileMentionAtSelection(
  editor: LexicalEditor,
  payload: FileMentionPayload
): void {
  editor.update(() => {
    let selection = $getSelection();

    if (!$isRangeSelection(selection)) {
      const root = $getRoot();
      if (root.getChildrenSize() === 0) {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode(''));
        root.append(paragraph);
      }

      root.selectEnd();
      selection = $getSelection();
    }

    if (!$isRangeSelection(selection)) return;

    const mentionNode = $createFileMentionNode(payload);
    const spaceNode = $createTextNode(' ');

    selection.insertNodes([mentionNode, spaceNode]);
    spaceNode.select(1, 1);
  });
}
