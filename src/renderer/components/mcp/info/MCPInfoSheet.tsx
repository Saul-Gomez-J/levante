import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ExternalLink, Terminal, Globe, Server, Check } from 'lucide-react';
import { MCPRegistryEntry } from '@/types/mcp';
import { useTranslation } from 'react-i18next';

interface MCPInfoSheetProps {
  entry: MCPRegistryEntry | null;
  isOpen: boolean;
  isInstalled: boolean;
  onClose: () => void;
  onInstall?: () => void;
}

export function MCPInfoSheet({
  entry,
  isOpen,
  isInstalled,
  onClose,
  onInstall
}: MCPInfoSheetProps) {
  const { t } = useTranslation('mcp');

  if (!entry) return null;

  const template = entry.configuration?.template;
  const transportType = template?.type || entry.transport?.type || 'stdio';

  // Get command display
  const getCommandDisplay = () => {
    if (transportType === 'stdio') {
      const command = template?.command || 'N/A';
      const args = template?.args?.join(' ') || '';
      return `${command} ${args}`.trim();
    }
    return template?.baseUrl || 'N/A';
  };

  // Get environment variables
  const envVars = template?.env || {};
  const hasEnvVars = Object.keys(envVars).length > 0;

  // Get required fields from configuration
  const requiredFields = entry.configuration?.fields?.filter(f => f.required) || [];

  // Transport icon
  const TransportIcon = transportType === 'stdio' ? Terminal : transportType === 'http' ? Globe : Server;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-[500px] sm:max-w-[500px] overflow-y-auto">
        <SheetHeader className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <SheetTitle className="text-2xl">{entry.name}</SheetTitle>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="secondary">{entry.category}</Badge>
                {entry.source && entry.source !== 'levante' && (
                  <Badge variant="outline">{entry.source}</Badge>
                )}
              </div>
            </div>
          </div>
          <SheetDescription className="text-base text-foreground/80">
            {entry.description}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Transport Section */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <TransportIcon className="w-4 h-4" />
              {t('info.transport_title')}
            </h3>
            <div className="bg-muted/50 rounded-lg p-4 space-y-3 border">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {t('info.transport_type')}
                </span>
                <Badge variant="outline" className="font-mono">
                  {transportType}
                </Badge>
              </div>

              <Separator />

              <div className="space-y-2">
                <span className="text-sm text-muted-foreground block">
                  {transportType === 'stdio' ? t('info.command_title') : t('info.url_title')}
                </span>
                <code className="block text-sm bg-background/50 p-3 rounded border font-mono break-all">
                  {getCommandDisplay()}
                </code>
              </div>

              {transportType === 'stdio' && template?.args && template.args.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <span className="text-sm text-muted-foreground block">
                      {t('info.args_title')}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {template.args.map((arg, idx) => (
                        <Badge key={idx} variant="secondary" className="font-mono">
                          {arg}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Environment Variables */}
          <div>
            <h3 className="text-sm font-semibold mb-3">
              {t('info.env_title')}
            </h3>
            {hasEnvVars ? (
              <div className="bg-muted/50 rounded-lg p-4 space-y-2 border">
                {Object.entries(envVars).map(([key, value]) => {
                  const field = requiredFields.find(f => f.key === key);
                  const isRequired = field?.required ?? false;

                  return (
                    <div key={key} className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <code className="text-sm font-mono">{key}</code>
                          {isRequired && (
                            <Badge variant="destructive" className="text-xs">
                              {t('info.env_required')}
                            </Badge>
                          )}
                        </div>
                        {field?.description && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {field.description}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                {t('info.no_env')}
              </p>
            )}
          </div>

          {/* Metadata Section */}
          {entry.metadata && (
            <div>
              <h3 className="text-sm font-semibold mb-3">
                {t('info.metadata_title')}
              </h3>
              <div className="space-y-2">
                {entry.metadata.author && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t('info.author')}</span>
                    <span className="font-medium">{entry.metadata.author}</span>
                  </div>
                )}

                {entry.metadata.homepage && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t('info.homepage')}</span>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={() => window.levante.openExternal(entry.metadata!.homepage!)}
                    >
                      <ExternalLink className="w-3 h-3 mr-1" />
                      Link
                    </Button>
                  </div>
                )}

                {entry.metadata.repository && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t('info.repository')}</span>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={() => window.levante.openExternal(entry.metadata!.repository!)}
                    >
                      <ExternalLink className="w-3 h-3 mr-1" />
                      GitHub
                    </Button>
                  </div>
                )}

                {entry.metadata.useCount !== undefined && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t('info.use_count')}</span>
                    <span className="font-medium">{entry.metadata.useCount.toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer with Install Button */}
        <div className="mt-8 pt-6 border-t">
          <Button
            className="w-full"
            size="lg"
            onClick={onInstall}
            disabled={isInstalled}
          >
            {isInstalled ? (
              <>
                <Check className="w-4 h-4 mr-2" />
                {t('info.already_installed')}
              </>
            ) : (
              t('info.install')
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
