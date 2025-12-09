import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getRendererLogger } from '@/services/logger';

const logger = getRendererLogger();

export const useAppearance = () => {
  const { i18n } = useTranslation();
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>('system');
  const [language, setLanguage] = useState<'en' | 'es'>('en');
  const [timezone, setTimezone] = useState<string>('auto');
  const [themeState, setThemeSaveState] = useState({
    saving: false,
    saved: false,
  });
  const [timezoneState, setTimezoneSaveState] = useState({
    saving: false,
    saved: false,
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const themeResult = await window.levante.preferences.get('theme');
      if (themeResult?.data) {
        setThemeState(themeResult.data);
      }

      const languageResult = await window.levante.preferences.get('language');
      if (languageResult?.data) {
        const lang = languageResult.data as 'en' | 'es';
        setLanguage(lang);
        i18n.changeLanguage(lang);
      }

      const timezoneResult = await window.levante.preferences.get('timezone');
      if (timezoneResult?.data) {
        setTimezone(timezoneResult.data);
      }
    } catch (error) {
      logger.preferences.error('Error loading appearance settings', {
        error: error instanceof Error ? error.message : error
      });
    }
  };

  const handleThemeChange = async (newTheme: 'light' | 'dark' | 'system') => {
    setThemeSaveState({ saving: true, saved: false });
    setThemeState(newTheme);

    try {
      await window.levante.preferences.set('theme', newTheme);

      setThemeSaveState({ saving: false, saved: true });

      setTimeout(() => {
        setThemeSaveState({ saving: false, saved: false });
      }, 3000);

      window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: newTheme } }));
    } catch (error) {
      logger.preferences.error('Error saving theme', {
        theme: newTheme,
        error: error instanceof Error ? error.message : error
      });
      setThemeSaveState({ saving: false, saved: false });
    }
  };

  const handleLanguageChange = async (newLanguage: 'en' | 'es') => {
    setLanguage(newLanguage);

    try {
      await window.levante.preferences.set('language', newLanguage);
      logger.preferences.info('Language changed, restart required', { language: newLanguage });
    } catch (error) {
      logger.preferences.error('Error saving language', {
        language: newLanguage,
        error: error instanceof Error ? error.message : error
      });
    }
  };

  const handleTimezoneChange = async (newTimezone: string) => {
    setTimezoneSaveState({ saving: true, saved: false });
    setTimezone(newTimezone);

    try {
      await window.levante.preferences.set('timezone', newTimezone);

      setTimezoneSaveState({ saving: false, saved: true });

      setTimeout(() => {
        setTimezoneSaveState({ saving: false, saved: false });
      }, 3000);

      // Dispatch event for other parts of the app to react
      window.dispatchEvent(new CustomEvent('timezone-changed', { detail: { timezone: newTimezone } }));

      logger.preferences.info('Timezone changed', { timezone: newTimezone });
    } catch (error) {
      logger.preferences.error('Error saving timezone', {
        timezone: newTimezone,
        error: error instanceof Error ? error.message : error
      });
      setTimezoneSaveState({ saving: false, saved: false });
    }
  };

  return {
    theme,
    language,
    timezone,
    themeState,
    timezoneState,
    handleThemeChange,
    handleLanguageChange,
    handleTimezoneChange
  };
};
