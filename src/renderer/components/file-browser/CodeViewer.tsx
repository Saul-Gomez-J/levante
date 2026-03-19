/**
 * CodeViewer
 *
 * Source code viewer with syntax highlighting and line numbers.
 */

import { ScrollArea } from '@/components/ui/scroll-area';
import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block';

interface CodeViewerProps {
  content: string;
  language: string;
}

export function CodeViewer({ content, language }: CodeViewerProps) {
  const lineCount = content.split('\n').length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b text-xs text-muted-foreground shrink-0">
        <span className="font-mono">{language}</span>
        <span>{lineCount} lines</span>
      </div>

      <ScrollArea className="flex-1">
        <CodeBlock code={content} language={language} showLineNumbers className="border-0 rounded-none">
          <CodeBlockCopyButton />
        </CodeBlock>
      </ScrollArea>
    </div>
  );
}
