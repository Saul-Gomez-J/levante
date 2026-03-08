/**
 * MarkdownRenderer
 *
 * Markdown preview with GFM support.
 * Uses explicit element styles (no `prose` dependency).
 */

import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block';

interface MarkdownRendererProps {
  content: string;
}

const components: Components = {
  h1: ({ children }) => <h1 className="text-2xl font-semibold mt-2 mb-3">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-semibold mt-5 mb-2">{children}</h2>,
  h3: ({ children }) => <h3 className="text-lg font-semibold mt-4 mb-2">{children}</h3>,
  p: ({ children }) => <p className="leading-7 mb-3">{children}</p>,
  ul: ({ children }) => <ul className="list-disc list-outside ml-5 mb-3">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-outside ml-5 mb-3">{children}</ol>,
  li: ({ children }) => <li className="py-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-muted-foreground italic my-3">
      {children}
    </blockquote>
  ),
  code: ({ className, children, ...props }) => {
    const match = className?.match(/language-(\w+)/);
    const language = match ? match[1] : '';
    const codeString = String(children).replace(/\n$/, '');

    if (!match) {
      return (
        <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
          {children}
        </code>
      );
    }

    return (
      <CodeBlock code={codeString} language={language} showLineNumbers>
        <CodeBlockCopyButton />
      </CodeBlock>
    );
  },
  table: ({ children }) => (
    <div className="overflow-x-auto my-4">
      <table className="w-full border-collapse border border-border">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border px-3 py-2 bg-muted text-left text-sm font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-3 py-2 text-sm">{children}</td>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-primary hover:underline"
      onClick={(e) => {
        e.preventDefault();
        if (href) {
          void window.levante.openExternal(href);
        }
      }}
    >
      {children}
    </a>
  ),
};

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ScrollArea className="h-full">
      <div className="p-4 text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {content}
        </ReactMarkdown>
      </div>
    </ScrollArea>
  );
}
