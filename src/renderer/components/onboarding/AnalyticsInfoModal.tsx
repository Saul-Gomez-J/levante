import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AnalyticsInfoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AnalyticsInfoModal({ open, onOpenChange }: AnalyticsInfoModalProps) {
  const { t } = useTranslation('wizard');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('welcome.analytics.modal.title')}</DialogTitle>
          <DialogDescription>
            {t('welcome.analytics.modal.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* What We Collect */}
          <div>
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              {t('welcome.analytics.modal.collected_title')}
            </h3>
            <ul className="space-y-2 ml-6 list-disc text-sm text-muted-foreground">
              <li>{t('welcome.analytics.modal.collected_items.number_of_logins')}</li>
              <li>{t('welcome.analytics.modal.collected_items.mcp_count')}</li>
              <li>{t('welcome.analytics.modal.collected_items.conversation_count')}</li>
              <li>{t('welcome.analytics.modal.collected_items.providers_count')}</li>
              <li>{t('welcome.analytics.modal.collected_items.models_count')}</li>
              <li>{t('welcome.analytics.modal.collected_items.version_and_so_on')}</li>
            </ul>
          </div>

          {/* What We DON'T Collect */}
          <div>
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-600" />
              {t('welcome.analytics.modal.not_collected_title')}
            </h3>
            <ul className="space-y-2 ml-6 list-disc text-sm text-muted-foreground">
              <li>{t('welcome.analytics.modal.not_collected_items.conversation_content')}</li>
              <li>{t('welcome.analytics.modal.not_collected_items.personal_info')}</li>
            </ul>
          </div>

          {/* Anonymous ID explanation */}
          <div className="p-3 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">
              {t('welcome.analytics.modal.anonymous_id')}
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => onOpenChange(false)}>
            {t('welcome.analytics.modal.close_button')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
