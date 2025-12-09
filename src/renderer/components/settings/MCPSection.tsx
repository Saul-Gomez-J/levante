import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { CheckCircle, Settings, ChevronDown, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMCPConfig } from '@/hooks/useMCPConfig';
import { SettingsSection } from './SettingsSection';

export const MCPSection = () => {
  const { t } = useTranslation(['settings', 'common']);
  const {
    config,
    setConfig,
    state,
    handleSave
  } = useMCPConfig();

  return (
    <SettingsSection
      icon={<Settings className="w-5 h-5" />}
      title={t('settings:sections.mcp_configuration')}
    >
      <div className="space-y-6">
        {/* SDK Selection */}
        <div className="space-y-3">
          <Label htmlFor="sdk-select">{t('settings:mcp_config.sdk.label')}</Label>
          <Select
            value={config.sdk}
            onValueChange={(value: 'mcp-use' | 'official-sdk') =>
              setConfig(prev => ({ ...prev, sdk: value }))
            }
          >
            <SelectTrigger id="sdk-select">
              <SelectValue placeholder={t('settings:mcp_config.sdk.label')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mcp-use">{t('settings:mcp_config.sdk.options.mcp-use')}</SelectItem>
              <SelectItem value="official-sdk">{t('settings:mcp_config.sdk.options.official-sdk')}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{t('settings:mcp_config.sdk.description')}</span>
          </p>
        </div>

        {/* Code Mode Configuration (only for mcp-use) */}
        {config.sdk === 'mcp-use' && (
          <div className="space-y-4 border-t pt-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="code-mode">{t('settings:mcp_config.code_mode.label')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('settings:mcp_config.code_mode.description')}
                  </p>
                </div>
                <Switch
                  id="code-mode"
                  checked={config.codeModeDefaults?.enabled ?? true}
                  onCheckedChange={(checked) =>
                    setConfig(prev => ({
                      ...prev,
                      codeModeDefaults: {
                        ...prev.codeModeDefaults!,
                        enabled: checked
                      }
                    }))
                  }
                />
              </div>
            </div>

            {/* Code Mode options (only when enabled) */}
            {config.codeModeDefaults?.enabled && (
              <>
                {/* Executor Selection */}
                <div className="space-y-3">
                  <Label htmlFor="executor-select">{t('settings:mcp_config.executor.label')}</Label>
                  <Select
                    value={config.codeModeDefaults?.executor || 'vm'}
                    onValueChange={(value: 'vm' | 'e2b') =>
                      setConfig(prev => ({
                        ...prev,
                        codeModeDefaults: {
                          ...prev.codeModeDefaults!,
                          executor: value
                        }
                      }))
                    }
                  >
                    <SelectTrigger id="executor-select">
                      <SelectValue placeholder={t('settings:mcp_config.executor.label')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vm">{t('settings:mcp_config.executor.options.vm')}</SelectItem>
                      <SelectItem value="e2b">{t('settings:mcp_config.executor.options.e2b')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {config.codeModeDefaults?.executor === 'vm'
                      ? t('settings:mcp_config.executor.vm_description')
                      : t('settings:mcp_config.executor.e2b_description')}
                  </p>
                </div>

                {/* Advanced Options (collapsible) */}
                <Collapsible>
                  <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:underline group">
                    <ChevronDown className="w-4 h-4 transition-transform group-data-[state=open]:rotate-180" />
                    {t('settings:mcp_config.advanced_options')}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-3 space-y-4">
                    {/* VM-specific options */}
                    {config.codeModeDefaults?.executor === 'vm' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="vm-timeout">{t('settings:mcp_config.vm_timeout.label')}</Label>
                          <Input
                            id="vm-timeout"
                            type="number"
                            min="1000"
                            max="300000"
                            step="1000"
                            value={config.codeModeDefaults?.vmTimeout || 30000}
                            onChange={(e) =>
                              setConfig(prev => ({
                                ...prev,
                                codeModeDefaults: {
                                  ...prev.codeModeDefaults!,
                                  vmTimeout: parseInt(e.target.value) || 30000
                                }
                              }))
                            }
                          />
                          <p className="text-xs text-muted-foreground">
                            {t('settings:mcp_config.vm_timeout.description')}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="vm-memory">{t('settings:mcp_config.vm_memory.label')}</Label>
                          <Input
                            id="vm-memory"
                            type="number"
                            min="32"
                            max="1024"
                            step="32"
                            value={Math.floor((config.codeModeDefaults?.vmMemoryLimit || 134217728) / (1024 * 1024))}
                            onChange={(e) =>
                              setConfig(prev => ({
                                ...prev,
                                codeModeDefaults: {
                                  ...prev.codeModeDefaults!,
                                  vmMemoryLimit: (parseInt(e.target.value) || 128) * 1024 * 1024
                                }
                              }))
                            }
                          />
                          <p className="text-xs text-muted-foreground">
                            {t('settings:mcp_config.vm_memory.description')}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* E2B-specific options */}
                    {config.codeModeDefaults?.executor === 'e2b' && (
                      <div className="space-y-2">
                        <Label htmlFor="e2b-api-key">{t('settings:mcp_config.e2b_api_key.label')}</Label>
                        <Input
                          id="e2b-api-key"
                          type="password"
                          placeholder={t('settings:mcp_config.e2b_api_key.placeholder')}
                          value={config.e2bApiKey || ''}
                          onChange={(e) =>
                            setConfig(prev => ({
                              ...prev,
                              e2bApiKey: e.target.value
                            }))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          {t('settings:mcp_config.e2b_api_key.description')}{' '}
                          <a
                            href="https://e2b.dev"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            {t('settings:mcp_config.e2b_api_key.link_text')}
                          </a>
                        </p>
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </>
            )}
          </div>
        )}

        {/* Save Button */}
        <div className="flex items-center gap-4 pt-2 border-t">
          <Button
            onClick={handleSave}
            disabled={state.saving}
            variant="outline"
            size="sm"
          >
            {state.saving ? t('settings:mcp_config.saving') : t('settings:mcp_config.save_button')}
          </Button>

          {state.saved && (
            <div className="flex items-center text-green-600 text-sm">
              <CheckCircle className="w-4 h-4 mr-1" />
              {t('settings:mcp_config.saved')}
            </div>
          )}
        </div>

        {/* Information Box */}
        <div className="bg-muted/50 p-4 rounded-md text-sm space-y-2">
          <p className="font-medium">{t('settings:mcp_config.info_box.title')}</p>
          <ul className="text-muted-foreground space-y-1 text-xs">
            <li>• {t('settings:mcp_config.info_box.points.orchestration')}</li>
            <li>• {t('settings:mcp_config.info_box.points.token_reduction')}</li>
            <li>• {t('settings:mcp_config.info_box.points.vm_executor')}</li>
            <li>• {t('settings:mcp_config.info_box.points.e2b_executor')}</li>
            <li>• {t('settings:mcp_config.info_box.points.apply_note')}</li>
          </ul>
        </div>
      </div>
    </SettingsSection>
  );
};
