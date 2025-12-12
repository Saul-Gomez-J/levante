import React from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Settings,
  Trash2,
  Loader2,
  Info
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MCPRegistryEntry, MCPServerConfig, MCPConnectionStatus } from '@/types/mcp';
import { ConnectionStatus } from '../connection/connection-status';
import { useTranslation } from 'react-i18next';
import { useMCPStore } from '@/stores/mcpStore';

interface IntegrationCardProps {
  mode: 'active' | 'store';
  entry?: MCPRegistryEntry;
  server?: MCPServerConfig;
  status: MCPConnectionStatus;
  isActive: boolean;
  isInstalling?: boolean;
  providerBadge?: string; // ✅ NUEVO
  onToggle: () => void;
  onConfigure: () => void;
  onAddToActive?: () => void;
  onDelete?: () => void;
  onShowInfo?: () => void;
}

export function IntegrationCard({
  mode,
  entry,
  server,
  status,
  isActive,
  isInstalling = false,
  providerBadge,
  onToggle,
  onConfigure,
  onAddToActive,
  onDelete,
  onShowInfo
}: IntegrationCardProps) {
  const { t } = useTranslation('mcp');
  const { providers } = useMCPStore();
  const displayName = entry?.name || server?.name || server?.id || t('server.unknown');
  const description = entry?.description || t('server.custom_description');
  const category = entry?.category || 'custom';

  // Get provider homepage if available
  const provider = providers.find(p => p.id === entry?.source);
  const providerHomepage = provider?.homepage;

  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);

  const handleDeleteClick = () => {
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = () => {
    setShowDeleteDialog(false);
    onDelete?.();
  };

  const handleSourceClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (providerHomepage) {
      window.levante.openExternal(providerHomepage);
    }
  };

  return (
    <Card className="relative overflow-hidden border-none">
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-semibold text-lg">{displayName}</h3>
            <div className="flex items-center gap-1.5">
              <Badge variant="secondary" className="text-xs">
                {category}
              </Badge>
              {providerBadge && (
                <Badge
                  variant="outline"
                  className="text-xs"
                >
                  {providerBadge}
                </Badge>
              )}
            </div>
          </div>
          {/* Switch solo en modo Active */}
          {mode === 'active' && (
            <Switch
              checked={server?.enabled !== false}
              disabled={status === 'connecting'}
              onCheckedChange={onToggle}
            />
          )}
        </div>

        <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
          {description}
        </p>

        {/* Status indicator solo en modo Active y cuando está conectado/conectando */}
        {mode === 'active' && (status === 'connected' || status === 'connecting') && (
          <div className="flex items-center">
            <ConnectionStatus
              serverId={server?.id || entry?.id || 'unknown'}
              status={status}
              size="sm"
              variant="indicator"
            />
          </div>
        )}
      </CardContent>

      <CardFooter className="p-6 pt-0">
        <div className="flex gap-2 w-full">
          {/* Botón diferente según modo */}
          {mode === 'store' ? (
            // Store: Botón "Install" / "Installing" / "Installed" + Info button
            <>
              <Button
                variant={isActive ? 'secondary' : 'default'}
                size="sm"
                className="flex-1"
                onClick={onAddToActive}
                disabled={isActive || isInstalling}
              >
                {isInstalling ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t('server.installing')}
                  </>
                ) : isActive ? (
                  t('server.installed')
                ) : (
                  t('server.install')
                )}
              </Button>

              {onShowInfo && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onShowInfo}
                  title={t('server.view_info')}
                >
                  <Info className="w-4 h-4" />
                </Button>
              )}
            </>
          ) : (
            // Active: Botones "Configure" y "Delete"
            <>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={onConfigure}
                disabled={status === 'connecting'}
              >
                <Settings className="w-4 h-4 mr-2" />
                {t('server.configure')}
              </Button>

              {onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDeleteClick}
                  disabled={status === 'connecting'}
                  title={t('server.delete')}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </>
          )}
        </div>
      </CardFooter>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dialog.delete_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              <span dangerouslySetInnerHTML={{ __html: t('dialog.delete_description', { name: displayName }) }} />
              <br />
              <br />
              {t('dialog.delete_warning')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('dialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              {t('dialog.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Overlay solo en modo Active */}
      {mode === 'active' && status === 'connecting' && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center">
          <ConnectionStatus
            serverId={server?.id || entry?.id || 'unknown'}
            status="connecting"
            size="lg"
            variant="full"
            showLabel={true}
          />
        </div>
      )}
    </Card>
  );
}