import { Button } from '@/components/ui/button';
import { Play, Square } from 'lucide-react';
import { useLogViewerStore } from '@/stores/logViewerStore';

/**
 * Controls for starting/stopping log watching
 */
export function LogViewerControls() {
  const { isWatching, loading, startWatching, stopWatching } = useLogViewerStore();

  return (
    <div className="flex items-center gap-2">
      {isWatching ? (
        <Button
          variant="outline"
          size="sm"
          onClick={stopWatching}
          disabled={loading}
        >
          <Square className="h-4 w-4 mr-2" />
          Stop Watching
        </Button>
      ) : (
        <Button variant="default" size="sm" onClick={startWatching} disabled={loading}>
          <Play className="h-4 w-4 mr-2" />
          Start Watching
        </Button>
      )}
    </div>
  );
}
