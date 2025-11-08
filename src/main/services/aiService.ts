import {
  streamText,
  generateText,
  convertToModelMessages,
  UIMessage,
  stepCountIs,
} from "ai";
import { getLogger } from "./logging";
import { getModelProvider } from "./ai/providerResolver";
import { getMCPTools } from "./ai/mcpToolsAdapter";
import { buildSystemPrompt } from "./ai/systemPromptBuilder";
import { isToolUseNotSupportedError } from "./ai/toolErrorDetector";
import { calculateMaxSteps } from "./ai/stepsCalculator";
import { InferenceDispatcher } from "./inference/InferenceDispatcher";
import type { InferenceTask, HFChatMessage } from "../../types/inference";
import { classifyModel, getSessionType } from "../../utils/modelClassification";
import type { ModelCategory, ModelCapabilities } from "../../types/modelCategories";

export interface ChatRequest {
  messages: UIMessage[];
  model: string;
  webSearch: boolean;
  enableMCP?: boolean;
}

export interface ChatStreamChunk {
  delta?: string;
  done?: boolean;
  error?: string;
  sources?: Array<{ url: string; title?: string }>;
  reasoning?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, any>;
    status: "running" | "success" | "error";
    timestamp: number;
  };
  toolResult?: {
    id: string;
    result: any;
    status: "success" | "error";
    timestamp: number;
  };
  generatedAttachment?: {
    type: 'image' | 'audio' | 'video';
    mime: string;
    dataUrl: string;
    filename: string;
  };
}

export class AIService {
  private logger = getLogger();

  /**
   * Convert dataURL to Blob for inference API
   */
  private async dataURLToBlob(dataURL: string): Promise<Blob> {
    // Handle both data URLs and direct base64
    if (!dataURL.startsWith('data:')) {
      // Assume it's base64, add data URL prefix
      dataURL = `data:image/png;base64,${dataURL}`;
    }

    const response = await fetch(dataURL);
    return await response.blob();
  }

  /**
   * Convert UI messages to HF chat messages for inference chatCompletion calls
   */
  private buildHFChatMessages(messages: UIMessage[]): HFChatMessage[] {
    return messages.map((message) => {
      const textSegments: string[] = [];
      const parts = (message as any).parts;

      if (Array.isArray(parts) && parts.length > 0) {
        parts.forEach((part: any) => {
          if (part?.type === 'text' && typeof part.text === 'string') {
            textSegments.push(part.text);
          }
        });
      } else if (typeof (message as any).content === 'string') {
        textSegments.push((message as any).content);
      } else if (Array.isArray((message as any).content)) {
        textSegments.push(
          (message as any).content
            .map((part: any) => part?.text || '')
            .filter(Boolean)
            .join('\n')
        );
      } else if (typeof (message as any).text === 'string') {
        textSegments.push((message as any).text);
      }

      return {
        role: (message.role as HFChatMessage['role']) || 'user',
        content: textSegments.filter(Boolean).join('\n')
      };
    });
  }

  /**
   * Parse a JSON block embedded in markdown fences
   */
  private extractJsonBlock(text: string): { json: string; remainder: string } | null {
    const match = text.match(/```(?:json|table)?\s*([\s\S]*?)```/i);
    if (!match) {
      return null;
    }

    const remainder = text.replace(match[0], '').trim();
    return { json: match[1], remainder };
  }

  /**
   * Parse table-question-answering payloads from user text
   */
  private parseTableQuestionInput(text: string): { table: any; query: string } | null {
    const jsonBlock = this.extractJsonBlock(text);
    const candidates: string[] = [];

    if (jsonBlock) {
      candidates.push(jsonBlock.json);
    }

    if (text.trim()) {
      candidates.push(text.trim());
    }

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object') {
          const table = (parsed as any).table ?? parsed;
          const fallbackQuery =
            ((jsonBlock?.remainder || '').trim()) ||
            text.trim();

          const query =
            (parsed as any).query ??
            (parsed as any).question ??
            (parsed as any).prompt ??
            fallbackQuery;

          return {
            table,
            query
          };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Get model information with classification (Phase 3: Model Classification)
   * Replaces getModelTaskType() with richer model metadata
   *
   * Note: Returns undefined if model not found (like original getModelTaskType)
   * Actual model validation happens in getModelProvider()
   */
  private async getModelInfo(modelId: string): Promise<{
    category: ModelCategory;
    capabilities: ModelCapabilities;
    taskType?: string;
  } | undefined> {
    try {
      const { preferencesService } = await import("./preferencesService");
      const providers = (preferencesService.get("providers") as any[]) || [];

      for (const provider of providers) {
        // Find model in provider (should have minimal data + classification saved)
        const model = provider.models?.find((m: any) => m.id === modelId);

        if (model) {
          // Use cached classification (saved from renderer)
          if (model.category && model.computedCapabilities) {
            this.logger.aiSdk.debug("Using saved model classification", {
              modelId,
              category: model.category,
              capabilities: model.computedCapabilities
            });

            return {
              category: model.category,
              capabilities: model.computedCapabilities,
              taskType: model.taskType
            };
          }

          // Fallback: classify on-the-fly (shouldn't happen with Phase 2 sync)
          this.logger.aiSdk.warn("Model not classified, classifying on-the-fly", { modelId });
          const classification = classifyModel(model);

          return {
            category: classification.category,
            capabilities: classification.capabilities,
            taskType: model.taskType
          };
        }
      }

      // Model not found - return undefined (like original getModelTaskType)
      // getModelProvider will handle the error
      this.logger.aiSdk.debug("Model not found in preferences", { modelId });
      return undefined;
    } catch (error) {
      this.logger.aiSdk.warn("Failed to get model info", {
        modelId,
        error: error instanceof Error ? error.message : error
      });
      return undefined;
    }
  }

  async *streamChat(
    request: ChatRequest
  ): AsyncGenerator<ChatStreamChunk, void, unknown> {
    const { messages, model, webSearch, enableMCP = false } = request;

    try {
      // Get model classification (Phase 3: Model Classification)
      const modelInfo = await this.getModelInfo(model);

      // If model info available, use it for routing and validation
      if (modelInfo) {
        this.logger.aiSdk.info("Chat request received", {
          model,
          category: modelInfo.category,
          capabilities: {
            tools: modelInfo.capabilities.supportsTools,
            vision: modelInfo.capabilities.supportsVision,
            streaming: modelInfo.capabilities.supportsStreaming,
            multiTurn: modelInfo.capabilities.supportsMultiTurn
          }
        });

        // Route based on category (cleaner than taskType checking)
        const isInferenceModel = getSessionType(modelInfo.category) === 'inference';

        if (isInferenceModel) {
          this.logger.aiSdk.info("Routing to inference handler", {
            model,
            category: modelInfo.category,
            taskType: modelInfo.taskType
          });

          yield* this.handleInferenceModel(request, modelInfo.taskType as InferenceTask);
          return;
        }

        // Validate capabilities BEFORE execution (proactive validation)
        if (enableMCP && !modelInfo.capabilities.supportsTools) {
          this.logger.aiSdk.warn("Model does not support tools, disabling MCP", {
            model,
            category: modelInfo.category,
            supportsTools: modelInfo.capabilities.supportsTools
          });

          yield {
            delta: `⚠️ **Tool Use Not Supported**\n\nThe model "${model}" (${modelInfo.category}) doesn't support tool/function calling, which is required for MCP integration.\n\n**Recommendation:** Choose a different model that supports tools, or disable MCP for this conversation.\n\nContinuing with regular chat (MCP disabled)...\n\n`
          };

          request.enableMCP = false;
        }
      } else {
        // No model info available - proceed with default behavior
        this.logger.aiSdk.debug("No model classification available, using default behavior", { model });
      }

      // Get the appropriate model provider
      const modelProvider = await getModelProvider(model);

      // Get MCP tools if enabled
      let tools = {};
      if (enableMCP) {
        tools = await getMCPTools();
        this.logger.aiSdk.debug("Passing tools to streamText", {
          toolCount: Object.keys(tools).length,
          toolNames: Object.keys(tools)
        });

        // Debug: Check for any empty or invalid tool names
        const invalidTools = Object.entries(tools).filter(([key, value]) => {
          return !key || key.trim() === '' || !value;
        });

        if (invalidTools.length > 0) {
          this.logger.aiSdk.error("Found invalid tools", { invalidTools });
        }

        // Debug: Log a sample tool to see its structure
        const sampleToolKey = Object.keys(tools)[0];
        if (sampleToolKey) {
          this.logger.aiSdk.debug("Sample tool structure", {
            toolName: sampleToolKey,
            toolStructure: (tools as any)[sampleToolKey]
          });
        }

        // Debug: Log all tool keys being passed to AI SDK
        this.logger.aiSdk.debug("All tool keys being passed to AI SDK", {
          toolKeys: Object.keys(tools)
        });

        // Debug: Verify no empty keys exist
        const emptyKeys = Object.keys(tools).filter(key => !key || key.trim() === '');
        if (emptyKeys.length > 0) {
          this.logger.aiSdk.error("CRITICAL: Empty tool keys detected", { emptyKeys });
          // Remove empty keys
          emptyKeys.forEach(key => delete (tools as any)[key]);
        }

        // Additional validation: ensure all tools are valid objects
        const invalidToolObjects = Object.entries(tools).filter(([key, tool]) => {
          return !tool || typeof tool !== 'object' || typeof (tool as any).execute !== 'function';
        });

        if (invalidToolObjects.length > 0) {
          this.logger.aiSdk.error("CRITICAL: Invalid tool objects detected", {
            invalidToolNames: invalidToolObjects.map(([key]) => key)
          });
          // Remove invalid tools
          invalidToolObjects.forEach(([key]) => delete (tools as any)[key]);
        }

        this.logger.aiSdk.debug("Final tool validation passed. Tools ready for AI SDK", {
          finalToolCount: Object.keys(tools).length,
          finalToolNames: Object.keys(tools)
        });
      }

      const result = streamText({
        model: modelProvider,
        messages: convertToModelMessages(messages),
        tools,
        system: await buildSystemPrompt(
          webSearch,
          enableMCP,
          Object.keys(tools).length
        ),
        stopWhen: stepCountIs(await calculateMaxSteps(Object.keys(tools).length)),
      });

      // Use full stream to handle tool calls
      for await (const chunk of result.fullStream) {
        //Log all chunks
        if (chunk.type !== "text-delta") {
          this.logger.aiSdk.debug("AI Stream chunk received", {
            type: chunk.type,
            chunk
          });
        }

        // Log the actual model used when we receive finish-step
        if (chunk.type === "finish-step" && chunk.response) {
          this.logger.aiSdk.info("Model used in AI request", {
            requestedModelId: model,
            actualModelId: chunk.response.modelId,
            providerMetadata: chunk.response.headers
          });
        }

        switch (chunk.type) {
          case "text-delta":
            yield { delta: chunk.text };
            break;

          case "tool-call":
            this.logger.aiSdk.debug("Tool call chunk received", {
              type: chunk.type,
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              toolNameType: typeof chunk.toolName,
              toolNameLength: chunk.toolName?.length,
              hasArguments: !!(chunk as any).arguments
            });

            // Debug: Check if tool name is empty
            if (!chunk.toolName || chunk.toolName.trim() === '') {
              this.logger.aiSdk.error("ERROR: Tool call with empty name detected!", {
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                toolNameString: JSON.stringify(chunk.toolName),
                arguments: (chunk as any).arguments,
                availableTools: Object.keys(tools),
                fullChunk: JSON.stringify(chunk, null, 2)
              });

              // Don't yield this problematic tool call
              continue;
            }

            yield {
              toolCall: {
                id: chunk.toolCallId,
                name: chunk.toolName,
                arguments: (chunk as any).arguments || {},
                status: "running" as const,
                timestamp: Date.now(),
              },
            };
            break;

          case "tool-result":
            this.logger.aiSdk.debug("Tool result RAW chunk", {
              chunk: JSON.stringify(chunk, null, 2)
            });
            this.logger.aiSdk.debug("Tool result details", {
              output: (chunk as any).output,
              chunkKeys: Object.keys(chunk)
            });

            // Use 'output' property as per AI SDK documentation
            const toolResult = (chunk as any).output || {};
            this.logger.aiSdk.debug("Final tool result being yielded", { toolResult });

            yield {
              toolResult: {
                id: chunk.toolCallId,
                result: toolResult,
                status: "success" as const,
                timestamp: Date.now(),
              },
            };
            break;

          case "tool-error":
            this.logger.aiSdk.error("Tool execution error", {
              toolCallId: chunk.toolCallId,
              toolName: (chunk as any).toolName,
              error: (chunk as any).error,
              availableTools: Object.keys(tools)
            });

            yield {
              toolResult: {
                id: chunk.toolCallId,
                result: {
                  error: (chunk as any).error || "Tool execution failed",
                },
                status: "error" as const,
                timestamp: Date.now(),
              },
            };
            break;

          case "error":
            // Check if this is a tool use not supported error
            const isToolUseError = isToolUseNotSupportedError(chunk.error);

            if (isToolUseError && enableMCP) {
              this.logger.aiSdk.warn("Model does not support tool execution. Retrying without tools", {
                model,
                error: chunk.error
              });

              // Inform user with clear message and retry without tools
              yield {
                delta: `⚠️ **Tool Use Not Supported**\n\nThe model "${model}" doesn't support tool/function calling, which is required for MCP integration.\n\n**Recommendation:** Choose a different model that supports tools, or disable MCP for this conversation.\n\nContinuing with regular chat (MCP disabled)...\n\n`
              };

              try {
                // Retry the same request without MCP tools
                const retryRequest = { ...request, enableMCP: false };
                for await (const retryChunk of this.streamChat(retryRequest)) {
                  yield retryChunk;
                }
                return;
              } catch (retryError) {
                this.logger.aiSdk.error("Retry without tools also failed", {
                  error: retryError,
                  model
                });
                yield {
                  error: "Failed to process request both with and without tools. Please try a different model.",
                  done: true,
                };
                return;
              }
            }

            // For other errors, extract the error message
            const errorMessage = chunk.error instanceof Error
              ? chunk.error.message
              : typeof chunk.error === "string"
                ? chunk.error
                : "Unknown error occurred";

            yield {
              error: errorMessage,
              done: true,
            };
            return;
        }
      }

      yield { done: true };
    } catch (error) {
      // Unexpected errors that aren't handled by the stream (rare)
      this.logger.aiSdk.error("Unexpected streaming error", {
        error: error instanceof Error ? error.message : error,
        model,
        enableMCP
      });

      yield {
        error: error instanceof Error ? error.message : "An unexpected error occurred",
        done: true,
      };
    }
  }

  /**
   * Handle inference model (text-to-image, image-to-image, etc.)
   */
  private async *handleInferenceModel(
    request: ChatRequest,
    taskType: InferenceTask
  ): AsyncGenerator<ChatStreamChunk, void, unknown> {
    const { messages, model } = request;

    try {
      // Get HuggingFace API key from provider config
      const { preferencesService } = await import("./preferencesService");
      const providers = (preferencesService.get("providers") as any[]) || [];
      const hfProvider = providers.find(p => p.type === 'huggingface');

      if (!hfProvider?.apiKey) {
        yield {
          error: "Hugging Face API key not found. Please configure it in settings.",
          done: true
        };
        return;
      }

      // Create inference dispatcher
      const dispatcher = new InferenceDispatcher(hfProvider.apiKey);

      // Extract last user message as input
      const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
      if (!lastUserMessage) {
        yield {
          error: "No user message found for inference",
          done: true
        };
        return;
      }

      // Extract text from message
      const textParts = lastUserMessage.parts?.filter((p: any) => p.type === 'text') || [];
      const inputText = textParts.map((p: any) => p.text).join('\n') || '';

      // Extract attachments if present (for image-based tasks)
      const attachments = (lastUserMessage as any).attachments || [];
      const chatMessages = this.buildHFChatMessages(messages);
      const modelConfig = hfProvider.models?.find((m: any) => m.id === model);
      const providerSlug = modelConfig?.inferenceProvider?.trim();

      this.logger.aiSdk.info("Executing inference task", {
        model,
        taskType,
        inputLength: inputText.length,
        attachmentsCount: attachments.length
      });

      // Prepare input based on task type
      let inferenceInput: any;
      switch (taskType) {
        case 'conversational':
        case 'text-generation':
        case 'text2text-generation':
          inferenceInput = { messages: chatMessages };
          break;

        case 'text-to-image':
          inferenceInput = { prompt: inputText };
          break;

        case 'text-to-speech':
          inferenceInput = { text: inputText };
          break;

        case 'text-to-video':
          inferenceInput = { text: inputText };
          break;

        case 'image-to-image':
          // Requires image attachment
          if (attachments.length === 0) {
            yield {
              error: "Image-to-image models require an image attachment. Please attach an image to your message.",
              done: true
            };
            return;
          }

          // Get first image attachment
          const imageAttachment = attachments.find((a: any) => a.type === 'image');
          if (!imageAttachment) {
            yield {
              error: "No image found in attachments. Image-to-image models require an image.",
              done: true
            };
            return;
          }

          // Convert dataURL to Blob
          const imageBlob = await this.dataURLToBlob(imageAttachment.data);

          inferenceInput = {
            image: imageBlob,
            prompt: inputText || undefined // Optional prompt for guidance
          };
          break;

        case 'image-text-to-text':
          // Requires image attachment
          if (attachments.length === 0) {
            yield {
              error: "Multimodal models require an image attachment. Please attach an image to your message.",
              done: true
            };
            return;
          }

          // Get first image attachment
          const imageAttachmentVLM = attachments.find((a: any) => a.type === 'image');
          if (!imageAttachmentVLM) {
            yield {
              error: "No image found in attachments. Multimodal models require an image.",
              done: true
            };
            return;
          }

          // Convert dataURL to Blob
          const imageBlobVLM = await this.dataURLToBlob(imageAttachmentVLM.data);

          inferenceInput = {
            image: imageBlobVLM,
            text: inputText || undefined, // Optional text/question about image
            mimeType: imageBlobVLM.type || undefined,
            preferChatMode: true
          };
          break;

        case 'visual-question-answering':
        case 'document-question-answering': {
          if (attachments.length === 0) {
            yield {
              error: "This model requires an image attachment. Please attach an image.",
              done: true
            };
            return;
          }

          const qaAttachment = attachments.find((a: any) => a.type === 'image');
          if (!qaAttachment) {
            yield {
              error: "No image found in attachments. Please provide an image for the question.",
              done: true
            };
            return;
          }

          const qaBlob = await this.dataURLToBlob(qaAttachment.data);

          inferenceInput = {
            image: qaBlob,
            question: inputText || 'Describe the image'
          };
          break;
        }

        case 'table-question-answering': {
          const parsedTable = this.parseTableQuestionInput(inputText);

          if (!parsedTable) {
            yield {
              error: "Table QA models require a JSON payload that includes the table data. Provide a valid JSON object (optionally inside ```json fences) with either `{ table, query }` or `{ headers, rows }`.",
              done: true
            };
            return;
          }

          inferenceInput = parsedTable;
          break;
        }

        default:
          yield {
            error: `Task type "${taskType}" not yet supported in chat interface`,
            done: true
          };
          return;
      }

      // Execute inference
      const result = await dispatcher.dispatch({
        task: taskType,
        model,
        input: inferenceInput,
        provider: providerSlug
      });

      // Convert result to chat format
      switch (result.kind) {
        case 'text':
          yield { delta: result.text };
          break;

        case 'image':
          // Return image as attachment (to be saved by frontend)
          yield {
            generatedAttachment: {
              type: 'image',
              mime: result.mime,
              dataUrl: result.dataUrl,
              filename: `generated-image-${Date.now()}.${result.mime.split('/')[1] || 'png'}`
            }
          };
          break;

        case 'audio':
          // Return audio as attachment
          yield {
            generatedAttachment: {
              type: 'audio',
              mime: result.mime,
              dataUrl: result.dataUrl,
              filename: `generated-audio-${Date.now()}.${result.mime.split('/')[1] || 'wav'}`
            }
          };
          break;

        case 'video':
          // Return video as attachment
          yield {
            generatedAttachment: {
              type: 'video',
              mime: result.mime,
              dataUrl: result.dataUrl,
              filename: `generated-video-${Date.now()}.${result.mime.split('/')[1] || 'mp4'}`
            }
          };
          break;
      }

      yield { done: true };

    } catch (error) {
      this.logger.aiSdk.error("Inference execution failed", {
        model,
        taskType,
        error: error instanceof Error ? error.message : error
      });

      yield {
        error: error instanceof Error ? error.message : "Inference failed",
        done: true
      };
    }
  }

  async sendSingleMessage(
    request: ChatRequest
  ): Promise<{ response: string; sources?: any[]; reasoning?: string }> {
    const { messages, model, webSearch, enableMCP = false } = request;

    try {
      // Get model classification (Phase 3: Model Classification)
      const modelInfo = await this.getModelInfo(model);

      if (modelInfo) {
        this.logger.aiSdk.info("Single message request", {
          model,
          category: modelInfo.category,
          capabilities: modelInfo.capabilities
        });

        // Validate capabilities BEFORE execution
        if (enableMCP && !modelInfo.capabilities.supportsTools) {
          this.logger.aiSdk.warn(`Model '${model}' does not support tools. Disabling MCP...`, {
            category: modelInfo.category,
            supportsTools: modelInfo.capabilities.supportsTools
          });
          request.enableMCP = false;
        }
      } else {
        this.logger.aiSdk.debug("No model classification available for single message", { model });
      }

      // Get the appropriate model provider
      const modelProvider = await getModelProvider(model);

      // Get MCP tools if enabled
      let tools = {};
      if (enableMCP) {
        tools = await getMCPTools();
      }

      const result = await generateText({
        model: modelProvider,
        messages: convertToModelMessages(messages),
        tools,
        system: await buildSystemPrompt(
          webSearch,
          enableMCP,
          Object.keys(tools).length
        ),
        stopWhen: stepCountIs(await calculateMaxSteps(Object.keys(tools).length)),
      });

      return {
        response: result.text,
        sources: undefined,
        reasoning: undefined,
      };
    } catch (error) {
      // Extract error details for better logging
      const errorDetails: any = {};
      if (error && typeof error === 'object') {
        errorDetails.statusCode = (error as any).statusCode;
        errorDetails.responseBody = (error as any).responseBody;
        errorDetails.url = (error as any).url;
        errorDetails.data = (error as any).data;
      }

      this.logger.aiSdk.error("AI Service Error", {
        error: error instanceof Error ? error.message : error,
        errorType: error?.constructor?.name,
        model,
        enableMCP,
        messageCount: messages.length,
        ...errorDetails
      });

      // Check if this is a tool use not supported error
      const isToolUseError = isToolUseNotSupportedError(error);

      if (isToolUseError && enableMCP) {
        this.logger.aiSdk.warn(`Model '${model}' does not support tool execution. Retrying without tools...`);

        // Retry the same request without MCP tools
        try {
          const retryRequest = { ...request, enableMCP: false };
          const retryResult = await this.sendSingleMessage(retryRequest);

          return {
            response: `⚠️ **Tool Use Not Supported**\n\nThe model "${model}" doesn't support tool/function calling, which is required for MCP integration.\n\n**Recommendation:** Choose a different model that supports tools, or disable MCP for this conversation.\n\nHere's the response without tools:\n\n${retryResult.response}`,
            sources: retryResult.sources,
            reasoning: retryResult.reasoning
          };
        } catch (retryError) {
          this.logger.aiSdk.error("Retry without tools also failed", { error: retryError });
          throw new Error("Failed to process request both with and without tools. Please try a different model.");
        }
      }

      throw new Error(
        error instanceof Error ? error.message : "Unknown error occurred"
      );
    }
  }
}
