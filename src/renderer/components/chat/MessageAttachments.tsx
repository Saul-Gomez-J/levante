/**
 * MessageAttachments Component
 *
 * Renders file attachments (images, audio) in chat messages.
 * Loads attachment data URLs from storage and displays them.
 */

import { useState, useEffect } from 'react';
import { ImageIcon, MicIcon, VideoIcon, Loader2Icon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MessageAttachment } from '../../../types/database';
import { getRendererLogger } from '@/services/logger';

const logger = getRendererLogger();

interface MessageAttachmentsProps {
  attachments: MessageAttachment[];
  className?: string;
}

export function MessageAttachments({
  attachments,
  className,
}: MessageAttachmentsProps) {
  const [loadedAttachments, setLoadedAttachments] = useState<MessageAttachment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAttachments = async () => {
      try {
        setLoading(true);
        logger.core.debug('Loading attachments from disk', {
          count: attachments.length,
          attachments: attachments.map(a => ({
            id: a.id,
            type: a.type,
            filename: a.filename,
            hasDataUrl: !!a.dataUrl,
          })),
        });

        const result = await window.levante.attachments.loadMany(attachments);

        if (result.success && result.data) {
          setLoadedAttachments(result.data);
          logger.core.info('Attachments loaded successfully', {
            count: result.data.length,
            loadedAttachments: result.data.map(a => ({
              id: a.id,
              type: a.type,
              filename: a.filename,
              hasDataUrl: !!a.dataUrl,
              dataUrlLength: a.dataUrl?.length || 0,
            })),
          });
        } else {
          logger.core.error('Failed to load attachments', { error: result.error });
        }
      } catch (error) {
        logger.core.error('Error loading attachments', {
          error: error instanceof Error ? error.message : error,
        });
      } finally {
        setLoading(false);
      }
    };

    if (attachments.length > 0) {
      logger.core.debug('MessageAttachments: Starting to load', { count: attachments.length });
      loadAttachments();
    } else {
      logger.core.debug('MessageAttachments: No attachments to load');
      setLoading(false);
    }
  }, [attachments]);

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 text-muted-foreground', className)}>
        <Loader2Icon className="size-4 animate-spin" />
        <span className="text-sm">Loading attachments...</span>
      </div>
    );
  }

  if (loadedAttachments.length === 0) {
    return null;
  }

  return (
    <div className={cn('flex flex-col gap-2 my-2', className)}>
      {loadedAttachments.map((attachment, index) => (
        <AttachmentItem key={attachment.id || index} attachment={attachment} />
      ))}
    </div>
  );
}

// ============================================================================
// AttachmentItem - Renders individual attachment based on type
// ============================================================================

interface AttachmentItemProps {
  attachment: MessageAttachment;
}

function AttachmentItem({ attachment }: AttachmentItemProps) {
  const isImage = attachment.type === 'image';
  const isAudio = attachment.type === 'audio';
  const isVideo = attachment.type === 'video';

  if (isImage && attachment.dataUrl) {
    return (
      <div className="rounded-lg border bg-card overflow-hidden max-w-xs sm:max-w-sm">
        <a
          href={attachment.dataUrl}
          target="_blank"
          rel="noreferrer"
          download={attachment.filename}
          className="block group cursor-zoom-in"
        >
          <img
            src={attachment.dataUrl}
            alt={attachment.filename}
            className="w-full h-auto object-cover max-h-64 transition group-hover:brightness-110"
            loading="lazy"
          />
        </a>
        <div className="p-2 border-t bg-muted/50">
          <p className="text-xs text-muted-foreground truncate">
            {attachment.filename}
          </p>
        </div>
      </div>
    );
  }

  if (isAudio && attachment.dataUrl) {
    return (
      <div className="rounded-lg border bg-card p-3 max-w-md">
        <div className="flex items-center gap-2 mb-2">
          <MicIcon className="size-4 text-muted-foreground" />
          <p className="text-sm font-medium truncate">{attachment.filename}</p>
        </div>
        <audio controls className="w-full">
          <source src={attachment.dataUrl} type={attachment.mimeType} />
          Your browser does not support the audio element.
        </audio>
      </div>
    );
  }

  if (isVideo && attachment.dataUrl) {
    return (
      <div className="rounded-lg border bg-card overflow-hidden max-w-md">
        <video controls className="w-full max-h-80 bg-black">
          <source src={attachment.dataUrl} type={attachment.mimeType} />
          Your browser does not support the video element.
        </video>
        <div className="p-2 border-t bg-muted/50">
          <div className="flex items-center gap-2">
            <VideoIcon className="size-3 text-muted-foreground" />
            <p className="text-xs text-muted-foreground truncate">
              {attachment.filename}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Fallback for attachments without data URL
  return (
    <div className="rounded-lg border bg-card p-3 max-w-md">
      <div className="flex items-center gap-2">
        <ImageIcon className="size-4 text-muted-foreground" />
        <p className="text-sm truncate">{attachment.filename}</p>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {formatFileSize(attachment.size)}
      </p>
    </div>
  );
}

// ============================================================================
// Utilities
// ============================================================================

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
