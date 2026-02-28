import React, { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { LogEntryUI, LogLevel } from '../../../main/types/logger';

interface LogViewerTableProps {
  entries: LogEntryUI[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  warn: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

/**
 * Table display for log entries
 */
export function LogViewerTable({ entries, scrollRef }: LogViewerTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const formatTimestamp = (date: Date) => {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
  };

  return (
    <ScrollArea className="h-full rounded-lg border" ref={scrollRef}>
      <Table>
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow>
            <TableHead className="w-[120px]">Time</TableHead>
            <TableHead className="w-[120px]">Category</TableHead>
            <TableHead className="w-[100px]">Level</TableHead>
            <TableHead>Message</TableHead>
            <TableHead className="w-[40px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <React.Fragment key={entry.id}>
              <TableRow
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => {
                  if (entry.context && Object.keys(entry.context).length > 0) {
                    setExpandedId(expandedId === entry.id ? null : entry.id);
                  }
                }}
              >
                <TableCell className="font-mono text-xs">
                  {formatTimestamp(entry.timestamp)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">
                    {entry.category}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge className={LEVEL_COLORS[entry.level]}>
                    {entry.level.toUpperCase()}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-sm">{entry.message}</TableCell>
                <TableCell>
                  {entry.context && Object.keys(entry.context).length > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedId(expandedId === entry.id ? null : entry.id);
                      }}
                      className="p-1 hover:bg-accent rounded"
                    >
                      {expandedId === entry.id ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </TableCell>
              </TableRow>

              {/* Expanded context */}
              {expandedId === entry.id && entry.context && (
                <TableRow>
                  <TableCell colSpan={5} className="bg-muted/30">
                    <pre className="text-xs overflow-auto p-4 rounded bg-black/5 dark:bg-white/5">
                      {JSON.stringify(entry.context, null, 2)}
                    </pre>
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
