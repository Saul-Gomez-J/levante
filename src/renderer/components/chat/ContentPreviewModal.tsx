/**
 * ContentPreviewModal Component
 *
 * Modal for previewing the content of selected MCP resources or prompts.
 * Supports text content and images.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { FileText, MessageSquare, Server, Image as ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SelectedResource, SelectedPrompt } from '@/hooks/useMCPResources';

interface ContentPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource?: SelectedResource | null;
  prompt?: SelectedPrompt | null;
}

export function ContentPreviewModal({
  open,
  onOpenChange,
  resource,
  prompt,
}: ContentPreviewModalProps) {
  const { t } = useTranslation('chat');

  // Determine what we're showing
  const isResource = !!resource;
  const isPrompt = !!prompt;

  if (!resource && !prompt) return null;

  const title = isResource ? resource?.resource.name : prompt?.prompt.name;
  const serverName = isResource ? resource?.serverName : prompt?.serverName;
  const status = isResource ? resource?.status : prompt?.status;
  const error = isResource ? resource?.error : prompt?.error;

  // Get content to display
  const getContent = () => {
    if (isResource && resource?.content) {
      return resource.content.contents.map((c, i) => {
        if (c.text) {
          return (
            <div key={i} className="whitespace-pre-wrap text-sm font-mono bg-muted p-3 rounded-md">
              {c.text}
            </div>
          );
        }
        if (c.mimeType?.startsWith('image/') && c.blob) {
          // Convert blob to data URL for display
          const base64 = btoa(
            new Uint8Array(c.blob as ArrayBuffer).reduce(
              (data, byte) => data + String.fromCharCode(byte),
              ''
            )
          );
          return (
            <img
              key={i}
              src={`data:${c.mimeType};base64,${base64}`}
              alt={resource.resource.name}
              className="max-w-full rounded-md"
            />
          );
        }
        return null;
      });
    }

    if (isPrompt && prompt?.result) {
      return prompt.result.messages.map((m, i) => (
        <div key={i} className="space-y-1">
          <Badge variant="outline" className="text-xs">
            {m.role}
          </Badge>
          {m.content.type === 'text' && m.content.text && (
            <div className="whitespace-pre-wrap text-sm bg-muted p-3 rounded-md">
              {m.content.text}
            </div>
          )}
          {m.content.type === 'image' && m.content.data && (
            <img
              src={`data:${m.content.mimeType || 'image/png'};base64,${m.content.data}`}
              alt="Prompt content"
              className="max-w-full rounded-md"
            />
          )}
        </div>
      ));
    }

    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isResource ? (
              <FileText className="size-4 text-muted-foreground" />
            ) : (
              <MessageSquare className="size-4 text-muted-foreground" />
            )}
            {title}
          </DialogTitle>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Server className="size-3" />
            <span>{serverName}</span>
            {status === 'loading' && (
              <Badge variant="secondary">{t('preview_modal.loading', 'Loading...')}</Badge>
            )}
            {status === 'error' && (
              <Badge variant="destructive">{t('preview_modal.error', 'Error')}</Badge>
            )}
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            {status === 'loading' && (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <div className="animate-pulse">{t('preview_modal.loading_content', 'Loading content...')}</div>
              </div>
            )}

            {status === 'error' && (
              <div className="text-destructive text-sm p-4 bg-destructive/10 rounded-md">
                {error || t('preview_modal.error_loading', 'Failed to load content')}
              </div>
            )}

            {status === 'loaded' && getContent()}

            {status === 'loaded' && !getContent() && (
              <div className="text-muted-foreground text-sm text-center py-8">
                {t('preview_modal.no_content', 'No content available')}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
