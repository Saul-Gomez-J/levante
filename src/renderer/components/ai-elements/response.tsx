'use client';

import { cn } from '@/lib/utils';
import { type ComponentProps, memo, useEffect, useState } from 'react';
import { Streamdown } from 'streamdown';
import type { BundledTheme } from 'shiki';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Mermaid } from '@/components/ui/mermaid';
import { useStreamingContext } from '@/contexts/StreamingContext';

// Custom components for proper list rendering
const listComponents = {
  ul: ({ className, ...props }: any) => (
    <ul className={cn("ml-4 list-outside list-disc", className)} {...props} />
  ),
  ol: ({ className, ...props }: any) => (
    <ol className={cn("ml-4 list-outside list-decimal", className)} {...props} />
  ),
  li: ({ className, ...props }: any) => (
    <li className={cn("py-1", className)} {...props} />
  ),
};

type ResponseProps = ComponentProps<typeof Streamdown> & {
  children?: React.ReactNode;
};

const MermaidCodeBlock = ({ children, className }: { children: string; className?: string }) => {
  return (
    <div className={cn("my-6 border rounded-lg p-6 bg-muted/50 overflow-auto shadow-sm dark:bg-muted-foreground", className)}>
      <Mermaid chart={children} className="w-full h-auto min-h-[200px] flex items-center justify-center" />
    </div>
  );
};

const processContentWithMermaid = (content: string) => {
  // More flexible regex that handles different line endings and spacing
  const mermaidRegex = /```mermaid\s*\n([\s\S]*?)\n\s*```/g;
  let match;
  const parts = [];
  let lastIndex = 0;

  while ((match = mermaidRegex.exec(content)) !== null) {
    // Add text before mermaid block
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: content.slice(lastIndex, match.index)
      });
    }

    // Add mermaid block
    parts.push({
      type: 'mermaid',
      content: match[1].trim()
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push({
      type: 'text',
      content: content.slice(lastIndex)
    });
  }

  return parts.length > 1 ? parts : [{ type: 'text', content }];
};

// Filter out attachment markers from content (they're for AI context only)
const filterAttachmentMarkers = (content: string): string => {
  return content
    // New format: [attachment:type:path:filename]
    .replace(/\[attachment:[^\]]+\]\n?/g, '')
    // Old format: ![filename](levante://attachments/...)
    .replace(/!\[[^\]]*\]\(levante:\/\/attachments\/[^)]*\)\n?/g, '')
    .trim();
};

export const Response = memo(
  ({ className, children, ...props }: ResponseProps) => {
    const [shouldProcessMermaid, setShouldProcessMermaid] = useState(false);
    const { streamFinished } = useStreamingContext();
    // Streamdown expects [lightTheme, darkTheme] tuple
    const shikiTheme: [BundledTheme, BundledTheme] = ['github-light', 'github-dark'];

    // Filter attachment markers from string content
    const filteredChildren = typeof children === 'string'
      ? filterAttachmentMarkers(children)
      : children;

    // Listen for streaming finish events
    useEffect(() => {
      if (typeof filteredChildren === 'string' && filteredChildren.includes('```mermaid')) {
        setShouldProcessMermaid(true);
      }
    }, [streamFinished, filteredChildren]);

    // Don't render anything if content is only attachment markers
    if (typeof filteredChildren === 'string' && !filteredChildren) {
      return null;
    }

    if (typeof filteredChildren !== 'string') {
      return (
        <Streamdown
          className={cn(
            'w-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
            className
          )}
          components={listComponents}
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          shikiTheme={shikiTheme}
          {...props}
        >
          {filteredChildren}
        </Streamdown>
      );
    }

    // Check if content has complete mermaid blocks
    const hasCompleteMermaid = /```mermaid\s*\n[\s\S]*?\n\s*```/.test(filteredChildren);

    // If we should process Mermaid and have complete blocks, do so
    if (shouldProcessMermaid && hasCompleteMermaid) {
      const parts = processContentWithMermaid(filteredChildren);

      if (parts.length > 1 || (parts.length === 1 && parts[0].type === 'mermaid')) {
        return (
          <div className={cn('w-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}>
            {parts.map((part, index) => (
              part.type === 'mermaid' ? (
                <MermaidCodeBlock key={`mermaid-${index}`}>
                  {part.content}
                </MermaidCodeBlock>
              ) : (
                <Streamdown
                  key={`text-${index}`}
                  components={listComponents}
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  shikiTheme={shikiTheme}
                  className='p-4'
                  {...props}
                >
                  {part.content}
                </Streamdown>
              )
            ))}
          </div>
        );
      }
    }

    // Default: show regular Streamdown content
    return (
      <Streamdown
        className={cn(
          'w-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          className
        )}
        components={listComponents}
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        shikiTheme={shikiTheme}
        {...props}
      >
        {filteredChildren}
      </Streamdown>
    );
  }
);

Response.displayName = 'Response';
