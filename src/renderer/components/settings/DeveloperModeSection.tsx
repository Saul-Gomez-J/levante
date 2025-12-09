import React, { useEffect, useState } from 'react';
import { SettingsSection } from './SettingsSection';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Code, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const DeveloperModeSection = () => {
  const { t } = useTranslation();
  const [developerMode, setDeveloperMode] = useState(false);

  useEffect(() => {
    const loadPreference = async () => {
      try {
        const result = await window.levante.preferences.get('developerMode');
        if (result.success && typeof result.data === 'boolean') {
          setDeveloperMode(result.data);
        }
      } catch (error) {
        console.error('Failed to load developer mode:', error);
      }
    };

    loadPreference();
  }, []);

  const handleToggle = async (checked: boolean) => {
    try {
      setDeveloperMode(checked);
      await window.levante.preferences.set('developerMode', checked);

      // Dispatch custom event to notify other components
      window.dispatchEvent(new CustomEvent('preference-changed', {
        detail: { key: 'developerMode', value: checked }
      }));
    } catch (error) {
      console.error('Failed to save developer mode:', error);
    }
  };

  return (
    <SettingsSection icon={<Code className="w-5 h-5" />} title={t('settings:developer_mode.title')}>
      <div className="flex items-start justify-between p-4 border rounded-lg bg-muted/30">
        <div className="space-y-2 flex-1 mr-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="developerMode" className="text-base font-medium">
              {t('settings:developer_mode.label')}
            </Label>
            {!developerMode && (
              <Badge variant="default" className="text-xs">
                {t('settings:developer_mode.recommended')}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {developerMode
              ? t('settings:developer_mode.advanced_desc')
              : t('settings:developer_mode.simple_desc')
            }
          </p>

          {developerMode && (
            <div className="flex items-start gap-2 mt-3 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded">
              <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-yellow-700 dark:text-yellow-500">
                {t('settings:developer_mode.warning')}
              </p>
            </div>
          )}
        </div>
        <Switch
          id="developerMode"
          checked={developerMode}
          onCheckedChange={handleToggle}
        />
      </div>
    </SettingsSection>
  );
};
