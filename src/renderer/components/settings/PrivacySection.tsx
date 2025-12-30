import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { CheckCircle, Lock, CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SettingsSection } from './SettingsSection';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { LastSeenAnnouncements } from '@preload/types';

export const PrivacySection = () => {
  const { t } = useTranslation(['settings', 'wizard']);
  const [analyticsConsent, setAnalyticsConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [anonymousId, setAnonymousId] = useState<string | undefined>(undefined);
  const [lastSeenAnnouncements, setLastSeenAnnouncements] = useState<LastSeenAnnouncements | undefined>(undefined);

  // Load current analytics consent
  useEffect(() => {
    const loadAnalytics = async () => {
      try {
        const profile = await window.levante.profile.get();
        if (profile.success && profile.data?.analytics) {
          setAnalyticsConsent(profile.data.analytics.hasConsented);
          setAnonymousId(profile.data.analytics.anonymousUserId ?? undefined);
          setLastSeenAnnouncements(profile.data.analytics.lastSeenAnnouncements ?? undefined);
        }
      } catch (error) {
        console.error('Failed to load analytics consent:', error);
      }
    };

    loadAnalytics();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);

    try {
      if (analyticsConsent) {
        // Generate UUID only if consenting and no UUID exists
        await window.levante.profile.update({
          analytics: {
            hasConsented: true,
            consentedAt: new Date().toISOString(),
            anonymousUserId: anonymousId || crypto.randomUUID(),
            lastSeenAnnouncements, // Preserve per-category announcement tracking
          },
        });

        // Update backend to set sharing_data = true
        window.levante.analytics?.enableAnalytics?.().catch(() => { });
      } else {
        // User declined - update backend to set sharing_data = false
        // This is the last analytics call before stopping
        window.levante.analytics?.disableAnalytics?.().catch(() => { });

        // User declined - save that too (but don't generate UUID)
        await window.levante.profile.update({
          analytics: {
            hasConsented: false,
            consentedAt: new Date().toISOString(),
            anonymousUserId: anonymousId, // Keep existing ID if any
            lastSeenAnnouncements, // Preserve per-category announcement tracking
          },
        });
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Failed to save analytics consent:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      icon={<Lock className="w-5 h-5" />}
      title={t('settings:sections.privacy')}
    >
      {/* Analytics Toggle */}
      <div className="flex items-start justify-between">
        <div className="space-y-0.5 flex-1 mr-4">
          <Label htmlFor="analyticsConsent" className="text-base">
            {t('wizard:welcome.analytics.checkbox_label')}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('wizard:welcome.analytics.modal.description')}
          </p>
        </div>
        <Switch
          id="analyticsConsent"
          checked={analyticsConsent}
          onCheckedChange={setAnalyticsConsent}
        />
      </div>

      {/* What We Collect */}
      <div className="mt-6 space-y-4">
        <div>
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            {t('wizard:welcome.analytics.modal.collected_title')}
          </h3>
          <ul className="space-y-2 ml-6 list-disc text-sm text-muted-foreground">
            <li>{t('wizard:welcome.analytics.modal.collected_items.number_of_logins')}</li>
            <li>{t('wizard:welcome.analytics.modal.collected_items.mcp_count')}</li>
            <li>{t('wizard:welcome.analytics.modal.collected_items.conversation_count')}</li>
            <li>{t('wizard:welcome.analytics.modal.collected_items.providers_count')}</li>
            <li>{t('wizard:welcome.analytics.modal.collected_items.models_count')}</li>
            <li>{t('wizard:welcome.analytics.modal.collected_items.version_and_so_on')}</li>
          </ul>
        </div>

        {/* What We DON'T Collect */}
        <div>
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <XCircle className="h-4 w-4 text-red-600" />
            {t('wizard:welcome.analytics.modal.not_collected_title')}
          </h3>
          <ul className="space-y-2 ml-6 list-disc text-sm text-muted-foreground">
            <li>{t('wizard:welcome.analytics.modal.not_collected_items.conversation_content')}</li>
            <li>{t('wizard:welcome.analytics.modal.not_collected_items.personal_info')}</li>
          </ul>
        </div>

        {/* Anonymous ID explanation */}
        <Alert>
          <AlertDescription>
            {t('wizard:welcome.analytics.modal.anonymous_id')}
          </AlertDescription>
        </Alert>

        {anonymousId && (
          <div className="text-xs text-muted-foreground">
            {t('settings:privacy.your_id')}: <code className="bg-muted px-1 py-0.5 rounded">{anonymousId}</code>
          </div>
        )}
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-4 pt-4">
        <Button
          onClick={handleSave}
          disabled={saving}
          variant="outline"
          size="sm"
        >
          {saving ? t('settings:personalization.saving') : t('settings:security.save_button')}
        </Button>

        {saved && (
          <div className="flex items-center text-green-600 text-sm">
            <CheckCircle className="w-4 h-4 mr-1" />
            {t('settings:personalization.saved')}
          </div>
        )}
      </div>
    </SettingsSection>
  );
};
