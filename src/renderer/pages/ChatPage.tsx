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
 */

import { Message, MessageContent } from '@/components/ai-elements/message';
import { Response } from '@/components/ai-elements/response';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { StreamingProvider, useStreamingContext } from '@/contexts/StreamingContext';
import { ChatList } from '@/components/chat/ChatList';
import { WelcomeScreen } from '@/components/chat/WelcomeScreen';
import { ChatPromptInput } from '@/components/chat/ChatPromptInput';
import { MessageAttachments } from '@/components/chat/MessageAttachments';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ExternalLink } from 'lucide-react';
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
import { BreathingLogo } from '@/components/ai-elements/breathing-logo';
import { ToolCall } from '@/components/ai-elements/tool-call';
import { modelService } from '@/services/modelService';
import type { Model } from '../../types/models';
import { getRendererLogger } from '@/services/logger';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// AI SDK v5 imports
import { useChat } from '@ai-sdk/react';
import { createElectronChatTransport } from '@/transports/ElectronChatTransport';

const logger = getRendererLogger();

const ChatPage = () => {
  const { t } = useTranslation('chat');
  const [input, setInput] = useState('');
  const [model, setModel] = useState<string>('');
  const [webSearch, setWebSearch] = useState(false);
  const [enableMCP, setEnableMCP] = useState(false);
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [userName, setUserName] = useState<string>(t('welcome.default_user_name'));
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [pendingFirstMessage, setPendingFirstMessage] = useState<string | null>(null);
  const [pendingFirstAttachments, setPendingFirstAttachments] = useState<File[] | null>(null);
  const [pendingMessageAfterStop, setPendingMessageAfterStop] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

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

  // Detect if current model is an inference model (supports file attachments)
  const currentModelInfo = availableModels.find((m) => m.id === model);
  const modelTaskType = currentModelInfo?.taskType;

  // Filter available models based on current session type
  // This ensures users can only see compatible models when a session is active
  const filteredAvailableModels = useMemo(() => {
    if (!currentSession) {
      // No session - show all models
      return availableModels;
    }

    const sessionType = currentSession.session_type;

    if (sessionType === 'chat') {
      // Chat session - only show chat and multimodal chat models
      return availableModels.filter(m => {
        const taskType = m.taskType;
        return !taskType || taskType === 'chat' || taskType === 'image-text-to-text';
      });
    } else if (sessionType === 'inference') {
      // Inference session - only show inference models
      return availableModels.filter(m => {
        const taskType = m.taskType;
        return taskType && taskType !== 'chat' && taskType !== 'image-text-to-text';
      });
    }

    // Fallback - show all models
    return availableModels;
  }, [availableModels, currentSession]);

  // Enable file attachments for models that support or require visual inputs
  // - image-text-to-text vision chat
  // - image-to-image transformations
  // - any model with the "vision" capability flag (e.g., router models tagged as chat)
  const supportsFileAttachment =
    !!(
      (modelTaskType && ['image-text-to-text', 'image-to-image'].includes(modelTaskType)) ||
      currentModelInfo?.capabilities?.includes('vision')
    );
  const enableFileAttachment = supportsFileAttachment;

  // Get file accept attribute based on model task type
  const getFileAccept = (): string => {
    if (currentModelInfo?.capabilities?.includes('vision')) {
      return 'image/*';
    }

    switch (modelTaskType) {
      case 'image-text-to-text':
      case 'image-to-image':
        return 'image/*';
      default:
        return 'image/*';
    }
  };

  const attachFilesToLatestUserMessage = (attachments: Array<{
    id: string;
    type: 'image' | 'audio';
    filename: string;
    mimeType: string;
    size: number;
    storagePath: string;
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

  // Get attachment button title based on model task type
  const getAttachmentTitle = (): string => {
    if (currentModelInfo?.capabilities?.includes('vision')) {
      return 'Attach image for multimodal chat';
    }

    switch (modelTaskType) {
      case 'image-text-to-text':
        return 'Attach image for multimodal chat';
      case 'image-to-image':
        return 'Attach image for transformation';
      default:
        return 'Attach image';
    }
  };

  // Create transport with current configuration
  const transport = useMemo(
    () =>
      createElectronChatTransport({
        model: model || 'openai/gpt-4o',
        webSearch,
        enableMCP,
      }),
    [] // Keep same transport instance
  );

  // Update transport options when they change
  useEffect(() => {
    transport.updateOptions({
      model: model || 'openai/gpt-4o',
      webSearch,
      enableMCP,
    });
  }, [model, webSearch, enableMCP, transport]);

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
          type: 'image' | 'audio';
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
                  generatedAttachments.push(result.data);
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

    // Clear attachments when changing sessions
    setAttachedFiles([]);

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

  // Handle model change with session type validation
  const handleModelChange = (newModelId: string) => {
    // If no current session, allow any model (it will determine session type on creation)
    if (!currentSession) {
      setModel(newModelId);
      return;
    }

    // Get the new model's info
    const newModelInfo = availableModels.find((m) => m.id === newModelId);
    const newTaskType = newModelInfo?.taskType;
    const isNewModelInference = newTaskType && newTaskType !== 'chat' && newTaskType !== 'image-text-to-text';

    // Check session type compatibility
    const sessionType = currentSession.session_type;

    if (sessionType === 'chat' && isNewModelInference) {
      logger.core.warn('Cannot switch to inference model in chat session', {
        currentSessionType: sessionType,
        newModel: newModelId,
        newTaskType
      });
      alert(
        '❌ No puedes usar modelos de inferencia en sesiones de chat.\n\n' +
        'Las sesiones de chat están diseñadas para modelos conversacionales. ' +
        'Para usar modelos de inferencia (text-to-image, image-to-image, etc.), inicia una nueva conversación.'
      );
      return;
    }

    if (sessionType === 'inference' && !isNewModelInference) {
      logger.core.warn('Cannot switch to chat model in inference session', {
        currentSessionType: sessionType,
        newModel: newModelId,
        newTaskType
      });
      alert(
        '❌ No puedes usar modelos de chat en sesiones de inferencia.\n\n' +
        'Las sesiones de inferencia están diseñadas para tareas específicas (text-to-image, image-to-image, etc.). ' +
        'Para usar modelos de chat normales, inicia una nueva conversación.'
      );
      return;
    }

    // Valid change - update model
    logger.core.info('Model changed', {
      oldModel: model,
      newModel: newModelId,
      sessionType,
      compatible: true
    });
    setModel(newModelId);
  };

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
    if (input.trim() || attachedFiles.length > 0) {
      const messageText = input;
      const filesToAttach = [...attachedFiles];

      try {
        setInput('');
        setAttachedFiles([]); // Clear attachments immediately

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
          type: 'image' | 'audio';
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
              type: file.type.startsWith('image/') ? 'image' : 'audio',
              data: dataUrl,
              mime: file.type,
              filename: file.name
            });
          }

          // Save attachments to disk
          savedAttachments = await processAttachments(
            filesToAttach,
            currentSession.id,
            messageId
          );
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
          type: 'image' | 'audio';
          data: string;
          mime: string;
          filename: string;
        }> = [];
        let savedAttachments: Array<{
          id: string;
          type: 'image' | 'audio';
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
              type: file.type.startsWith('image/') ? 'image' : 'audio',
              data: dataUrl,
              mime: file.type,
              filename: file.name
            });
          }

          savedAttachments = await processAttachments(
            attachmentFiles,
            currentSession.id,
            messageId
          );
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

  // Load available models on component mount
  useEffect(() => {
    loadAvailableModels();
    loadUserName();
  }, []);

  const loadUserName = async () => {
    try {
      const profile = await window.levante.profile.get();
      if (profile?.data?.personalization?.nickname) {
        setUserName(profile.data.personalization.nickname);
      }
    } catch (error) {
      logger.preferences.error('Error loading user name', {
        error: error instanceof Error ? error.message : error,
      });
    }
  };

  const loadAvailableModels = async () => {
    try {
      setModelsLoading(true);
      await modelService.initialize();
      const models = await modelService.getAvailableModels();
      setAvailableModels(models);

      // Set default model if none selected
      if (!model && models.length > 0) {
        setModel(models[0].id);
      }
    } catch (error) {
      logger.core.error('Failed to load models in ChatPage', {
        error: error instanceof Error ? error.message : error,
      });
    } finally {
      setModelsLoading(false);
    }
  };

  // File validation constants
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const MIN_IMAGE_DIMENSION = 256; // px for inference image tasks
  const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
  const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3', 'audio/flac', 'audio/m4a'];

  // Get allowed MIME types based on current model task type
  const getAllowedMimeTypes = (): string[] => {
    switch (modelTaskType) {
      case 'image-text-to-text':
      case 'image-to-image':
        return ALLOWED_IMAGE_TYPES;
      default:
        return ALLOWED_IMAGE_TYPES;
    }
  };

  // Get file type description for error messages
  const getFileTypeDescription = (): string => {
    switch (modelTaskType) {
      case 'image-text-to-text':
      case 'image-to-image':
        return 'images';
      default:
        return 'images';
    }
  };

  // Handle file selection with validation
  const handleFilesSelected = async (files: File[]) => {
    const validFiles: File[] = [];
    const errors: string[] = [];
    const allowedTypes = getAllowedMimeTypes();
    const typeDescription = getFileTypeDescription();
    const requiresMinDimensions = modelTaskType === 'image-to-image';

    for (const file of files) {
      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: File size exceeds 10MB limit`);
        logger.core.warn('File size exceeds limit', {
          filename: file.name,
          size: file.size,
          maxSize: MAX_FILE_SIZE,
        });
        continue;
      }

      // Check MIME type
      if (!allowedTypes.includes(file.type)) {
        errors.push(`${file.name}: Only ${typeDescription} are supported for this model (got ${file.type})`);
        logger.core.warn('File type not supported for model', {
          filename: file.name,
          mimeType: file.type,
          modelTaskType,
          allowedTypes,
        });
        continue;
      }

      if (requiresMinDimensions) {
        try {
          const dimensions = await getImageDimensions(file);
          if (!dimensions || dimensions.width < MIN_IMAGE_DIMENSION || dimensions.height < MIN_IMAGE_DIMENSION) {
            errors.push(
              `${file.name}: Image must be at least ${MIN_IMAGE_DIMENSION}x${MIN_IMAGE_DIMENSION}px (got ${dimensions?.width || 0}x${dimensions?.height || 0})`
            );
            logger.core.warn('Image dimensions too small for inference model', {
              filename: file.name,
              width: dimensions?.width,
              height: dimensions?.height,
              min: MIN_IMAGE_DIMENSION
            });
            continue;
          }
        } catch (error) {
          errors.push(`${file.name}: Unable to read image dimensions`);
          logger.core.error('Failed to read image dimensions', {
            filename: file.name,
            error: error instanceof Error ? error.message : error,
          });
          continue;
        }
      }

      validFiles.push(file);
    }

    // Add valid files
    if (validFiles.length > 0) {
      setAttachedFiles((prev) => [...prev, ...validFiles]);
      logger.core.info('Files attached', {
        count: validFiles.length,
        modelTaskType,
      });
    }

    // Log errors if any
    if (errors.length > 0) {
      logger.core.error('File validation errors', { errors, modelTaskType });
      toast.error('Some files were rejected', {
        description: errors.join('\n'),
      });
    }
  };

  // Handle file removal
  const handleFileRemove = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
    logger.core.info('File removed', { index });
  };

  // Process and save attachments
  const processAttachments = async (
    files: File[],
    sessionId: string,
    messageId: string
  ) => {
    const attachmentResults = [];

    for (const file of files) {
      try {
        const buffer = await file.arrayBuffer();
        const result = await window.levante.attachments.save(
          sessionId,
          messageId,
          buffer,
          file.name,
          file.type
        );

        if (result.success && result.data) {
          attachmentResults.push(result.data);
          logger.core.info('Attachment saved', {
            filename: file.name,
            attachmentId: result.data.id,
          });
        } else {
          logger.core.error('Failed to save attachment', {
            filename: file.name,
            error: result.error,
          });
        }
      } catch (error) {
        logger.core.error('Error processing attachment', {
          filename: file.name,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    return attachmentResults;
  };

  const getImageDimensions = (file: File): Promise<{ width: number; height: number } | null> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          resolve({ width: img.width, height: img.height });
        };
        img.onerror = () => reject(new Error('Failed to load image data'));
        if (typeof event.target?.result === 'string') {
          img.src = event.target.result;
        } else {
          reject(new Error('Invalid image data'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.readAsDataURL(file);
    });
  };

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
    <div className="flex flex-col h-full">
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
                webSearch={webSearch}
                enableMCP={enableMCP}
                onWebSearchChange={setWebSearch}
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
                fileAttachmentTitle={getAttachmentTitle()}
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
                  <div key={message.id}>
                    {/* Sources (web search results) */}
                    {message.role === 'assistant' && message.parts && (
                      <Sources>
                        {message.parts
                          .filter((part: any) => part?.value?.type === 'source-url')
                          .map((part: any, i: number) => (
                            <>
                              <SourcesTrigger
                                key={`trigger-${message.id}-${i}`}
                                count={
                                  message.parts.filter((p: any) => p.value?.type === 'source-url')
                                    .length
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
                        message.role === 'user' ? 'is-user my-6' : 'is-assistant'
                      )}
                    >
                      <MessageContent
                        from={message.role}
                        className={cn(
                          '',
                          message.role === 'user' ? 'p-2 mb-0 dark:text-white' : 'px-2 py-0'
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

                        {message.parts?.map((part: any, i: number) => {
                          try {
                            // Text content
                            if (part?.type === 'text' && part?.text) {
                              return (
                                <Response key={`${message.id}-${i}`}>
                                  {part.text}
                                </Response>
                              );
                            }

                            // Reasoning (data part)
                            if (part?.value?.type === 'reasoning') {
                            return (
                              <Reasoning
                                key={`${message.id}-${i}`}
                                className="w-full"
                                isStreaming={status === 'streaming'}
                              >
                                <ReasoningTrigger />
                                <ReasoningContent>
                                  {part.value.text || ''}
                                </ReasoningContent>
                              </Reasoning>
                            );
                          }

                          // Tool calls (MCP)
                          if (part?.type?.startsWith('tool-')) {
                            // Only show if output is available or there's an error
                            if (part.state === 'output-available' || part.state === 'output-error') {
                              const toolCall = {
                                id: part.toolCallId,
                                name: part.toolName,
                                arguments: part.input || {},
                                result: part.state === 'output-available' ? {
                                  success: true,
                                  content: JSON.stringify(part.output),
                                } : {
                                  success: false,
                                  error: part.errorText,
                                },
                                status: part.state === 'output-available' ? 'success' as const : 'error' as const,
                              };

                              return (
                                <ToolCall
                                  key={`${message.id}-${i}`}
                                  toolCall={toolCall}
                                  className="w-full"
                                />
                              );
                            }
                          }

                            return null;
                          } catch (error) {
                            console.error('[ChatPage] Error rendering part:', error, {
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
              webSearch={webSearch}
              enableMCP={enableMCP}
              onWebSearchChange={setWebSearch}
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
              fileAttachmentTitle={getAttachmentTitle()}
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
  loading: boolean = false
) => {
  return (
    <ChatList
      sessions={sessions}
      currentSessionId={currentSessionId}
      onSessionSelect={onSessionSelect}
      onNewChat={onNewChat}
      onDeleteChat={onDeleteChat}
      loading={loading}
    />
  );
};

export default ChatPageWithProvider;
