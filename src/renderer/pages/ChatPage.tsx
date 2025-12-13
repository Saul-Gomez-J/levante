/**
 * ChatPage - Refactored for AI SDK v5 (Simplified Architecture)
 *
 * This component uses the native useChat hook from @ai-sdk/react
 * without remounting when sessions change.
 *
 * Key changes:
 * - Single component, no remounting
 * - Uses setMessages to load session history
 * - Direct message sending on first message
 * - Simple session switching with useEffect
 * - File attachments extracted to useFileAttachments hook
 * - Message rendering extracted to ChatMessageItem component
 */

import { Message, MessageContent } from '@/components/ai-elements/message';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { StreamingProvider, useStreamingContext } from '@/contexts/StreamingContext';
import { ChatList } from '@/components/chat/ChatList';
import { WelcomeScreen } from '@/components/chat/WelcomeScreen';
import { ChatPromptInput } from '@/components/chat/ChatPromptInput';
import { ChatMessageItem } from '@/components/chat/ChatMessageItem';
import { useTranslation } from 'react-i18next';
import { BreathingLogo } from '@/components/ai-elements/breathing-logo';
import { getRendererLogger } from '@/services/logger';
import { cn } from '@/lib/utils';
import { useMCPResources } from '@/hooks/useMCPResources';
import { useFileAttachments } from '@/hooks/useFileAttachments';
import { useModelSelection, isInferenceModel } from '@/hooks/useModelSelection';
import { usePreference } from '@/hooks/usePreferences';

// AI SDK v5 imports
import { useChat } from '@ai-sdk/react';
import { createElectronChatTransport } from '@/transports/ElectronChatTransport';

const logger = getRendererLogger();

const ChatPage = () => {
  const { t } = useTranslation('chat');
  const [input, setInput] = useState('');
  const [enableMCP, setEnableMCP] = usePreference('enableMCP');
  const [userName, setUserName] = useState<string>(t('welcome.default_user_name'));
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [pendingFirstMessage, setPendingFirstMessage] = useState<string | null>(null);
  const [pendingFirstAttachments, setPendingFirstAttachments] = useState<File[] | null>(null);
  const [pendingMessageAfterStop, setPendingMessageAfterStop] = useState<string | null>(null);

  // MCP Resources hook
  const {
    selectedResources,
    selectResource,
    removeResource,
    selectedPrompts,
    selectPrompt,
    removePrompt,
    clearResources,
    getContextString,
  } = useMCPResources();

  // Chat store
  const currentSession = useChatStore((state) => state.currentSession);
  const persistMessage = useChatStore((state) => state.persistMessage);
  const createSession = useChatStore((state) => state.createSession);
  const loadHistoricalMessages = useChatStore((state) => state.loadHistoricalMessages);
  const pendingPrompt = useChatStore((state) => state.pendingPrompt);
  const setPendingPrompt = useChatStore((state) => state.setPendingPrompt);

  // Track previous session ID to detect changes
  const previousSessionIdRef = useRef<string | null>(null);

  // Track if we just created a new session (to avoid loading empty history)
  const justCreatedSessionRef = useRef(false);

  // Streaming context for mermaid processing
  const { triggerMermaidProcessing } = useStreamingContext();

  // Load user name callback
  const loadUserName = useCallback(async () => {
    try {
      const profile = await window.levante.profile.get();
      if (profile?.data?.personalization?.nickname) {
        setUserName(profile.data.personalization.nickname);
      }
    } catch (error) {
      console.error('Failed to load user name:', error);
    }
  }, []);

  // Model selection hook
  const {
    model,
    setModel,
    availableModels,
    filteredAvailableModels,
    modelsLoading,
    currentModelInfo,
    modelTaskType,
    handleModelChange,
  } = useModelSelection({
    currentSession,
    onLoadUserName: loadUserName,
  });

  // File attachments hook
  const {
    attachedFiles,
    isDragging,
    setAttachedFiles,
    handleFilesSelected,
    handleFileRemove,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    processAttachments,
    convertFilesToInferenceData,
    getFileAccept,
    supportsFileAttachment: enableFileAttachment,
    clearAttachments,
  } = useFileAttachments({
    modelTaskType,
    modelCapabilities: currentModelInfo?.capabilities,
    isStreaming: false, // Will be updated after useChat
  });

  /* 140 */   const attachFilesToLatestUserMessage = (attachments: Array<{
  /* 141 */     id: string;
  /* 142 */     type: 'image' | 'audio' | 'video' | 'document';
  /* 143 */     filename: string;
  /* 144 */     mimeType: string;
  /* 145 */     size: number;
  /* 146 */     storagePath: string;
    /* 147 */
}>) => {
    if (!attachments || attachments.length === 0) {
      return;
    }

    setMessages((prev) => {
      const lastUserIndex = [...prev].map((m) => m.role).lastIndexOf('user');
      if (lastUserIndex === -1) {
        return prev;
      }

      const updated = [...prev];
      updated[lastUserIndex] = {
        ...(updated[lastUserIndex] as any),
        attachments
      };

      return updated;
    });
  };

  // Create transport with current configuration
  const transport = useMemo(
    () =>
      createElectronChatTransport({
        model: model || 'openai/gpt-4o',
        enableMCP: enableMCP ?? true,
      }),
    [] // Keep same transport instance
  );

  // Update transport options when they change
  useEffect(() => {
    transport.updateOptions({
      model: model || 'openai/gpt-4o',
      enableMCP: enableMCP ?? true,
    });
  }, [model, enableMCP, transport]);

  // Use AI SDK native useChat hook
  const {
    messages,
    setMessages,
    sendMessage: sendMessageAI,
    status,
    stop,
    error: chatError,
  } = useChat({
    id: currentSession?.id || 'new-chat',
    transport,

    // Persist messages after AI finishes
    onFinish: async ({ message }) => {
      logger.aiSdk.info('AI response finished', {
        sessionId: currentSession?.id,
        messageId: message.id,
        messageRole: message.role,
        partsCount: message.parts?.length,
      });

      // Persist the AI response
      if (currentSession) {
        // Check for generated attachments in data parts
        const generatedAttachments: Array<{
          id: string;
          type: 'image' | 'audio' | 'video' | 'document';
          filename: string;
          mimeType: string;
          size: number;
          storagePath: string;
        }> = [];
        if (message.parts) {
          for (const part of message.parts) {
            // Check if this is a data part with generated-attachment
            if (part.type.startsWith('data-') && (part as any).data?.type === 'generated-attachment') {
              const attachmentData = (part as any).data;
              logger.core.info('Found generated attachment', {
                type: attachmentData.attachmentType,
                filename: attachmentData.filename,
              });

              // Convert dataURL to buffer and save
              try {
                const base64Data = attachmentData.dataUrl.split(',')[1];
                const buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

                const result = await window.levante.attachments.save(
                  currentSession.id,
                  message.id,
                  buffer.buffer,
                  attachmentData.filename,
                  attachmentData.mime
                );

                if (result.success && result.data) {
                  generatedAttachments.push({
                    ...result.data,
                    storagePath: result.data.path
                  });
                  logger.core.info('Generated attachment saved', {
                    attachmentId: result.data.id,
                    filename: attachmentData.filename,
                  });
                }
              } catch (error) {
                logger.core.error('Failed to save generated attachment', {
                  error: error instanceof Error ? error.message : error,
                });
              }
            }
          }
        }

        // Add generated attachments to message before persisting
        const messageWithAttachments = {
          ...message,
          attachments: generatedAttachments.length > 0 ? generatedAttachments : undefined,
        };

        logger.core.info('🚀 About to persist message', {
          messageId: message.id,
          role: message.role,
          hasAttachments: !!messageWithAttachments.attachments,
          attachmentCount: (messageWithAttachments.attachments as any)?.length || 0,
          attachments: messageWithAttachments.attachments,
        });

        await persistMessage(messageWithAttachments);

        // Update the message in useChat state to include attachments
        if (generatedAttachments.length > 0) {
          logger.core.info('Updating message state with attachments', {
            messageId: message.id,
            attachmentCount: generatedAttachments.length,
          });

          // Find and update the message in the messages array
          setMessages((prevMessages) =>
            prevMessages.map((m) =>
              m.id === message.id
                ? { ...m, attachments: generatedAttachments } as any
                : m
            )
          );
        }
      }

      // Trigger mermaid processing
      triggerMermaidProcessing();
    },
  });

  // Handle pending message after stop
  useEffect(() => {
    if (pendingMessageAfterStop && status !== 'streaming' && status !== 'submitted') {
      const messageText = pendingMessageAfterStop;
      setPendingMessageAfterStop(null);

      // Persist user message to database BEFORE sending to AI (to ensure correct order)
      const userMessage = {
        id: `user-${Date.now()}`,
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: messageText }],
        attachments: undefined,
      };

      persistMessage(userMessage)
        .then(() => {
          // Send the message after persisting
          sendMessageAI({ text: messageText });
        })
        .catch((err) => {
          logger.database.error('Failed to persist message after stop', { error: err });
        });
    }
  }, [pendingMessageAfterStop, status, sendMessageAI, persistMessage]);

  // Load messages when session changes
  useEffect(() => {
    const currentSessionId = currentSession?.id || null;
    const previousSessionId = previousSessionIdRef.current;

    // Skip if session hasn't changed
    if (currentSessionId === previousSessionId) {
      return;
    }

    // Update ref
    previousSessionIdRef.current = currentSessionId;

    // Clear attachments and MCP resources when changing sessions
    clearAttachments();
    clearResources();

    // If we just created this session, skip loading historical messages
    // (the messages are already in useChat state from sendMessageAI)
    if (justCreatedSessionRef.current) {
      logger.core.info('Session just created, skipping historical load', { sessionId: currentSessionId });
      justCreatedSessionRef.current = false;
      return;
    }

    // Load messages for the new session
    if (currentSessionId) {
      logger.core.info('Session changed, loading messages', { sessionId: currentSessionId });
      setIsLoadingMessages(true);

      loadHistoricalMessages(currentSessionId)
        .then((msgs) => {
          logger.core.info('Loaded historical messages', { count: msgs.length });
          setMessages(msgs);
          setIsLoadingMessages(false);
        })
        .catch((err) => {
          logger.core.error('Failed to load historical messages', { error: err });
          setMessages([]);
          setIsLoadingMessages(false);
        });
    } else {
      // No session (new chat) - clear messages
      logger.core.info('New chat started, clearing messages');
      setMessages([]);
    }
  }, [currentSession?.id, loadHistoricalMessages, setMessages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // If currently streaming
    if (status === 'streaming') {
      // If there's input, we want to stop current stream and send the new message
      if (input.trim()) {
        setPendingMessageAfterStop(input);
        setInput(''); // Clear input immediately
      }

      stop();
      return;
    }

    // Otherwise, send a new message
    if (input.trim() || attachedFiles.length > 0 || selectedResources.length > 0 || selectedPrompts.length > 0) {
      // DEBUG: Log attachments state at submit time
      logger.core.info('📤 handleSubmit called', {
        inputLength: input.length,
        attachedFilesCount: attachedFiles.length,
        attachedFileNames: attachedFiles.map(f => f.name),
        modelTaskType,
        enableFileAttachment,
      });

      // Build message text with MCP resource context if any
      const resourceContext = getContextString();
      const messageText = resourceContext
        ? `${resourceContext}\n\n${input}`
        : input;
      const filesToAttach = [...attachedFiles];
      const resourcesToInclude = [...selectedResources];

      try {
        setInput('');
        clearAttachments(); // Clear attachments immediately
        clearResources(); // Clear MCP resources immediately

        // If no session exists, create one and save message for later
        if (!currentSession) {
          // Determine session type based on model's taskType
          const currentModelInfo = availableModels.find((m) => m.id === model);
          const taskType = currentModelInfo?.taskType;
          const isInferenceModel = taskType && taskType !== 'chat' && taskType !== 'image-text-to-text';
          const sessionType = isInferenceModel ? 'inference' : 'chat';

          logger.core.info('Creating new session for first message', {
            model,
            taskType,
            sessionType
          });

          // Mark that we're about to create a session BEFORE actually creating it
          // This prevents the useEffect from loading empty history when currentSession updates
          justCreatedSessionRef.current = true;

          const newSession = await createSession('New Chat', model || 'openai/gpt-4o', sessionType);

          if (!newSession) {
            logger.core.error('Failed to create session');
            justCreatedSessionRef.current = false; // Reset flag on error
            setInput(messageText); // Restore input on error
            setAttachedFiles(filesToAttach); // Restore files
            return;
          }

          logger.core.info('Session created, storing pending message', {
            sessionId: newSession.id,
            sessionType: newSession.session_type
          });

          // Store message to send after re-render (when useChat has the correct ID)
          setPendingFirstMessage(messageText);
          setPendingFirstAttachments(filesToAttach.length > 0 ? filesToAttach : null);

          // Don't send now - wait for component to re-render with new session ID
          return;
        }

        // Generate message ID for attachments
        const messageId = `user-${Date.now()}`;

        // Process and save attachments if any
        let savedAttachments: Array<{
          id: string;
          type: 'image' | 'audio' | 'video' | 'document';
          filename: string;
          mimeType: string;
          size: number;
          storagePath: string;
        }> = [];
        let attachmentDataForInference: any[] = [];

        if (filesToAttach.length > 0) {
          logger.core.info('Processing attachments', {
            count: filesToAttach.length,
            sessionId: currentSession.id,
          });

          // Convert files to data for inference (before saving to disk)
          for (const file of filesToAttach) {
            const arrayBuffer = await file.arrayBuffer();
            const base64 = btoa(
              new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
            );
            const dataUrl = `data:${file.type};base64,${base64}`;

            attachmentDataForInference.push({
              type: file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'video',
              data: dataUrl,
              mime: file.type,
              filename: file.name
            });
          }

          // Save attachments to disk
          const processedAttachments = await processAttachments(
            filesToAttach,
            currentSession.id,
            messageId
          );

          // Add storagePath (which comes from 'path' in DB result)
          savedAttachments = processedAttachments.map(att => ({
            ...att,
            storagePath: att.path
          }));
        }

        // Send the message with attachments passed in the body
        logger.core.info('Sending message with attachments', {
          sessionId: currentSession.id,
          messageText: messageText.substring(0, 50) + '...',
          attachmentsCount: attachmentDataForInference.length,
          attachmentsData: attachmentDataForInference.map(a => ({
            type: a.type,
            filename: a.filename,
            dataLength: a.data?.length || 0
          }))
        });

        // Persist user message to database BEFORE sending to AI (to ensure correct order)
        const userMessage = {
          id: messageId,
          role: 'user' as const,
          parts: [{ type: 'text' as const, text: messageText }],
          attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
        };
        await persistMessage(userMessage);

        // Send to AI with attachments in the body
        // The ElectronChatTransport will pass these to the IPC layer
        await sendMessageAI(
          {
            text: messageText,
            experimental_attachments: attachmentDataForInference.length > 0 ? attachmentDataForInference as any : undefined
          } as any,
          {
            body: {
              attachments: attachmentDataForInference.length > 0 ? attachmentDataForInference : undefined
            }
          }
        );

        if (savedAttachments.length > 0) {
          attachFilesToLatestUserMessage(savedAttachments);
        }
      } catch (error) {
        logger.core.error('Error in handleSubmit', {
          error: error instanceof Error ? error.message : error,
        });
        // Restore files on error
        setAttachedFiles(filesToAttach);
      }
    }
  };

  // Handle pending first message after session creation
  useEffect(() => {
    if (pendingFirstMessage === null || !currentSession) {
      return;
    }

    const messageText = pendingFirstMessage;
    const attachmentFiles = pendingFirstAttachments || [];
    setPendingFirstMessage(null);
    setPendingFirstAttachments(null);

    logger.core.info('Sending pending first message', {
      sessionId: currentSession.id,
      messageLength: messageText.length,
      attachmentCount: attachmentFiles.length,
    });

    const sendPendingMessage = async () => {
      try {
        const messageId = `user-${Date.now()}`;
        let attachmentDataForInference: Array<{
          type: 'image' | 'audio' | 'video';
          data: string;
          mime: string;
          filename: string;
        }> = [];
        let savedAttachments: Array<{
          id: string;
          type: 'image' | 'audio' | 'video' | 'document';
          filename: string;
          mimeType: string;
          size: number;
          storagePath: string;
        }> = [];

        if (attachmentFiles.length > 0) {
          logger.core.info('Processing pending attachments', {
            count: attachmentFiles.length,
            sessionId: currentSession.id,
          });

          for (const file of attachmentFiles) {
            const arrayBuffer = await file.arrayBuffer();
            const base64 = btoa(
              new Uint8Array(arrayBuffer).reduce(
                (data, byte) => data + String.fromCharCode(byte),
                ''
              )
            );
            const dataUrl = `data:${file.type};base64,${base64}`;

            attachmentDataForInference.push({
              type: file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'video',
              data: dataUrl,
              mime: file.type,
              filename: file.name
            });
          }

          const processedAttachments = await processAttachments(
            attachmentFiles,
            currentSession.id,
            messageId
          );

          // Add storagePath (which comes from 'path' in DB result)
          savedAttachments = processedAttachments.map(att => ({
            ...att,
            storagePath: att.path
          }));
        }

        // Persist user message to database BEFORE sending to AI (to ensure correct order)
        const userMessage = {
          id: messageId,
          role: 'user' as const,
          parts: [{ type: 'text' as const, text: messageText }],
          attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
        };

        await persistMessage(userMessage);

        await sendMessageAI(
          {
            text: messageText,
            experimental_attachments: attachmentDataForInference.length > 0 ? attachmentDataForInference as any : undefined
          } as any,
          {
            body: {
              attachments: attachmentDataForInference.length > 0 ? attachmentDataForInference : undefined
            }
          }
        );

        if (savedAttachments.length > 0) {
          attachFilesToLatestUserMessage(savedAttachments);
        }
      } catch (error) {
        logger.core.error('Failed to send pending first message', {
          error: error instanceof Error ? error.message : error,
          sessionId: currentSession.id,
        });

        setInput(messageText);
        if (attachmentFiles.length > 0) {
          setAttachedFiles(attachmentFiles);
        }
      }
    };

    void sendPendingMessage();
  }, [
    pendingFirstMessage,
    pendingFirstAttachments,
    currentSession,
    sendMessageAI,
    persistMessage
  ]);

  // Handle pending prompt from deep link
  useEffect(() => {
    if (pendingPrompt) {
      setInput(pendingPrompt);
      setPendingPrompt(null);
      logger.core.info('Applied pending prompt from deep link', {
        promptLength: pendingPrompt.length,
      });
    }
  }, [pendingPrompt, setPendingPrompt]);

  // Check if chat is empty
  const isChatEmpty = messages.length === 0 && status !== 'streaming';

  // Show loading indicator while loading messages
  if (isLoadingMessages) {
    return (
      <div className="flex items-center justify-center h-full">
        <BreathingLogo />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col h-full relative",
        isDragging && enableFileAttachment && "ring-2 ring-primary ring-inset"
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && enableFileAttachment && (
        <div className="absolute inset-0 z-50 bg-primary/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <p className="text-lg font-semibold text-primary">Drop images or PDFs here</p>
            <p className="text-sm text-muted-foreground mt-1">to attach them to your message</p>
          </div>
        </div>
      )}

      {/* Show error if any */}
      {chatError && (
        <div className="p-4 bg-red-100 border border-red-400 text-red-800">
          <strong>Error:</strong> {chatError.message}
        </div>
      )}

      {isChatEmpty ? (
        // Empty state with welcome screen
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="w-full max-w-3xl flex flex-col items-center gap-8">
            <WelcomeScreen userName={userName} />
            <div className="w-full">
              <ChatPromptInput
                input={input}
                onInputChange={setInput}
                onSubmit={handleSubmit}
                enableMCP={enableMCP ?? true}
                onMCPChange={setEnableMCP}
                model={model}
                onModelChange={handleModelChange}
                availableModels={filteredAvailableModels}
                modelsLoading={modelsLoading}
                status={status}
                attachedFiles={attachedFiles}
                onFilesSelected={handleFilesSelected}
                onFileRemove={handleFileRemove}
                enableFileAttachment={enableFileAttachment}
                fileAccept={getFileAccept()}
                selectedResources={selectedResources}
                onResourceSelected={selectResource}
                onResourceRemove={removeResource}
                selectedPrompts={selectedPrompts}
                onPromptSelected={selectPrompt}
                onPromptRemove={removePrompt}
              />
            </div>
          </div>
        </div>
      ) : (
        // Chat conversation
        <>
          <Conversation className="flex-1">
            <ConversationContent className="max-w-3xl mx-auto p-0 pl-4 pr-2 py-4">
              {messages.map((message) => (
                <ChatMessageItem
                  key={message.id}
                  message={message}
                  isStreaming={status === 'streaming'}
                  onPrompt={setInput}
                />
              ))}

              {/* Streaming indicator */}
              {(status === 'streaming' || status === 'submitted') && (
                <Message from="assistant">
                  <MessageContent>
                    <BreathingLogo />
                  </MessageContent>
                </Message>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          {/* Input */}
          <div className="bg-transparent px-2">
            <ChatPromptInput
              input={input}
              onInputChange={setInput}
              onSubmit={handleSubmit}
              enableMCP={enableMCP ?? true}
              onMCPChange={setEnableMCP}
              model={model}
              onModelChange={handleModelChange}
              availableModels={filteredAvailableModels}
              modelsLoading={modelsLoading}
              status={status}
              attachedFiles={attachedFiles}
              onFilesSelected={handleFilesSelected}
              onFileRemove={handleFileRemove}
              enableFileAttachment={enableFileAttachment}
              fileAccept={getFileAccept()}
              selectedResources={selectedResources}
              onResourceSelected={selectResource}
              onResourceRemove={removeResource}
              selectedPrompts={selectedPrompts}
              onPromptSelected={selectPrompt}
              onPromptRemove={removePrompt}
            />
          </div>
        </>
      )}
    </div>
  );
};

// Wrap with StreamingProvider
const ChatPageWithProvider = () => {
  return (
    <StreamingProvider>
      <ChatPage />
    </StreamingProvider>
  );
};

// Static method to get sidebar content for chat page
ChatPageWithProvider.getSidebarContent = (
  sessions: any[],
  currentSessionId: string | undefined,
  onSessionSelect: (sessionId: string) => void,
  onNewChat: () => void,
  onDeleteChat: (sessionId: string) => void,
  onRenameChat: (sessionId: string, newTitle: string) => void,
  loading: boolean = false
) => {
  return (
    <ChatList
      sessions={sessions}
      currentSessionId={currentSessionId}
      onSessionSelect={onSessionSelect}
      onNewChat={onNewChat}
      onDeleteChat={onDeleteChat}
      onRenameChat={onRenameChat}
      loading={loading}
    />
  );
};

export default ChatPageWithProvider;
