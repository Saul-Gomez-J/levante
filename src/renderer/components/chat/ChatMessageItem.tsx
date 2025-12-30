/**
 * ChatMessageItem Component
 *
 * Renders a single chat message with all its parts including:
 * - Text content
 * - Reasoning blocks
 * - Tool calls with UI resources
 * - Attachments (images, audio, video)
 * - Sources from web search
 */

import { Message, MessageContent } from '@/components/ai-elements/message';
import { Response } from '@/components/ai-elements/response';
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '@/components/ai-elements/source';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning';
import { ToolCall } from '@/components/ai-elements/tool-call';
import { UIResourceMessage } from '@/components/chat/UIResourceMessage';
import { MessageAttachments } from '@/components/chat/MessageAttachments';
import { extractUIResources } from '@/types/ui-resource';
import { cn } from '@/lib/utils';
import { getRendererLogger } from '@/services/logger';
import type { UIMessage } from '@ai-sdk/react';

const logger = getRendererLogger();

// ============================================================================
// Types
// ============================================================================

interface ChatMessageItemProps {
  message: UIMessage;
  isStreaming: boolean;
  onPrompt: (prompt: string) => void;
  onSendMessage?: (text: string) => void;
  chatMessages?: UIMessage[];
}

// ============================================================================
// Component
// ============================================================================

export function ChatMessageItem({ message, isStreaming, onPrompt, onSendMessage, chatMessages }: ChatMessageItemProps) {
  const isAssistant = message.role === 'assistant';
  const isUser = message.role === 'user';

  return (
    <div>
      {/* Sources (web search results) */}
      {isAssistant && message.parts && (
        <Sources>
          {message.parts
            .filter((part: any) => part?.value?.type === 'source-url')
            .map((part: any, i: number) => (
              <>
                <SourcesTrigger
                  key={`trigger-${message.id}-${i}`}
                  count={
                    message.parts!.filter((p: any) => p.value?.type === 'source-url').length
                  }
                />
                <SourcesContent key={`content-${message.id}-${i}`}>
                  <Source href={part.value.url} title={part.value.title || part.value.url} />
                </SourcesContent>
              </>
            ))}
        </Sources>
      )}

      {/* Message */}
      <Message
        from={message.role}
        key={message.id}
        className={cn(
          'p-0',
          isUser ? 'is-user my-6' : 'is-assistant'
        )}
      >
        <MessageContent
          from={message.role}
          className={cn(
            '',
            isUser ? 'p-2 mb-0 dark:text-white' : 'px-2 py-0'
          )}
        >
          {/* Render attachments if present */}
          {(message as any).attachments && (message as any).attachments.length > 0 && (
            <MessageAttachments attachments={(message as any).attachments} />
          )}

          {/* Debug: Log message structure */}
          {(() => {
            if ((message as any).attachments?.length > 0) {
              logger.core.debug('Rendering message with attachments', {
                messageId: message.id,
                role: message.role,
                attachmentCount: (message as any).attachments.length,
                attachments: (message as any).attachments,
                partsCount: message.parts?.length || 0,
              });
            }
            return null;
          })()}

          {/* Render all reasoning parts as a single component */}
          {(() => {
            const reasoningParts = message.parts?.filter((p: any) => p?.type === 'data-reasoning') || [];

            if (reasoningParts.length > 0) {
              // Combine all reasoning text from multiple blocks
              // Filter out empty strings and empty objects like "{}"
              const combinedReasoning = reasoningParts
                .map((p: any) => p.data?.text || '')
                .filter(text => {
                  // Skip empty strings, whitespace-only, and empty object representations
                  const trimmed = text.trim();
                  return trimmed.length > 0 && trimmed !== '{}' && trimmed !== '[]';
                })
                .join('\n\n---\n\n'); // Separate multiple reasoning blocks with a divider

              // Only show reasoning component if there's actual content
              if (combinedReasoning && combinedReasoning.trim().length > 0) {
                return (
                  <Reasoning
                    key={`${message.id}-reasoning`}
                    className="w-full"
                    isStreaming={isStreaming}
                  >
                    <ReasoningTrigger />
                    <ReasoningContent>
                      {combinedReasoning}
                    </ReasoningContent>
                  </Reasoning>
                );
              }
            }
            return null;
          })()}

          {message.parts?.map((part: any, i: number) => {
            try {
              // Skip reasoning parts (already rendered above)
              if (part?.type === 'data-reasoning') {
                return null;
              }

              // Text content
              if (part?.type === 'text' && part?.text) {
                const trimmedText = part.text.trim();

                // Filter out empty JSON objects/arrays that some models emit
                // (e.g., Gemini 3 with thinkingConfig outputs "{}" as text)
                if (trimmedText === '{}' || trimmedText === '[]') {
                  logger.aiSdk.debug('🚫 Skipping empty JSON text part', {
                    messageId: message.id,
                    partIndex: i,
                    content: trimmedText,
                  });
                  return null;
                }

                // Debug: Log text parts that look like JSON (potential tool echo)
                if (trimmedText.startsWith('{') || trimmedText.startsWith('[')) {
                  logger.aiSdk.debug('🔍 Rendering text part that looks like JSON', {
                    messageId: message.id,
                    partIndex: i,
                    preview: trimmedText.substring(0, 200),
                    length: trimmedText.length,
                  });
                }

                return (
                  <Response key={`${message.id}-${i}`}>
                    {part.text}
                  </Response>
                );
              }

              // Tool calls (MCP)
              if (part?.type?.startsWith('tool-')) {
                return (
                  <ToolCallPart
                    key={`${message.id}-${i}`}
                    part={part}
                    messageId={message.id}
                    onPrompt={onPrompt}
                    onSendMessage={onSendMessage}
                    chatMessages={chatMessages}
                  />
                );
              }

              // Check for standalone UI resource parts (data parts)
              if (part?.value?.type === 'ui-resource' && part?.value?.resource) {
                return (
                  <UIResourceMessage
                    key={`${message.id}-${i}`}
                    resource={part.value.resource}
                    className="w-full"
                    onPrompt={onPrompt}
                  />
                );
              }

              return null;
            } catch (error) {
              console.error('[ChatMessageItem] Error rendering part:', error, {
                messageId: message.id,
                partIndex: i,
                part,
              });
              return null;
            }
          })}
        </MessageContent>
      </Message>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

interface ToolCallPartProps {
  part: any;
  messageId: string;
  onPrompt: (prompt: string) => void;
  onSendMessage?: (text: string) => void;
  chatMessages?: UIMessage[];
}

function ToolCallPart({ part, messageId, onPrompt, onSendMessage, chatMessages }: ToolCallPartProps) {
  // Extract tool name from type if toolName field is not available
  // During streaming, AI SDK v5 doesn't include toolName field
  // Format: "tool-{toolName}" -> extract toolName
  const toolName = part.toolName || part.type.replace(/^tool-/, '');

  // Map part states to ToolCall status
  let status: 'pending' | 'running' | 'success' | 'error' = 'pending';
  if (part.state === 'input-start') {
    status = 'pending';
  } else if (part.state === 'input-available') {
    status = 'running';
  } else if (part.state === 'output-available') {
    status = 'success';
  } else if (part.state === 'output-error') {
    status = 'error';
  }

  const toolCall = {
    id: part.toolCallId,
    name: toolName,
    arguments: part.input || {},
    result: part.state === 'output-available' ? {
      success: true,
      content: part.output, // Keep original type (object or string)
    } : part.state === 'output-error' ? {
      success: false,
      error: part.errorText,
    } : undefined,
    status,
  };

  // Check if tool output contains UI resources
  const uiResources = part.state === 'output-available'
    ? extractUIResources(part.output)
    : [];

  // Extract serverId from toolName (format: serverId_toolName)
  const toolNameParts = toolName.split('_');
  const serverId = toolNameParts.length > 1 ? toolNameParts[0] : undefined;

  return (
    <div className="w-full">
      <ToolCall
        toolCall={toolCall}
        className="w-full"
      />
      {/* Render UI Resources from tool output - separated from tool call */}
      {uiResources.length > 0 && (
        <div className="my-4">
          {uiResources.map((resource, resourceIdx) => (
            <UIResourceMessage
              key={`${messageId}-ui-${resourceIdx}`}
              resource={resource}
              serverId={serverId}
              className="w-full"
              onPrompt={onPrompt}
              onSendMessage={onSendMessage}
              chatMessages={chatMessages}
            />
          ))}
        </div>
      )}
    </div>
  );
}
