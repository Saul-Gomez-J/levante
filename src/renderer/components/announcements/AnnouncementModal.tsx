import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useTranslation } from 'react-i18next';
import { logger } from '@/services/logger';
import type { Announcement } from '@preload/types';

interface AnnouncementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  announcement: Announcement | null;
  onNavigate?: (page: string) => void;
}

export function AnnouncementModal({
  open,
  onOpenChange,
  announcement,
  onNavigate,
}: AnnouncementModalProps) {
  const { t } = useTranslation();
  const [isEnabling, setIsEnabling] = useState(false);

  if (!announcement) {
    return null;
  }

  const isPrivacyAnnouncement = announcement.category === 'privacy';

  // Handle clicks on interactive elements with data-action attribute
  const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const actionElement = target.closest('[data-action]');
    if (!actionElement) return;

    const action = actionElement.getAttribute('data-action');
    const href = actionElement.getAttribute('data-href');
    e.preventDefault();

    logger.core.debug('Announcement action clicked', { action, href });

    switch (action) {
      case 'navigate':
        if (href) {
          handleClose();
          onNavigate?.(href);
        }
        break;
      case 'deeplink':
        if (href) {
          handleClose();
          window.levante.openExternal(href);
        }
        break;
      default:
        logger.core.warn('Unknown announcement action', { action });
    }
  };

  const handleClose = async () => {
    try {
      await window.levante.announcements.markSeen(announcement.id, announcement.category);
      onOpenChange(false);
    } catch (error) {
      logger.core.error('Failed to mark announcement as seen', {
        error: error instanceof Error ? error.message : error
      });
      // Close anyway
      onOpenChange(false);
    }
  };

  const handleEnablePrivacy = async () => {
    setIsEnabling(true);
    try {
      await window.levante.announcements.enablePrivacy(announcement.id);
      onOpenChange(false);
    } catch (error) {
      logger.core.error('Failed to enable privacy', {
        error: error instanceof Error ? error.message : error
      });
    } finally {
      setIsEnabling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">
            {announcement.title}
          </DialogTitle>
        </DialogHeader>

        <Separator className="my-4" />

        <div
          className="prose prose-sm dark:prose-invert max-w-none announcement-content [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
          onClick={handleContentClick}
          dangerouslySetInnerHTML={{ __html: announcement.full_text }}
        />

        <div className="flex justify-end gap-3 mt-6">
          {isPrivacyAnnouncement && (
            <Button
              variant="default"
              onClick={handleEnablePrivacy}
              disabled={isEnabling}
            >
              {isEnabling ? t('common.loading', 'Loading...') : t('announcements.enablePrivacy', 'Enable Analytics')}
            </Button>
          )}
          <Button
            variant={isPrivacyAnnouncement ? 'outline' : 'default'}
            onClick={handleClose}
          >
            {t('common.close', 'Close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
