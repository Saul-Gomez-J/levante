import {
  DecoratorNode,
  type DOMConversionMap,
  type DOMExportOutput,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { createElement, type JSX } from 'react';
import { FileMentionChip } from './FileMentionChip';

export interface FileMentionPayload {
  fileName: string;
  filePath: string;
  relativePath: string;
}

export type SerializedFileMentionNode = Spread<
  {
    fileName: string;
    filePath: string;
    relativePath: string;
  },
  SerializedLexicalNode
>;

export class FileMentionNode extends DecoratorNode<JSX.Element> {
  __fileName: string;
  __filePath: string;
  __relativePath: string;

  static getType(): string {
    return 'file-mention';
  }

  static clone(node: FileMentionNode): FileMentionNode {
    return new FileMentionNode(
      node.__fileName,
      node.__filePath,
      node.__relativePath,
      node.__key
    );
  }

  constructor(
    fileName: string,
    filePath: string,
    relativePath: string,
    key?: NodeKey
  ) {
    super(key);
    this.__fileName = fileName;
    this.__filePath = filePath;
    this.__relativePath = relativePath;
  }

  createDOM(): HTMLElement {
    const span = document.createElement('span');
    span.style.display = 'inline-block';
    return span;
  }

  updateDOM(): false {
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('span');
    element.textContent = this.getTextContent();
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return null;
  }

  static importJSON(serializedNode: SerializedFileMentionNode): FileMentionNode {
    return new FileMentionNode(
      serializedNode.fileName,
      serializedNode.filePath,
      serializedNode.relativePath
    );
  }

  exportJSON(): SerializedFileMentionNode {
    return {
      ...super.exportJSON(),
      type: 'file-mention',
      fileName: this.__fileName,
      filePath: this.__filePath,
      relativePath: this.__relativePath,
      version: 1,
    };
  }

  getTextContent(): string {
    return '@' + this.__relativePath;
  }

  getFileName(): string {
    return this.__fileName;
  }

  getFilePath(): string {
    return this.__filePath;
  }

  getRelativePath(): string {
    return this.__relativePath;
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  isIsolated(): boolean {
    return true;
  }

  decorate(): JSX.Element {
    return createElement(FileMentionChip, {
      fileName: this.__fileName,
      relativePath: this.__relativePath,
      filePath: this.__filePath,
    });
  }
}

export function $createFileMentionNode(payload: FileMentionPayload): FileMentionNode {
  return new FileMentionNode(
    payload.fileName,
    payload.filePath,
    payload.relativePath
  );
}

export function $isFileMentionNode(node: LexicalNode | null | undefined): node is FileMentionNode {
  return node instanceof FileMentionNode;
}
