import {
  ChevronRight,
  Folder,
  File,
  FileText,
  FileCode,
  FileJson,
  FileType,
  Image,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DirectoryEntry } from '@/stores/fileBrowserStore';

interface FileTreeNodeProps {
  entry: DirectoryEntry;
  depth: number;
  isExpanded: boolean;
  isLoading: boolean;
  onClick: (entry: DirectoryEntry) => void;
}

export function getFileIcon(entry: DirectoryEntry) {
  if (entry.type === 'directory') {
    return <Folder className="h-3.5 w-3.5 shrink-0 text-blue-400" />;
  }

  const ext = entry.extension.toLowerCase();

  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
    return <FileCode className="h-3.5 w-3.5 shrink-0 text-yellow-500" />;
  }

  if (['py', 'rb', 'go', 'rs', 'java', 'swift', 'kt', 'php', 'c', 'cpp', 'h'].includes(ext)) {
    return <FileCode className="h-3.5 w-3.5 shrink-0 text-green-500" />;
  }

  if (['json', 'yaml', 'yml', 'toml', 'xml'].includes(ext)) {
    return <FileJson className="h-3.5 w-3.5 shrink-0 text-amber-500" />;
  }

  if (['md', 'mdx'].includes(ext)) {
    return <FileText className="h-3.5 w-3.5 shrink-0 text-blue-300" />;
  }

  if (['html', 'css', 'scss', 'less'].includes(ext)) {
    return <FileCode className="h-3.5 w-3.5 shrink-0 text-orange-400" />;
  }

  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) {
    return <Image className="h-3.5 w-3.5 shrink-0 text-purple-400" />;
  }

  if (['env', 'gitignore', 'dockerignore', 'editorconfig'].includes(ext) || entry.name.startsWith('.')) {
    return <FileType className="h-3.5 w-3.5 shrink-0 text-gray-400" />;
  }

  return <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

export function FileTreeNode({ entry, depth, isExpanded, isLoading, onClick }: FileTreeNodeProps) {
  return (
    <button
      className={cn(
        'flex items-center gap-1 py-[3px] px-2 w-full text-left',
        'cursor-pointer hover:bg-accent/50 rounded-sm text-sm transition-colors'
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={() => onClick(entry)}
      title={entry.name}
      draggable={entry.type === 'file'}
      onDragStart={(e) => {
        if (entry.type !== 'file') return;
        e.dataTransfer.setData(
          'application/levante-file',
          JSON.stringify({
            name: entry.name,
            path: entry.path,
            extension: entry.extension,
          })
        );
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      {entry.type === 'directory' ? (
        isLoading ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <ChevronRight
            className={cn(
              'h-3 w-3 shrink-0 transition-transform text-muted-foreground',
              isExpanded && 'rotate-90'
            )}
          />
        )
      ) : (
        <span className="w-3 shrink-0" />
      )}

      {getFileIcon(entry)}
      <span className="truncate text-[13px]">{entry.name}</span>
    </button>
  );
}
