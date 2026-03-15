import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface WelcomeStepProps {
  selectedLanguage: 'en' | 'es';
  detectedLanguage: 'en' | 'es';
  onLanguageChange: (language: 'en' | 'es') => void;
}

export function WelcomeStep({
  selectedLanguage,
  detectedLanguage,
  onLanguageChange,
}: WelcomeStepProps) {
  const { t } = useTranslation('wizard');

  return (
    <div className="flex flex-col items-center justify-center space-y-8 py-8">
      <div className="text-center">
        <h1 className="text-5xl font-bold tracking-tight">{t('welcome.title')}</h1>
        <p className="mt-3 text-lg text-muted-foreground">
          {t('welcome.subtitle')}
        </p>
      </div>

      <div className="flex items-center justify-center gap-2">
        <span className="text-sm text-muted-foreground">{t('language.select_language')}:</span>
        <Select value={selectedLanguage} onValueChange={onLanguageChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">
              <div className="flex items-center justify-between w-full gap-2">
                <span>English</span>
                {detectedLanguage === 'en' && (
                  <span className="text-xs text-primary">({t('language.detected')})</span>
                )}
              </div>
            </SelectItem>
            <SelectItem value="es">
              <div className="flex items-center justify-between w-full gap-2">
                <span>Español</span>
                {detectedLanguage === 'es' && (
                  <span className="text-xs text-primary">({t('language.detected')})</span>
                )}
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
