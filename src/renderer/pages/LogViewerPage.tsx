import { useEffect, useMemo, useRef } from 'react';
import {
  useLogViewerStore,
  selectFilteredEntries,
  saveFilterPreferences,
  loadFilterPreferences,
} from '@/stores/logViewerStore';
import { LogViewerFilters } from '@/components/logViewer/LogViewerFilters';
import { LogViewerTable } from '@/components/logViewer/LogViewerTable';
import { LogViewerControls } from '@/components/logViewer/LogViewerControls';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, FileText, Loader2 } from 'lucide-react';

/**
 * Log viewer page - displays real-time application logs
 */
export default function LogViewerPage() {
  const {
    entries,
    isWatching,
    loading,
    error,
    filters,
    autoScroll,
    loadRecent,
    syncWatchingState,
    startWatching,
    updateFilters,
    toggleAutoScroll,
    clearLogs,
  } = useLogViewerStore();

  const scrollRef = useRef<HTMLDivElement>(null);

  // Memoize filtered entries for performance
  const filteredEntries = useMemo(() => {
    return selectFilteredEntries(useLogViewerStore.getState());
  }, [entries, filters]);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      // Scroll to bottom
      const scrollElement = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [filteredEntries, autoScroll]);

  // Load recent logs and sync watching state on mount
  useEffect(() => {
    const initializeLogViewer = async () => {
      // Load saved preferences
      const savedPrefs = loadFilterPreferences();
      if (savedPrefs.categories || savedPrefs.levels) {
        updateFilters(savedPrefs);
      }

      // Sync watching state from main process
      await syncWatchingState();

      // Auto-start watching if this is the first time (no user preference saved)
      if (savedPrefs.userWatchingPreference === undefined) {
        // Check current state after sync
        const currentState = useLogViewerStore.getState();
        if (!currentState.isWatching) {
          await startWatching();
        }
      }

      // Load recent logs
      loadRecent();
    };

    initializeLogViewer();
  }, []);

  // Save preferences when they change
  useEffect(() => {
    saveFilterPreferences(filters, autoScroll);
  }, [filters, autoScroll]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        clearLogs();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearLogs]);

  return (
    <div className="h-full flex flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Developer Logs</h1>
        <LogViewerControls />
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Filters */}
      <LogViewerFilters
        filters={filters}
        onFilterChange={updateFilters}
        autoScroll={autoScroll}
        onAutoScrollChange={toggleAutoScroll}
        onClear={clearLogs}
      />

      {/* Table */}
      <div className="flex-1 overflow-hidden">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <FileText className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">No logs found</p>
            <p className="text-sm">
              {entries.length === 0
                ? 'Try adjusting your filters or start watching logs'
                : 'Try adjusting your filters'}
            </p>
          </div>
        ) : (
          <LogViewerTable entries={filteredEntries} scrollRef={scrollRef} />
        )}
      </div>

      {/* Footer Stats */}
      <div className="text-sm text-muted-foreground flex items-center gap-4">
        <span className="flex items-center gap-2">
          {isWatching ? (
            <>
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Watching logs
            </>
          ) : (
            <>
              <div className="w-2 h-2 rounded-full bg-gray-400" />
              Stopped
            </>
          )}
        </span>
        <span>
          {filteredEntries.length} / {entries.length} entries
        </span>
      </div>
    </div>
  );
}
