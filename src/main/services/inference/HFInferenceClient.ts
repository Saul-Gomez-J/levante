import { InferenceClient } from "@huggingface/inference";
import type {
  TextGenerationInput,
  TextGenerationOptions,
  ConversationalInput,
  TextToImageInput,
  TextToImageOptions,
  ImageTextToTextInput,
  ImageToImageInput,
  ImageToImageOptions,
  TextToVideoInput,
  TextToVideoOptions,
  TextToSpeechInput,
  TextToSpeechOptions,
  VisualQuestionAnsweringInput,
  DocumentQuestionAnsweringInput,
  TableQuestionAnsweringInput,
  HFChatMessage,
} from "../../../types/inference";
import { getLogger } from "../logging";

const logger = getLogger();

/**
 * Client for Hugging Face Inference API
 * Handles different inference tasks using the official HF SDK
 */
export class HFInferenceClient {
  private client: InferenceClient;

  constructor(token: string) {
    this.client = new InferenceClient(token);
    logger.aiSdk.debug("HFInferenceClient initialized");
  }

  private extractChatContent(response: any): string {
    const choice = response?.choices?.[0];
    const message = choice?.message;
    const content = message?.content;

    if (!content) {
      throw new Error("Chat completion returned no message content");
    }

    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((part: any) => {
          if (typeof part === "string") return part;
          if (typeof part?.text === "string") return part.text;
          if (typeof part?.content === "string") return part.content;
          if (Array.isArray(part?.content)) {
            return part.content
              .map((nested: any) => nested?.text || "")
              .join("");
          }
          return "";
        })
        .join("");
    }

    if (typeof content === "object" && content !== null) {
      if (typeof (content as any).text === "string") {
        return (content as any).text;
      }
      if (Array.isArray((content as any).content)) {
        return (content as any).content.map((c: any) => c?.text || "").join("");
      }
    }

    throw new Error("Unable to parse chat completion response");
  }

  private messagesToPrompt(messages: HFChatMessage[]): string {
    return messages
      .map((msg) => {
        const role = msg.role.toUpperCase();
        if (typeof msg.content === "string") {
          return `${role}: ${msg.content}`;
        }

        if (Array.isArray(msg.content)) {
          const text = msg.content
            .map((part) => {
              if ("text" in part && typeof part.text === "string") {
                return part.text;
              }
              if (part.type?.includes("image")) {
                return "[image]";
              }
              return "";
            })
            .join(" ");
          return `${role}: ${text}`;
        }

        return `${role}:`;
      })
      .join("\n");
  }

  private isTaskRoutingError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes("not supported for task") ||
      message.includes("Supported task:") ||
      message.includes("Unsupported task for model") ||
      message.includes("does not support chat completion")
    );
  }

  private async dataToDataUrl(
    data: Buffer | Blob,
    mimeType?: string,
    fallback: string = "application/octet-stream"
  ): Promise<string> {
    if (data instanceof Blob) {
      const buffer = Buffer.from(await data.arrayBuffer());
      const mime = data.type || mimeType || fallback;
      return `data:${mime};base64,${buffer.toString("base64")}`;
    }

    const mime = mimeType || fallback;
    return `data:${mime};base64,${Buffer.from(data).toString("base64")}`;
  }

  /**
   * Text Generation: Generate text continuations
   * @param model - HF model ID (e.g., "meta-llama/Llama-2-7b-hf")
   * @param input - Prompt text
   * @param options - Generation parameters
   * @param provider - Inference provider slug (optional)
   * @returns Generated text
   */
  async textGeneration(
    model: string,
    input: TextGenerationInput,
    options?: TextGenerationOptions,
    provider?: string
  ): Promise<string> {
    try {
      logger.aiSdk.debug("Text generation inference", {
        model,
        prompt: input.prompt.substring(0, 50),
        provider,
      });

      const result = await this.client.textGeneration({
        model,
        inputs: input.prompt,
        parameters: options as any,
        provider: provider as any,
      });

      const generatedText =
        typeof result === "string" ? result : result.generated_text;

      logger.aiSdk.info("Text generation completed", {
        model,
        textLength: generatedText.length,
      });

      return generatedText;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check if this is a task not supported error (e.g., "Supported task: conversational")
      if (
        errorMessage.includes("not supported for task") &&
        errorMessage.includes("conversational")
      ) {
        logger.aiSdk.error("Model requires conversational task type", {
          model,
          provider,
          error: errorMessage,
        });

        throw new Error(
          `The model "${model}" with provider "${provider || "default"}" only supports conversational chat, not text-generation.\n\n` +
            `Solutions:\n` +
            `1. Add this model through the Hugging Face Router provider (which uses the conversational API)\n` +
            `2. Try a different inference provider for this model\n` +
            `3. Choose a different model that supports text-generation\n\n` +
            `Original error: ${errorMessage}`
        );
      }

      logger.aiSdk.error("Text generation failed", {
        model,
        provider,
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Conversational chat completion with automatic fallback to text-generation when needed.
   */
  async conversationalCompletion(
    model: string,
    input: ConversationalInput,
    provider?: string
  ): Promise<string> {
    if (!input.messages || input.messages.length === 0) {
      throw new Error(
        "Conversational completion requires at least one message"
      );
    }

    try {
      logger.aiSdk.debug("Conversational chat inference", {
        model,
        provider,
        messageCount: input.messages.length,
      });

      const response = await this.client.chatCompletion({
        model,
        // @ts-ignore SDK type mismatch with our HFChatMessage type
        messages: input.messages,
        // @ts-ignore provider param may not be typed yet
        provider,
      });

      const content = this.extractChatContent(response);

      logger.aiSdk.info("Conversational chat completed", {
        model,
        provider,
        length: content.length,
      });

      return content;
    } catch (error) {
      logger.aiSdk.warn("Chat completion failed, checking for fallback", {
        model,
        provider,
        error: error instanceof Error ? error.message : error,
      });

      if (this.isTaskRoutingError(error)) {
        const fallbackPrompt = this.messagesToPrompt(input.messages);

        logger.aiSdk.info(
          "Falling back to textGeneration for conversational model",
          {
            model,
            provider,
          }
        );

        return this.textGeneration(
          model,
          { prompt: fallbackPrompt },
          undefined,
          provider
        );
      }

      throw error;
    }
  }

  /**
   * Text-to-Image: Generate images from text prompts
   * @param model - HF model ID (e.g., "black-forest-labs/FLUX.1-dev")
   * @param input - Prompt and options
   * @param provider - Inference provider slug (optional)
   * @returns Blob containing the generated image
   */
  async textToImage(
    model: string,
    input: TextToImageInput,
    options?: TextToImageOptions,
    provider?: string
  ): Promise<Blob> {
    try {
      logger.aiSdk.debug("Text-to-image inference", {
        model,
        prompt: input.prompt,
        provider,
      });

      const blob = await (this.client.textToImage as (args: unknown) => Promise<Blob>)({
        model,
        inputs: input.prompt,
        parameters: options,
        provider,
      });

      logger.aiSdk.info("Text-to-image completed", {
        model,
        provider,
        blobSize: blob.size,
        blobType: blob.type,
      });

      return blob;
    } catch (error) {
      logger.aiSdk.error("Text-to-image failed", {
        model,
        provider,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Image-Text-to-Text: Multimodal models (vision + text)
   * @param model - HF model ID (e.g., "llava-hf/llava-1.5-7b-hf")
   * @param input - Image and optional text prompt
   * @param provider - Inference provider slug (optional)
   * @returns Text response
   */
  async imageTextToText(
    model: string,
    input: ImageTextToTextInput,
    provider?: string
  ): Promise<string> {
    const preferChat = input.preferChatMode !== false;

    if (preferChat) {
      try {
        const imageUrl = await this.dataToDataUrl(
          input.image,
          input.mimeType,
          "image/png"
        );

        logger.aiSdk.debug("Image-text-to-text via chatCompletion", {
          model,
          provider,
          hasText: !!input.text,
        });

        const response = await this.client.chatCompletion({
          model,
          messages: [
            {
              role: "user",
              content: [
                // @ts-ignore SDK type mismatch with content chunk types
                ...(input.text ? [{ type: "text", text: input.text }] : []),
                // @ts-ignore SDK type mismatch with image type
                { type: "image", image_url: { url: imageUrl } },
              ],
            },
          ],
          // @ts-ignore provider type mismatch
          provider,
        });

        const content = this.extractChatContent(response);

        logger.aiSdk.info("Image-text-to-text completed via chatCompletion", {
          model,
          provider,
          textLength: content.length,
        });

        return content;
      } catch (error) {
        logger.aiSdk.warn(
          "Multimodal chat failed, falling back to imageToText",
          {
            model,
            provider,
            error: error instanceof Error ? error.message : error,
          }
        );
      }
    }

    try {
      logger.aiSdk.debug("Image-text-to-text via imageToText", {
        model,
        provider,
        hasText: !!input.text,
      });

      // @ts-ignore - SDK type mismatches with parameters and provider
      const result = await this.client.imageToText({
        model,
        data: input.image,
        parameters: input.text ? { prompt: input.text } : undefined,
        provider: provider as any,
      });

      const generatedText = result.generated_text || '';

      logger.aiSdk.info("Image-text-to-text completed via imageToText", {
        model,
        provider,
        textLength: generatedText.length,
      });

      return generatedText;
    } catch (error) {
      logger.aiSdk.error("Image-text-to-text failed", {
        model,
        provider,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Visual Question Answering
   */
  async visualQuestionAnswering(
    model: string,
    input: VisualQuestionAnsweringInput,
    provider?: string
  ): Promise<string> {
    try {
      logger.aiSdk.debug("Visual QA inference", {
        model,
        provider,
        questionLength: input.question.length,
      });

      // @ts-ignore SDK type mismatch with image type (Blob vs Buffer) and provider type
      const result = await this.client.visualQuestionAnswering({
        model,
        inputs: {
          question: input.question,
          image: input.image as any,
        },
        provider: provider as any,
      });

      const answer = Array.isArray(result)
        ? result[0]?.answer || result[0]?.generated_text || ""
        : (result as any)?.answer || (result as any)?.generated_text || "";

      if (!answer) {
        throw new Error("Visual QA returned empty answer");
      }

      logger.aiSdk.info("Visual QA completed", {
        model,
        provider,
        answerLength: answer.length,
      });

      return answer;
    } catch (error) {
      logger.aiSdk.error("Visual QA failed", {
        model,
        provider,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Document Question Answering
   */
  async documentQuestionAnswering(
    model: string,
    input: DocumentQuestionAnsweringInput,
    provider?: string
  ): Promise<string> {
    try {
      logger.aiSdk.debug("Document QA inference", {
        model,
        provider,
        questionLength: input.question.length,
      });

      // @ts-ignore SDK type mismatch with image type (Blob vs Buffer) and provider type
      const result = await this.client.documentQuestionAnswering({
        model,
        inputs: {
          question: input.question,
          image: input.image as any,
        },
        provider: provider as any,
      });

      const answer = Array.isArray(result)
        ? result[0]?.answer || ""
        : (result as any)?.answer || "";

      if (!answer) {
        throw new Error("Document QA returned empty answer");
      }

      logger.aiSdk.info("Document QA completed", {
        model,
        provider,
        answerLength: answer.length,
      });

      return answer;
    } catch (error) {
      logger.aiSdk.error("Document QA failed", {
        model,
        provider,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Table Question Answering
   */
  async tableQuestionAnswering(
    model: string,
    input: TableQuestionAnsweringInput,
    provider?: string
  ): Promise<string> {
    try {
      logger.aiSdk.debug("Table QA inference", {
        model,
        provider,
      });

      // @ts-ignore SDK type mismatch with table input and provider type
      const result = await this.client.tableQuestionAnswering({
        model,
        inputs: {
          table: input.table as any,
          question: input.query, // SDK uses 'question' instead of 'query'
        },
        provider: provider as any,
      }) as any;

      const answer =
        result?.answer ??
        result?.answerText ??
        (typeof result === "string" ? result : "");

      if (!answer) {
        throw new Error("Table QA returned empty answer");
      }

      logger.aiSdk.info("Table QA completed", {
        model,
        provider,
        answerLength: answer.length,
      });

      return answer;
    } catch (error) {
      logger.aiSdk.error("Table QA failed", {
        model,
        provider,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Image-to-Image: Transform or edit images
   * @param model - HF model ID (e.g., "lllyasviel/sd-controlnet-canny")
   * @param input - Source image and optional prompt
   * @param options - Transformation parameters
   * @param provider - Inference provider slug (optional)
   * @returns Blob containing the transformed image
   */
  async imageToImage(
    model: string,
    input: ImageToImageInput,
    options?: ImageToImageOptions,
    provider?: string
  ): Promise<Blob> {
    try {
      logger.aiSdk.debug("Image-to-image inference", {
        model,
        provider,
      });

      const blob = await this.client.imageToImage({
        provider: provider as any,
        model,
        inputs: input.image as any,
        parameters: {
          ...options,
          prompt: input.prompt,
        },
      });

      logger.aiSdk.info("Image-to-image completed", {
        model,
        provider,
        blobSize: blob.size,
        blobType: blob.type,
      });

      return blob;
    } catch (error) {
      logger.aiSdk.error("Image-to-image failed", {
        model,
        provider,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Text-to-Video: Generate videos from text
   * @param model - HF model ID (e.g., "damo-vilab/text-to-video-ms-1.7b")
   * @param input - Text prompt
   * @param options - Video generation parameters
   * @param provider - Inference provider slug (optional)
   * @returns Blob containing the video
   */
  async textToVideo(
    model: string,
    input: TextToVideoInput,
    options?: TextToVideoOptions,
    provider?: string
  ): Promise<Blob> {
    try {
      logger.aiSdk.debug("Text-to-video inference", {
        model,
        text: input.text.substring(0, 50),
        provider,
      });

      // @ts-ignore SDK type mismatch with options and provider
      const blob = await this.client.textToVideo({
        model,
        inputs: input.text,
        parameters: options as any,
        provider: provider as any,
      });

      logger.aiSdk.info("Text-to-video completed", {
        model,
        provider,
        blobSize: blob.size,
        blobType: blob.type,
      });

      return blob;
    } catch (error) {
      logger.aiSdk.error("Text-to-video failed", {
        model,
        provider,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Text-to-Speech: Generate audio from text
   * @param model - HF model ID (e.g., "facebook/mms-tts-eng")
   * @param input - Text to synthesize
   * @param options - Voice and speed options
   * @param provider - Inference provider slug (optional)
   * @returns Blob containing the audio
   */
  async textToSpeech(
    model: string,
    input: TextToSpeechInput,
    options?: TextToSpeechOptions,
    provider?: string
  ): Promise<Blob> {
    try {
      logger.aiSdk.debug("Text-to-speech inference", {
        model,
        text: input.text.substring(0, 50),
        provider,
      });

      // @ts-ignore SDK type mismatch with parameters and provider
      const blob = await this.client.textToSpeech({
        model,
        inputs: input.text,
        parameters: options as any,
        provider: provider as any,
      });

      logger.aiSdk.info("Text-to-speech completed", {
        model,
        blobSize: blob.size,
        blobType: blob.type,
      });

      return blob;
    } catch (error) {
      logger.aiSdk.error("Text-to-speech failed", {
        model,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }
}
