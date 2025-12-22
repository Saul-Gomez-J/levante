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
import { Brain, CheckCircle, ChevronDown, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useReasoningConfig } from '@/hooks/useReasoningConfig';
import { SettingsSection } from './SettingsSection';
import type { ReasoningMode, ReasoningEffort } from '../../../types/reasoning';

export const ReasoningSection = () => {
  const { t } = useTranslation(['settings', 'common']);
  const { config, setConfig, state, handleSave } = useReasoningConfig();

  return (
    <SettingsSection
      icon={<Brain className="w-5 h-5" />}
      title={t('settings:sections.reasoning_configuration')}
    >
      <div className="space-y-6">
        {/* Reasoning Mode Selection */}
        <div className="space-y-3">
          <Label htmlFor="reasoning-mode">{t('settings:reasoning_config.mode.label')}</Label>
          <Select
            value={config.mode}
            onValueChange={(value: ReasoningMode) =>
              setConfig(prev => ({ ...prev, mode: value }))
            }
          >
            <SelectTrigger id="reasoning-mode">
              <SelectValue placeholder={t('settings:reasoning_config.mode.label')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="adaptive">
                {t('settings:reasoning_config.mode.options.adaptive')}
              </SelectItem>
              <SelectItem value="always">
                {t('settings:reasoning_config.mode.options.always')}
              </SelectItem>
              <SelectItem value="prompt-based">
                {t('settings:reasoning_config.mode.options.prompt_based')}
              </SelectItem>
              <SelectItem value="disabled">
                {t('settings:reasoning_config.mode.options.disabled')}
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{t(`settings:reasoning_config.mode.descriptions.${config.mode}`)}</span>
          </p>
        </div>

        {/* Effort Level (only when mode is 'always') */}
        {config.mode === 'always' && (
          <div className="space-y-4 border-t pt-4">
            <div className="space-y-3">
              <Label htmlFor="reasoning-effort">
                {t('settings:reasoning_config.effort.label')}
              </Label>
              <Select
                value={config.effort || 'medium'}
                onValueChange={(value: ReasoningEffort) =>
                  setConfig(prev => ({ ...prev, effort: value, maxTokens: undefined }))
                }
              >
                <SelectTrigger id="reasoning-effort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minimal">
                    {t('settings:reasoning_config.effort.options.minimal')}
                  </SelectItem>
                  <SelectItem value="low">
                    {t('settings:reasoning_config.effort.options.low')}
                  </SelectItem>
                  <SelectItem value="medium">
                    {t('settings:reasoning_config.effort.options.medium')}
                  </SelectItem>
                  <SelectItem value="high">
                    {t('settings:reasoning_config.effort.options.high')}
                  </SelectItem>
                  <SelectItem value="xhigh">
                    {t('settings:reasoning_config.effort.options.xhigh')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t('settings:reasoning_config.effort.description')}
              </p>
            </div>

            {/* Advanced Options (collapsible) */}
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:underline group">
                <ChevronDown className="w-4 h-4 transition-transform group-data-[state=open]:rotate-180" />
                {t('settings:reasoning_config.advanced_options')}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-4">
                {/* Max Tokens (alternative to effort) */}
                <div className="space-y-2">
                  <Label htmlFor="max-tokens">
                    {t('settings:reasoning_config.max_tokens.label')}
                  </Label>
                  <Input
                    id="max-tokens"
                    type="number"
                    min="1024"
                    max="32000"
                    step="1024"
                    placeholder={t('settings:reasoning_config.max_tokens.placeholder')}
                    value={config.maxTokens || ''}
                    onChange={(e) =>
                      setConfig(prev => ({
                        ...prev,
                        maxTokens: e.target.value ? parseInt(e.target.value) : undefined,
                        effort: e.target.value ? undefined : prev.effort,
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('settings:reasoning_config.max_tokens.description')}
                  </p>
                </div>

                {/* Exclude from Response */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>{t('settings:reasoning_config.exclude.label')}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t('settings:reasoning_config.exclude.description')}
                    </p>
                  </div>
                  <Switch
                    checked={config.excludeFromResponse || false}
                    onCheckedChange={(checked) =>
                      setConfig(prev => ({ ...prev, excludeFromResponse: checked }))
                    }
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
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
            {state.saving
              ? t('settings:reasoning_config.saving')
              : t('settings:reasoning_config.save_button')}
          </Button>

          {state.saved && (
            <div className="flex items-center text-green-600 text-sm">
              <CheckCircle className="w-4 h-4 mr-1" />
              {t('settings:reasoning_config.saved')}
            </div>
          )}
        </div>

        {/* Information Box */}
        <div className="bg-muted/50 p-4 rounded-md text-sm space-y-2">
          <p className="font-medium">{t('settings:reasoning_config.info_box.title')}</p>
          <ul className="text-muted-foreground space-y-1 text-xs">
            <li>- {t('settings:reasoning_config.info_box.points.adaptive')}</li>
            <li>- {t('settings:reasoning_config.info_box.points.prompt_triggers')}</li>
            <li>- {t('settings:reasoning_config.info_box.points.openrouter_unified')}</li>
            <li>- {t('settings:reasoning_config.info_box.points.direct_providers')}</li>
          </ul>
        </div>
      </div>
    </SettingsSection>
  );
};
