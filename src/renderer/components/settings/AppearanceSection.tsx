import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CheckCircle, Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppearance } from '@/hooks/useAppearance';
import { SettingsSection } from './SettingsSection';

// Common timezones grouped by region
const TIMEZONES = [
  { value: 'auto', label: 'Auto (System)' },
  // Europe
  { value: 'Europe/Madrid', label: 'Europe/Madrid (CET/CEST)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET/CEST)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET/CEST)' },
  { value: 'Europe/Rome', label: 'Europe/Rome (CET/CEST)' },
  { value: 'Europe/Amsterdam', label: 'Europe/Amsterdam (CET/CEST)' },
  { value: 'Europe/Brussels', label: 'Europe/Brussels (CET/CEST)' },
  { value: 'Europe/Lisbon', label: 'Europe/Lisbon (WET/WEST)' },
  { value: 'Europe/Moscow', label: 'Europe/Moscow (MSK)' },
  // Americas
  { value: 'America/New_York', label: 'America/New_York (EST/EDT)' },
  { value: 'America/Chicago', label: 'America/Chicago (CST/CDT)' },
  { value: 'America/Denver', label: 'America/Denver (MST/MDT)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST/PDT)' },
  { value: 'America/Toronto', label: 'America/Toronto (EST/EDT)' },
  { value: 'America/Mexico_City', label: 'America/Mexico_City (CST)' },
  { value: 'America/Sao_Paulo', label: 'America/Sao_Paulo (BRT)' },
  { value: 'America/Buenos_Aires', label: 'America/Buenos_Aires (ART)' },
  // Asia
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (CST)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
  { value: 'Asia/Seoul', label: 'Asia/Seoul (KST)' },
  // Oceania
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST/AEDT)' },
  { value: 'Australia/Melbourne', label: 'Australia/Melbourne (AEST/AEDT)' },
  { value: 'Pacific/Auckland', label: 'Pacific/Auckland (NZST/NZDT)' },
  // UTC
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
];

export const AppearanceSection = () => {
  const { t } = useTranslation(['settings', 'common']);
  const {
    theme,
    language,
    timezone,
    themeState,
    timezoneState,
    handleThemeChange,
    handleLanguageChange,
    handleTimezoneChange
  } = useAppearance();

  return (
    <SettingsSection
      icon={<Palette className="w-5 h-5" />}
      title={t('settings:sections.appearance')}
    >
      {/* Language Selector */}
      <div className="space-y-2">
        <Label htmlFor="language">{t('settings:language.label')}</Label>
        <Select
          value={language}
          onValueChange={(value) => handleLanguageChange(value as 'en' | 'es')}
        >
          <SelectTrigger id="language">
            <SelectValue placeholder={t('settings:language.label')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">
              <span className="font-medium">{t('settings:language.options.en')}</span>
            </SelectItem>
            <SelectItem value="es">
              <span className="font-medium">{t('settings:language.options.es')}</span>
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t('settings:language.description')}
        </p>
        <p className="text-xs text-amber-600">
          ⚠️ {t('settings:language.requires_restart')}
        </p>
      </div>

      {/* Theme Selector */}
      <div className="space-y-2">
        <Label htmlFor="theme">{t('settings:theme.label')}</Label>
        <Select
          value={theme || 'system'}
          onValueChange={(value) => handleThemeChange(value as 'light' | 'dark' | 'system')}
        >
          <SelectTrigger id="theme">
            <SelectValue placeholder={t('settings:theme.label')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">
              <div className="flex flex-col">
                <span className="font-medium">{t('settings:theme.options.system')}</span>
              </div>
            </SelectItem>
            <SelectItem value="light">
              <div className="flex flex-col">
                <span className="font-medium">{t('settings:theme.options.light')}</span>
              </div>
            </SelectItem>
            <SelectItem value="dark">
              <div className="flex flex-col">
                <span className="font-medium">{t('settings:theme.options.dark')}</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t('settings:theme.description')}
        </p>

        {/* Save indicator */}
        {themeState.saved && (
          <div className="flex items-center text-green-600 text-sm">
            <CheckCircle className="w-4 h-4 mr-1" />
            {t('common:status.saved')}
          </div>
        )}
      </div>

      {/* Timezone Selector */}
      <div className="space-y-2">
        <Label htmlFor="timezone">{t('settings:timezone.label')}</Label>
        <Select
          value={timezone || 'auto'}
          onValueChange={handleTimezoneChange}
        >
          <SelectTrigger id="timezone">
            <SelectValue placeholder={t('settings:timezone.label')} />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>
                <span className="font-medium">{tz.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t('settings:timezone.description')}
        </p>

        {/* Save indicator */}
        {timezoneState.saved && (
          <div className="flex items-center text-green-600 text-sm">
            <CheckCircle className="w-4 h-4 mr-1" />
            {t('common:status.saved')}
          </div>
        )}
      </div>
    </SettingsSection>
  );
};
