import { Button } from '@/components/ui/button';
import { Play, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLogViewerStore } from '@/stores/logViewerStore';

/**
 * Controls for starting/stopping log watching
 */
export function LogViewerControls() {
  const { t } = useTranslation('logs');
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
          {t('controls.stop_watching')}
        </Button>
      ) : (
        <Button variant="default" size="sm" onClick={startWatching} disabled={loading}>
          <Play className="h-4 w-4 mr-2" />
          {t('controls.start_watching')}
        </Button>
      )}
    </div>
  );
}
