import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { ModelSearchableSelect } from '@/components/ai-elements/model-searchable-select';
import { ToolsMenu } from '@/components/chat/ToolsMenu';
import { ContextPreview } from '@/components/chat/ContextPreview';
import { AddContextMenu } from '@/components/chat/AddContextMenu';
import { useTranslation } from 'react-i18next';
import type { Model } from '../../../types/models';
import type { ChatStatus } from 'ai';
import type { SelectedResource, SelectedPrompt, MCPResource, MCPPrompt } from '@/hooks/useMCPResources';

interface ChatPromptInputProps {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  enableMCP: boolean;
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
  fileAccept?: string;
  // MCP Resources props
  selectedResources?: SelectedResource[];
  onResourceSelected?: (serverId: string, serverName: string, resource: MCPResource) => void;
  onResourceRemove?: (serverId: string, uri: string) => void;
  // MCP Prompts props
  selectedPrompts?: SelectedPrompt[];
  onPromptSelected?: (serverId: string, serverName: string, prompt: MCPPrompt, args?: Record<string, any>) => void;
  onPromptRemove?: (serverId: string, name: string) => void;
}

export function ChatPromptInput({
  input,
  onInputChange,
  onSubmit,
  enableMCP,
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
  selectedResources = [],
  onResourceSelected,
  onResourceRemove,
  selectedPrompts = [],
  onPromptSelected,
  onPromptRemove,
}: ChatPromptInputProps) {
  const { t } = useTranslation('chat');

  // Check if we have any context to show
  const hasContext = attachedFiles.length > 0 || selectedResources.length > 0 || selectedPrompts.length > 0;

  // Handle file remove with null check
  const handleFileRemove = (index: number) => {
    if (onFileRemove) {
      onFileRemove(index);
    }
  };

  // Handle resource remove with null check
  const handleResourceRemove = (serverId: string, uri: string) => {
    if (onResourceRemove) {
      onResourceRemove(serverId, uri);
    }
  };

  // Handle prompt remove with null check
  const handlePromptRemove = (serverId: string, name: string) => {
    if (onPromptRemove) {
      onPromptRemove(serverId, name);
    }
  };

  return (
    <PromptInput onSubmit={onSubmit} className="max-w-3xl mx-auto w-full p-2">
      {/* Context Preview Area (files + MCP resources + MCP prompts) */}
      {hasContext && (
        <ContextPreview
          resources={selectedResources}
          prompts={selectedPrompts}
          files={attachedFiles}
          onRemoveResource={handleResourceRemove}
          onRemovePrompt={handlePromptRemove}
          onRemoveFile={handleFileRemove}
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
            enableMCP={enableMCP}
            onMCPChange={onMCPChange}
          />
          {/* Add Context Menu (MCP resources + prompts + file upload) */}
          {onFilesSelected && (
            <AddContextMenu
              onFilesSelected={onFilesSelected}
              onResourceSelected={onResourceSelected}
              onPromptSelected={onPromptSelected}
              disabled={status === 'streaming'}
              fileAccept={fileAccept}
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
            disabled={status !== 'streaming' && !input && attachedFiles.length === 0 && selectedResources.length === 0 && selectedPrompts.length === 0}
            status={status}
          />
        </div>
      </PromptInputToolbar>
    </PromptInput>
  );
}
