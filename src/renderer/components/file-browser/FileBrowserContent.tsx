import { useEffect, useMemo } from 'react';
import { RefreshCw, Eye, EyeOff, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFileBrowserStore, type DirectoryEntry } from '@/stores/fileBrowserStore';
import { useSidePanelStore } from '@/stores/sidePanelStore';
import { FileTreeNode } from './FileTreeNode';
import { useTranslation } from 'react-i18next';

interface FileBrowserContentProps {
  searchQuery: string;
  cwd: string;
}

function isEntryVisible(
  entry: DirectoryEntry,
  normalizedQuery: string,
  allEntries: Map<string, DirectoryEntry[]>
): boolean {
  if (!normalizedQuery) return true;

  if (entry.name.toLowerCase().includes(normalizedQuery)) {
    return true;
  }

  if (entry.type !== 'directory') {
    return false;
  }

  const children = allEntries.get(entry.path) ?? [];
  return children.some((child) => isEntryVisible(child, normalizedQuery, allEntries));
}

function getBasename(p: string): string {
  const normalized = p.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? p;
}

function FileTree({
  entries,
  allEntries,
  expandedDirs,
  depth,
  isLoadingDir,
  onItemClick,
  filterQuery,
}: {
  entries: DirectoryEntry[];
  allEntries: Map<string, DirectoryEntry[]>;
  expandedDirs: Set<string>;
  depth: number;
  isLoadingDir: string | null;
  onItemClick: (entry: DirectoryEntry) => void;
  filterQuery: string;
}) {
  const normalizedQuery = filterQuery.trim().toLowerCase();

  const visibleEntries = useMemo(() => {
    return entries.filter((entry) => isEntryVisible(entry, normalizedQuery, allEntries));
  }, [entries, normalizedQuery, allEntries]);

  if (visibleEntries.length === 0) {
    return null;
  }

  return (
    <div>
      {visibleEntries.map((entry) => {
        const forceExpandedBySearch = normalizedQuery.length > 0;
        const isExpanded = expandedDirs.has(entry.path) || forceExpandedBySearch;

        return (
          <div key={entry.path}>
            <FileTreeNode
              entry={entry}
              depth={depth}
              isExpanded={isExpanded}
              isLoading={isLoadingDir === entry.path}
              onClick={onItemClick}
            />

            {entry.type === 'directory' && isExpanded && (
              <FileTree
                entries={allEntries.get(entry.path) ?? []}
                allEntries={allEntries}
                expandedDirs={expandedDirs}
                depth={depth + 1}
                isLoadingDir={isLoadingDir}
                onItemClick={onItemClick}
                filterQuery={filterQuery}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function FileBrowserContent({ searchQuery, cwd }: FileBrowserContentProps) {
  const { t } = useTranslation('chat');
  const openFileTab = useSidePanelStore((state) => state.openFileTab);
  const {
    entries,
    expandedDirs,
    isLoadingDir,
    showHiddenFiles,
    error,
    initialize,
    toggleDirectory,
    refreshDirectory,
    setShowHidden,
  } = useFileBrowserStore();

  useEffect(() => {
    void initialize(cwd);
  }, [cwd, initialize]);

  const handleItemClick = (entry: DirectoryEntry) => {
    if (entry.type === 'directory') {
      toggleDirectory(entry.path);
      return;
    }

    void openFileTab(entry.path);
  };

  const rootBasename = getBasename(cwd);
  const rootEntries = entries.get(cwd) ?? [];

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground border-b">
        <div className="flex items-center gap-1.5 truncate">
          <FolderOpen size={12} className="shrink-0" />
          <span className="truncate font-mono">/{rootBasename}</span>
        </div>

        <div className="flex gap-0.5 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={() => setShowHidden(!showHiddenFiles)}
            title={
              showHiddenFiles
                ? t('chat_list.file_browser.hide_hidden')
                : t('chat_list.file_browser.show_hidden')
            }
          >
            {showHiddenFiles ? <EyeOff size={12} /> : <Eye size={12} />}
          </Button>

          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={() => refreshDirectory(cwd)}
            title={t('chat_list.file_browser.refresh')}
          >
            <RefreshCw size={12} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-destructive">
          {t('chat_list.file_browser.read_dir_error')}: {error}
        </div>
      )}

      {rootEntries.length === 0 && !isLoadingDir ? (
        <div className="px-3 py-4 text-xs text-muted-foreground text-center">
          {t('chat_list.file_browser.empty_directory')}
        </div>
      ) : (
        <div className="py-1">
          <FileTree
            entries={rootEntries}
            allEntries={entries}
            expandedDirs={expandedDirs}
            depth={0}
            isLoadingDir={isLoadingDir}
            onItemClick={handleItemClick}
            filterQuery={searchQuery}
          />
        </div>
      )}
    </div>
  );
}
