import { cn } from '@/lib/utils';

type DiffLineType = 'added' | 'removed' | 'context' | 'hunk';

interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

interface DiffViewerProps {
  diff: string;
  className?: string;
}

function shouldIgnoreLine(line: string): boolean {
  return (
    line.startsWith('---') ||
    line.startsWith('+++') ||
    line.startsWith('Index:') ||
    line.startsWith('===') ||
    line.startsWith('\\ No newline at end of file')
  );
}

function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines = diff.split('\n');
  const parsed: DiffLine[] = [];

  let oldLineNum = 0;
  let newLineNum = 0;

  for (const line of lines) {
    if (!line) continue;
    if (shouldIgnoreLine(line)) continue;

    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLineNum = Number.parseInt(match[1], 10);
        newLineNum = Number.parseInt(match[2], 10);
      }
      parsed.push({ type: 'hunk', content: line });
      continue;
    }

    if (line.startsWith('+')) {
      parsed.push({
        type: 'added',
        content: line.slice(1),
        newLineNum: newLineNum++,
      });
      continue;
    }

    if (line.startsWith('-')) {
      parsed.push({
        type: 'removed',
        content: line.slice(1),
        oldLineNum: oldLineNum++,
      });
      continue;
    }

    if (line.startsWith(' ')) {
      parsed.push({
        type: 'context',
        content: line.slice(1),
        oldLineNum: oldLineNum++,
        newLineNum: newLineNum++,
      });
    }
  }

  return parsed;
}

export function DiffViewer({ diff, className }: DiffViewerProps) {
  const lines = parseUnifiedDiff(diff || '');

  if (lines.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic px-3 py-2">
        Sin cambios detectados
      </div>
    );
  }

  return (
    <div className={cn('rounded-md border overflow-hidden font-mono text-xs', className)}>
      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => {
              if (line.type === 'hunk') {
                return (
                  <tr key={idx} className="bg-blue-50 dark:bg-blue-950/30">
                    <td
                      colSpan={3}
                      className="px-3 py-0.5 text-blue-600 dark:text-blue-400 select-none text-[10px]"
                    >
                      {line.content}
                    </td>
                  </tr>
                );
              }

              return (
                <tr
                  key={idx}
                  className={cn(
                    line.type === 'added' && 'bg-green-50 dark:bg-green-950/30',
                    line.type === 'removed' && 'bg-red-50 dark:bg-red-950/30',
                    line.type === 'context' && 'bg-background',
                  )}
                >
                  <td
                    className={cn(
                      'w-10 px-2 py-0 text-right select-none border-r text-[10px]',
                      'text-muted-foreground/50',
                      line.type === 'added' &&
                        'border-green-200 dark:border-green-800 bg-green-100/50 dark:bg-green-950/50',
                      line.type === 'removed' &&
                        'border-red-200 dark:border-red-800 bg-red-100/50 dark:bg-red-950/50',
                      line.type === 'context' && 'border-border/50',
                    )}
                  >
                    {line.oldLineNum ?? ''}
                  </td>

                  <td
                    className={cn(
                      'w-10 px-2 py-0 text-right select-none border-r text-[10px]',
                      'text-muted-foreground/50',
                      line.type === 'added' &&
                        'border-green-200 dark:border-green-800 bg-green-100/50 dark:bg-green-950/50',
                      line.type === 'removed' &&
                        'border-red-200 dark:border-red-800 bg-red-100/50 dark:bg-red-950/50',
                      line.type === 'context' && 'border-border/50',
                    )}
                  >
                    {line.newLineNum ?? ''}
                  </td>

                  <td className="px-2 py-0 whitespace-pre">
                    <span
                      className={cn(
                        'mr-2 select-none font-bold',
                        line.type === 'added' && 'text-green-600 dark:text-green-400',
                        line.type === 'removed' && 'text-red-600 dark:text-red-400',
                        line.type === 'context' && 'text-muted-foreground/30',
                      )}
                    >
                      {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                    </span>
                    <span
                      className={cn(
                        line.type === 'added' && 'text-green-900 dark:text-green-100',
                        line.type === 'removed' && 'text-red-900 dark:text-red-100',
                        line.type === 'context' && 'text-foreground/80',
                      )}
                    >
                      {line.content}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
