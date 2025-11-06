import { HfInference } from '@huggingface/inference';
import type {
  TextGenerationInput,
  TextGenerationOptions,
  TextToImageInput,
  TextToImageOptions,
  ImageTextToTextInput,
  ImageToImageInput,
  ImageToImageOptions,
  TextToVideoInput,
  TextToVideoOptions,
  TextToSpeechInput,
  TextToSpeechOptions
} from '../../../types/inference';
import { getLogger } from '../logging';

const logger = getLogger();

/**
 * Client for Hugging Face Inference API
 * Handles different inference tasks using the official HF SDK
 */
export class HFInferenceClient {
  private client: HfInference;

  constructor(token: string) {
    this.client = new HfInference(token);
    logger.aiSdk.debug('HFInferenceClient initialized');
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
      // For text-generation, provider is appended to model: "{model}:{provider}"
      const modelWithProvider = provider ? `${model}:${provider}` : model;

      logger.aiSdk.debug('Text generation inference', {
        model: modelWithProvider,
        prompt: input.prompt.substring(0, 50),
        provider
      });

      const result = await this.client.textGeneration({
        model: modelWithProvider,
        inputs: input.prompt,
        parameters: options
      });

      const generatedText = typeof result === 'string' ? result : result.generated_text;

      logger.aiSdk.info('Text generation completed', {
        model: modelWithProvider,
        textLength: generatedText.length
      });

      return generatedText;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if this is a task not supported error (e.g., "Supported task: conversational")
      if (errorMessage.includes('not supported for task') && errorMessage.includes('conversational')) {
        logger.aiSdk.error('Model requires conversational task type', {
          model,
          provider,
          error: errorMessage
        });

        throw new Error(
          `The model "${model}" with provider "${provider || 'default'}" only supports conversational chat, not text-generation.\n\n` +
          `Solutions:\n` +
          `1. Add this model through the Hugging Face Router provider (which uses the conversational API)\n` +
          `2. Try a different inference provider for this model\n` +
          `3. Choose a different model that supports text-generation\n\n` +
          `Original error: ${errorMessage}`
        );
      }

      logger.aiSdk.error('Text generation failed', {
        model,
        provider,
        error: errorMessage
      });
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
      logger.aiSdk.debug('Text-to-image inference', {
        model,
        prompt: input.prompt,
        provider
      });

      const blob = await this.client.textToImage({
        model,
        inputs: input.prompt,
        parameters: options,
        // @ts-ignore - provider parameter may not be in types yet
        provider
      });

      logger.aiSdk.info('Text-to-image completed', {
        model,
        provider,
        blobSize: blob.size,
        blobType: blob.type
      });

      return blob;
    } catch (error) {
      logger.aiSdk.error('Text-to-image failed', {
        model,
        provider,
        error: error instanceof Error ? error.message : error
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
    try {
      logger.aiSdk.debug('Image-text-to-text inference', {
        model,
        hasText: !!input.text,
        provider
      });

      // For multimodal models, use imageToText with the image
      // The text prompt will be part of the API call if supported by the model
      const result = await this.client.imageToText({
        model,
        data: input.image,
        // @ts-ignore - SDK may not have full typing for all parameters
        parameters: input.text ? { prompt: input.text } : undefined,
        provider
      });

      logger.aiSdk.info('Image-text-to-text completed', {
        model,
        provider,
        textLength: result.generated_text.length
      });

      return result.generated_text;
    } catch (error) {
      logger.aiSdk.error('Image-text-to-text failed', {
        model,
        provider,
        error: error instanceof Error ? error.message : error
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
      logger.aiSdk.debug('Image-to-image inference', {
        model,
        provider
      });

      const blob = await this.client.imageToImage({
        model,
        inputs: input.image,
        parameters: {
          ...options,
          prompt: input.prompt
        },
        // @ts-ignore - provider parameter may not be in types yet
        provider
      });

      logger.aiSdk.info('Image-to-image completed', {
        model,
        provider,
        blobSize: blob.size,
        blobType: blob.type
      });

      return blob;
    } catch (error) {
      logger.aiSdk.error('Image-to-image failed', {
        model,
        provider,
        error: error instanceof Error ? error.message : error
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
      logger.aiSdk.debug('Text-to-video inference', {
        model,
        text: input.text.substring(0, 50),
        provider
      });

      // @ts-ignore - textToVideo may not be in SDK types yet
      const blob = await this.client.textToVideo({
        model,
        inputs: input.text,
        parameters: options,
        provider
      });

      logger.aiSdk.info('Text-to-video completed', {
        model,
        provider,
        blobSize: blob.size,
        blobType: blob.type
      });

      return blob;
    } catch (error) {
      logger.aiSdk.error('Text-to-video failed', {
        model,
        provider,
        error: error instanceof Error ? error.message : error
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
      logger.aiSdk.debug('Text-to-speech inference', {
        model,
        text: input.text.substring(0, 50),
        provider
      });

      const blob = await this.client.textToSpeech({
        model,
        inputs: input.text,
        // @ts-ignore - SDK types may not match perfectly
        parameters: options,
        provider
      });

      logger.aiSdk.info('Text-to-speech completed', {
        model,
        blobSize: blob.size,
        blobType: blob.type
      });

      return blob;
    } catch (error) {
      logger.aiSdk.error('Text-to-speech failed', {
        model,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  }
}
