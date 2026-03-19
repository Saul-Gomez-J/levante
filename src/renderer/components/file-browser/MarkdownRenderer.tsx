/**
 * MarkdownRenderer
 *
 * Markdown preview with GFM support.
 * Uses explicit element styles (no `prose` dependency).
 */

import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block';

interface MarkdownRendererProps {
  content: string;
}

const components: Components = {
  h1: ({ children }) => <h1 className="text-2xl font-semibold mt-2 mb-3 break-words">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-semibold mt-5 mb-2 break-words">{children}</h2>,
  h3: ({ children }) => <h3 className="text-lg font-semibold mt-4 mb-2 break-words">{children}</h3>,
  p: ({ children }) => <p className="leading-7 mb-3 break-words">{children}</p>,
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
        <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono break-all" {...props}>
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
    <div className="my-4 w-full max-w-full overflow-x-auto">
      <table className="w-full table-fixed border-collapse border border-border">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border px-3 py-2 bg-muted text-left text-sm font-medium align-top whitespace-normal break-words">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-3 py-2 text-sm align-top whitespace-normal break-words">{children}</td>,
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
    <div className="h-full w-full min-w-0 overflow-y-auto overflow-x-hidden">
      <div className="w-full min-w-0 max-w-full p-4 text-sm break-words [overflow-wrap:anywhere]">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
