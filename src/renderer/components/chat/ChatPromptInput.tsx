import {
  PromptInput,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { ModelSearchableSelect } from '@/components/ai-elements/model-searchable-select';
import { ToolsMenu } from '@/components/chat/ToolsMenu';
import { AttachmentButton, FilePreview } from '@/components/chat/FileAttachmentComponents';
import { useTranslation } from 'react-i18next';
import type { Model } from '../../../types/models';
import type { ChatStatus } from 'ai';

interface ChatPromptInputProps {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  webSearch: boolean;
  enableMCP: boolean;
  onWebSearchChange: (enabled: boolean) => void;
  onMCPChange: (enabled: boolean) => void;
  model: string;
  onModelChange: (modelId: string) => void;
  availableModels: Model[];
  modelsLoading: boolean;
  status?: ChatStatus;
  // File attachment props
  attachedFiles?: File[];
  onFilesSelected?: (files: File[]) => void;
  onFileRemove?: (index: number) => void;
  enableFileAttachment?: boolean;
  fileAccept?: string; // MIME types accepted
  fileAttachmentTitle?: string; // Tooltip for attachment button
}

export function ChatPromptInput({
  input,
  onInputChange,
  onSubmit,
  webSearch,
  enableMCP,
  onWebSearchChange,
  onMCPChange,
  model,
  onModelChange,
  availableModels,
  modelsLoading,
  status,
  attachedFiles = [],
  onFilesSelected,
  onFileRemove,
  enableFileAttachment = false,
  fileAccept = 'image/*,audio/*',
  fileAttachmentTitle = 'Attach files',
}: ChatPromptInputProps) {
  const { t } = useTranslation('chat');

  return (
    <PromptInput onSubmit={onSubmit} className="max-w-3xl mx-auto w-full p-2">
      {/* File Preview Area */}
      {enableFileAttachment && attachedFiles.length > 0 && onFileRemove && (
        <FilePreview
          files={attachedFiles}
          onRemove={onFileRemove}
          className="border-b"
        />
      )}

      {/* Text Input */}
      <PromptInputTextarea
        onChange={(e) => onInputChange(e.target.value)}
        value={input}
        rows={1}
        className="p-2 border-none"
        placeholder={t('input.placeholder')}
      />

      {/* Toolbar */}
      <PromptInputToolbar className="p-0 border-none">
        <PromptInputTools>
          <ToolsMenu
            webSearch={webSearch}
            enableMCP={enableMCP}
            onWebSearchChange={onWebSearchChange}
            onMCPChange={onMCPChange}
          />
          {/* Attachment Button */}
          {enableFileAttachment && onFilesSelected && (
            <AttachmentButton
              onFilesSelected={onFilesSelected}
              disabled={status === 'streaming'}
              accept={fileAccept}
              title={fileAttachmentTitle}
            />
          )}
        </PromptInputTools>
        <div className="flex items-center gap-2">
          <ModelSearchableSelect
            value={model}
            onValueChange={onModelChange}
            models={availableModels}
            loading={modelsLoading}
            placeholder={availableModels.length === 0 ? t('model_selector.no_models') : t('model_selector.label')}
          />
          <PromptInputSubmit
            disabled={status !== 'streaming' && !input && attachedFiles.length === 0}
            status={status}
          />
        </div>
      </PromptInputToolbar>
    </PromptInput>
  );
}
