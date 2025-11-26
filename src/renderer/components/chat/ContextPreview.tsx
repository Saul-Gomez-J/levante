/**
 * ContextPreview Component
 *
 * Displays a preview of all context items that will be sent with the chat message:
 * - Selected MCP resources (with loading/error states)
 * - Selected MCP prompts (with loading/error states)
 * - Attached files
 *
 * Clicking on MCP items opens a preview modal.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { X, FileText, File, Loader2, AlertCircle, Server, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { SelectedResource, SelectedPrompt } from '@/hooks/useMCPResources';
import type { MessageAttachment } from '../../../types/database';
import { ContentPreviewModal } from './ContentPreviewModal';

interface ContextPreviewProps {
  resources: SelectedResource[];
  prompts?: SelectedPrompt[];
  files: (File | MessageAttachment)[];
  onRemoveResource: (serverId: string, uri: string) => void;
  onRemovePrompt?: (serverId: string, name: string) => void;
  onRemoveFile: (index: number) => void;
  className?: string;
}

export function ContextPreview({
  resources,
  prompts = [],
  files,
  onRemoveResource,
  onRemovePrompt,
  onRemoveFile,
  className,
}: ContextPreviewProps) {
  const { t } = useTranslation('chat');

  // Preview modal state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewResource, setPreviewResource] = useState<SelectedResource | null>(null);
  const [previewPrompt, setPreviewPrompt] = useState<SelectedPrompt | null>(null);

  // Don't render if nothing to show
  if (resources.length === 0 && prompts.length === 0 && files.length === 0) {
    return null;
  }

  const handleResourceClick = (resource: SelectedResource) => {
    setPreviewResource(resource);
    setPreviewPrompt(null);
    setPreviewOpen(true);
  };

  const handlePromptClick = (prompt: SelectedPrompt) => {
    setPreviewPrompt(prompt);
    setPreviewResource(null);
    setPreviewOpen(true);
  };

  return (
    <>
      <div className={cn('flex flex-wrap gap-2 p-2 border-b', className)}>
        {/* MCP Resources */}
        {resources.map(r => (
          <ResourcePreviewItem
            key={`${r.serverId}-${r.resource.uri}`}
            resource={r}
            onRemove={() => onRemoveResource(r.serverId, r.resource.uri)}
            onClick={() => handleResourceClick(r)}
          />
        ))}

        {/* MCP Prompts */}
        {prompts.map(p => (
          <PromptPreviewItem
            key={`${p.serverId}-${p.prompt.name}`}
            prompt={p}
            onRemove={() => onRemovePrompt?.(p.serverId, p.prompt.name)}
            onClick={() => handlePromptClick(p)}
          />
        ))}

        {/* Attached Files */}
        {files.map((file, index) => (
          <FilePreviewItem
            key={`file-${index}`}
            file={file}
            onRemove={() => onRemoveFile(index)}
          />
        ))}
      </div>

      {/* Preview Modal */}
      <ContentPreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        resource={previewResource}
        prompt={previewPrompt}
      />
    </>
  );
}

// ============================================================================
// ResourcePreviewItem - Individual MCP resource preview
// ============================================================================

interface ResourcePreviewItemProps {
  resource: SelectedResource;
  onRemove: () => void;
  onClick?: () => void;
}

function ResourcePreviewItem({ resource, onRemove, onClick }: ResourcePreviewItemProps) {
  const { t } = useTranslation('chat');

  // Determine icon based on status
  const getStatusIcon = () => {
    switch (resource.status) {
      case 'loading':
        return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />;
      case 'error':
        return <AlertCircle className="size-3.5 text-destructive" />;
      default:
        return <FileText className="size-3.5 text-muted-foreground" />;
    }
  };

  // Status-based styling
  const getStatusClass = () => {
    switch (resource.status) {
      case 'error':
        return 'border-destructive/50 bg-destructive/5';
      case 'loading':
        return 'opacity-70';
      default:
        return '';
    }
  };

  return (
    <div
      className={cn(
        'relative flex items-center gap-1.5 px-2 py-1 rounded-md text-sm border bg-card',
        'max-w-[200px]',
        onClick && 'cursor-pointer hover:bg-accent',
        getStatusClass()
      )}
      title={resource.error || resource.resource.description || resource.resource.uri}
      onClick={onClick}
    >
      {/* Status/Type Icon */}
      {getStatusIcon()}

      {/* Resource Info */}
      <div className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">
          {resource.resource.name}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Server className="size-2.5" />
          <span className="truncate">{resource.serverName}</span>
        </span>
      </div>

      {/* Remove button */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-4 shrink-0 rounded-full hover:bg-destructive hover:text-destructive-foreground"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}

// ============================================================================
// PromptPreviewItem - Individual MCP prompt preview
// ============================================================================

interface PromptPreviewItemProps {
  prompt: SelectedPrompt;
  onRemove: () => void;
  onClick?: () => void;
}

function PromptPreviewItem({ prompt, onRemove, onClick }: PromptPreviewItemProps) {
  const { t } = useTranslation('chat');

  // Determine icon based on status
  const getStatusIcon = () => {
    switch (prompt.status) {
      case 'loading':
        return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />;
      case 'error':
        return <AlertCircle className="size-3.5 text-destructive" />;
      default:
        return <MessageSquare className="size-3.5 text-blue-500" />;
    }
  };

  // Status-based styling
  const getStatusClass = () => {
    switch (prompt.status) {
      case 'error':
        return 'border-destructive/50 bg-destructive/5';
      case 'loading':
        return 'opacity-70';
      default:
        return '';
    }
  };

  return (
    <div
      className={cn(
        'relative flex items-center gap-1.5 px-2 py-1 rounded-md text-sm border bg-card',
        'max-w-[200px]',
        onClick && 'cursor-pointer hover:bg-accent',
        getStatusClass()
      )}
      title={prompt.error || prompt.prompt.description || prompt.prompt.name}
      onClick={onClick}
    >
      {/* Status/Type Icon */}
      {getStatusIcon()}

      {/* Prompt Info */}
      <div className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">
          {prompt.prompt.name}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Server className="size-2.5" />
          <span className="truncate">{prompt.serverName}</span>
        </span>
      </div>

      {/* Remove button */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-4 shrink-0 rounded-full hover:bg-destructive hover:text-destructive-foreground"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}

// ============================================================================
// FilePreviewItem - Individual file preview (migrated from FileAttachmentComponents)
// ============================================================================

interface FilePreviewItemProps {
  file: File | MessageAttachment;
  onRemove: () => void;
}

function FilePreviewItem({ file, onRemove }: FilePreviewItemProps) {
  // Type guard: File has 'name' property, MessageAttachment has 'filename'
  const isNativeFile = 'name' in file && typeof (file as File).name === 'string' && 'arrayBuffer' in file;
  const filename = isNativeFile ? (file as File).name : (file as MessageAttachment).filename;
  const mimeType = isNativeFile ? (file as File).type : (file as MessageAttachment).mimeType;
  const size = file.size;

  // Get file type icon
  const Icon = mimeType.startsWith('image/')
    ? File
    : mimeType.startsWith('audio/')
    ? File
    : File;

  return (
    <div
      className={cn(
        'relative flex items-center gap-1.5 px-2 py-1 rounded-md text-sm border bg-card',
        'max-w-[200px]'
      )}
      title={filename}
    >
      {/* File Icon */}
      <Icon className="size-3.5 text-muted-foreground shrink-0" />

      {/* File Info */}
      <div className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{filename}</span>
        <span className="text-[10px] text-muted-foreground">
          {formatFileSize(size)}
        </span>
      </div>

      {/* Remove button */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-4 shrink-0 rounded-full hover:bg-destructive hover:text-destructive-foreground"
        onClick={onRemove}
      >
        <X className="size-3" />
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
