import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { FileCode, File as FileIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DirectoryEntry } from '@/stores/fileBrowserStore';

interface FileAutocompleteProps {
  query: string;
  anchorRect: DOMRect | null;
  results: DirectoryEntry[];
  selectedIndex: number;
  onSelect: (entry: DirectoryEntry) => void;
  onHoverIndex: (index: number) => void;
  onClose: () => void;
}

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'swift', 'kt', 'php', 'c', 'cpp', 'h',
  'html', 'css', 'scss', 'less',
]);

export function FileAutocomplete({
  query,
  anchorRect,
  results,
  selectedIndex,
  onSelect,
  onHoverIndex,
  onClose,
}: FileAutocompleteProps) {
  const { t } = useTranslation('chat');
  const listRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Scroll selected into view
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const selected = container.children[selectedIndex] as HTMLElement;
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!anchorRect) return null;

  // Calculate position: above or below the cursor
  const windowHeight = window.innerHeight;
  const spaceBelow = windowHeight - anchorRect.bottom;
  const popupHeight = Math.min(results.length * 36 + 8, 8 * 36 + 8);
  const showAbove = spaceBelow < popupHeight + 20 && anchorRect.top > popupHeight;

  const style: React.CSSProperties = {
    position: 'fixed',
    left: `${Math.max(8, anchorRect.left)}px`,
    ...(showAbove
      ? { bottom: `${windowHeight - anchorRect.top + 4}px` }
      : { top: `${anchorRect.bottom + 4}px` }),
    zIndex: 9999,
    maxWidth: '400px',
    minWidth: '250px',
  };

  return (
    <div
      ref={listRef}
      className="rounded-lg border bg-popover shadow-lg overflow-y-auto"
      style={style}
    >
      {results.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          {t('file_mentions.no_results', 'No files found')}
        </div>
      ) : (
        results.map((entry, index) => {
          const isCode = CODE_EXTENSIONS.has(entry.extension.toLowerCase());
          const Icon = isCode ? FileCode : FileIcon;

          return (
            <button
              key={entry.path}
              type="button"
              className={cn(
                'flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm transition-colors',
                index === selectedIndex
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50'
              )}
              onMouseEnter={() => onHoverIndex(index)}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent blur
                onSelect(entry);
              }}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="flex flex-col min-w-0">
                <span className="truncate font-medium">{entry.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {entry.path}
                </span>
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}
