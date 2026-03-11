import { useEffect, useMemo, useState, useRef } from 'react';
import { RefreshCw, Eye, EyeOff, FolderOpen, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFileBrowserStore, type DirectoryEntry } from '@/stores/fileBrowserStore';
import { useSidePanelStore } from '@/stores/sidePanelStore';
import { FileTreeNode, getFileIcon } from './FileTreeNode';
import { useTranslation } from 'react-i18next';

interface FileBrowserContentProps {
  searchQuery: string;
  cwd: string;
}

interface FileSearchResult {
  name: string;
  path: string;
  relativePath: string;
  extension: string;
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

  // Backend search state
  const [searchResults, setSearchResults] = useState<FileSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    void initialize(cwd);
  }, [cwd, initialize]);

  // Debounced backend search
  useEffect(() => {
    const trimmed = searchQuery.trim();

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (!trimmed || trimmed.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    setIsSearching(true);
    setSearchError(null);

    debounceRef.current = setTimeout(async () => {
      const currentRequestId = ++requestIdRef.current;
      try {
        const result = await window.levante.fs.searchFiles(trimmed, { maxResults: 30 });
        if (currentRequestId !== requestIdRef.current) return;

        if (result.success && result.data) {
          setSearchResults(result.data);
        } else {
          setSearchError(result.error ?? 'Search failed');
          setSearchResults([]);
        }
      } catch (err) {
        if (currentRequestId !== requestIdRef.current) return;
        setSearchError(err instanceof Error ? err.message : 'Search failed');
        setSearchResults([]);
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setIsSearching(false);
        }
      }
    }, 250);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery]);

  const handleItemClick = (entry: DirectoryEntry) => {
    if (entry.type === 'directory') {
      toggleDirectory(entry.path);
      return;
    }

    void openFileTab(entry.path);
  };

  const rootBasename = getBasename(cwd);
  const rootEntries = entries.get(cwd) ?? [];
  const isSearchMode = searchQuery.trim().length >= 2;

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

      {isSearchMode ? (
        <div className="py-1">
          {isSearching && searchResults.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('chat_list.file_browser.searching')}
            </div>
          ) : searchError ? (
            <div className="px-3 py-2 text-xs text-destructive">
              {searchError}
            </div>
          ) : searchResults.length === 0 && !isSearching ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              {t('chat_list.file_browser.no_search_results')}
            </div>
          ) : (
            <div>
              {isSearching && (
                <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                </div>
              )}
              {searchResults.map((result) => (
                <button
                  key={result.path}
                  className="flex items-center gap-1.5 py-[3px] px-3 w-full text-left cursor-pointer hover:bg-accent/50 rounded-sm text-sm transition-colors"
                  onClick={() => void openFileTab(result.path)}
                  title={result.relativePath}
                >
                  {getFileIcon({
                    name: result.name,
                    path: result.path,
                    type: 'file',
                    size: 0,
                    extension: result.extension,
                    modifiedAt: 0,
                    isHidden: false,
                  })}
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="truncate text-[13px]">{result.name}</span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      {result.relativePath}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
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
                filterQuery=""
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
