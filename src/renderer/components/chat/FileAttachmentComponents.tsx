/**
 * File Attachment Components
 *
 * Components for handling file attachments in chat:
 * - AttachmentButton: Button to trigger file selection
 * - FilePreview: Display selected files with remove option
 * - FilePreviewItem: Individual file preview card
 */

import { Button } from '@/components/ui/button';
import { PaperclipIcon, XIcon, ImageIcon, MicIcon, VideoIcon, FileTextIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MessageAttachment } from '../../../types/database';

// ============================================================================
// AttachmentButton - Button to trigger file upload
// ============================================================================

interface AttachmentButtonProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  disabled?: boolean;
  multiple?: boolean;
  title?: string; // Tooltip to show accepted file types
}

export function AttachmentButton({
  onFilesSelected,
  accept = 'image/*,audio/*,video/*',
  disabled = false,
  multiple = true,
  title,
}: AttachmentButtonProps) {
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onFilesSelected(files);
    }
    // Reset input to allow selecting the same file again
    e.target.value = '';
  };

  return (
    <>
      <input
        type="file"
        id="file-upload"
        className="hidden"
        accept={accept}
        multiple={multiple}
        onChange={handleFileSelect}
        disabled={disabled}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => document.getElementById('file-upload')?.click()}
        disabled={disabled}
        title={title || 'Attach files'}
      >
        <PaperclipIcon className="size-4" />
      </Button>
    </>
  );
}

// ============================================================================
// FilePreview - Container for multiple file previews
// ============================================================================

interface FilePreviewProps {
  files: (File | MessageAttachment)[];
  onRemove: (index: number) => void;
  className?: string;
}

export function FilePreview({ files, onRemove, className }: FilePreviewProps) {
  if (files.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-2 p-2', className)}>
      {files.map((file, index) => (
        <FilePreviewItem
          key={index}
          file={file}
          onRemove={() => onRemove(index)}
        />
      ))}
    </div>
  );
}

// ============================================================================
// FilePreviewItem - Individual file preview card
// ============================================================================

interface FilePreviewItemProps {
  file: File | MessageAttachment;
  onRemove: () => void;
}

function FilePreviewItem({ file, onRemove }: FilePreviewItemProps) {
  const isFile = file instanceof File;
  const filename = isFile ? file.name : file.filename;
  const mimeType = isFile ? file.type : file.mimeType;
  const size = isFile ? file.size : file.size;

  // Determine file type icon
  const isImage = mimeType.startsWith('image/');
  const isAudio = mimeType.startsWith('audio/');
  const isVideo = mimeType.startsWith('video/');
  const isPDF = mimeType === 'application/pdf';
  const Icon = isImage ? ImageIcon : isVideo ? VideoIcon : isAudio ? MicIcon : isPDF ? FileTextIcon : PaperclipIcon;

  // Create preview URL for images and videos
  const previewUrl = isFile && (isImage || isVideo) ? URL.createObjectURL(file) : null;

  return (
    <div
      className={cn(
        'relative flex items-center gap-2 rounded-lg border bg-card p-2',
        'min-w-[160px] max-w-[200px]'
      )}
    >
      {/* Preview or Icon */}
      <div className="shrink-0">
        {previewUrl && isImage ? (
          <img
            src={previewUrl}
            alt={filename}
            className="size-10 rounded object-cover"
            onLoad={() => {
              // Cleanup blob URL after image loads
              if (previewUrl) URL.revokeObjectURL(previewUrl);
            }}
          />
        ) : previewUrl && isVideo ? (
          <video
            src={previewUrl}
            className="size-10 rounded object-cover"
            onLoadedData={() => {
              // Cleanup blob URL after video loads
              if (previewUrl) URL.revokeObjectURL(previewUrl);
            }}
          />
        ) : (
          <div className="flex size-10 items-center justify-center rounded bg-muted">
            <Icon className="size-5 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* File info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{filename}</p>
        <p className="text-xs text-muted-foreground">
          {formatFileSize(size)}
        </p>
      </div>

      {/* Remove button */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute -right-2 -top-2 size-5 rounded-full bg-background shadow-sm hover:bg-destructive hover:text-destructive-foreground"
        onClick={onRemove}
      >
        <XIcon className="size-3" />
      </Button>
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
