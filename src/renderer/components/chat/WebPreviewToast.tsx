/**
 * WebPreviewToast
 *
 * Notificación no-bloqueante que aparece cuando se detecta
 * un nuevo servidor por primera vez.
 */

import { useEffect } from 'react';
import { Monitor, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useWebPreviewStore } from '@/stores/webPreviewStore';

export function WebPreviewToast() {
  const pendingToast = useWebPreviewStore((s) => s.pendingToast);
  const clearToast = useWebPreviewStore((s) => s.clearToast);
  const openPanel = useWebPreviewStore((s) => s.openPanel);

  // Auto-dismiss después de 6 segundos
  useEffect(() => {
    if (!pendingToast) return;
    const timer = setTimeout(() => {
      clearToast();
    }, 6000);
    return () => clearTimeout(timer);
  }, [pendingToast, clearToast]);

  if (!pendingToast) return null;

  return (
    <div
      className={cn(
        'fixed bottom-24 right-4 z-50',
        'flex items-center gap-3 px-4 py-3',
        'bg-background border rounded-xl shadow-lg',
        'animate-in slide-in-from-bottom-4 fade-in duration-300'
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
        <Monitor size={14} className="text-muted-foreground shrink-0" />
        <span>
          Servidor detectado en{' '}
          <code className="font-mono text-primary">:{pendingToast.port}</code>
        </span>
      </div>
      <Button
        size="sm"
        className="h-7 text-xs"
        onClick={() => {
          clearToast();
          openPanel(pendingToast.taskId);
        }}
      >
        Ver preview
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={clearToast}
      >
        <X size={12} />
      </Button>
    </div>
  );
}
