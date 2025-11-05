import { HfInference } from '@huggingface/inference';
import type {
  TextToImageInput,
  TextToImageOptions,
  ImageToTextInput,
  ASRInput,
  ASROptions
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
   * Text-to-Image: Generate images from text prompts
   * @param model - HF model ID (e.g., "black-forest-labs/FLUX.1-dev")
   * @param input - Prompt and options
   * @returns Blob containing the generated image
   */
  async textToImage(
    model: string,
    input: TextToImageInput,
    options?: TextToImageOptions
  ): Promise<Blob> {
    try {
      logger.aiSdk.debug('Text-to-image inference', { model, prompt: input.prompt });

      const blob = await this.client.textToImage({
        model,
        inputs: input.prompt,
        parameters: options
      });

      logger.aiSdk.info('Text-to-image completed', {
        model,
        blobSize: blob.size,
        blobType: blob.type
      });

      return blob;
    } catch (error) {
      logger.aiSdk.error('Text-to-image failed', {
        model,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  }

  /**
   * Image-to-Text: Generate text descriptions from images
   * @param model - HF model ID (e.g., "Salesforce/blip-image-captioning-large")
   * @param input - Image as Buffer or Blob
   * @returns Text description
   */
  async imageToText(
    model: string,
    input: ImageToTextInput
  ): Promise<string> {
    try {
      logger.aiSdk.debug('Image-to-text inference', { model });

      const result = await this.client.imageToText({
        model,
        data: input.image
      });

      logger.aiSdk.info('Image-to-text completed', {
        model,
        textLength: result.generated_text.length
      });

      return result.generated_text;
    } catch (error) {
      logger.aiSdk.error('Image-to-text failed', {
        model,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  }

  /**
   * Automatic Speech Recognition: Transcribe audio to text
   * @param model - HF model ID (e.g., "openai/whisper-large-v3")
   * @param input - Audio as Buffer or Blob
   * @param options - Language and other options
   * @returns Transcribed text
   */
  async automaticSpeechRecognition(
    model: string,
    input: ASRInput,
    options?: ASROptions
  ): Promise<string> {
    try {
      logger.aiSdk.debug('ASR inference', { model, language: options?.language });

      const result = await this.client.automaticSpeechRecognition({
        model,
        data: input.audio,
        // @ts-ignore - SDK types may not match perfectly
        parameters: options
      });

      logger.aiSdk.info('ASR completed', {
        model,
        textLength: result.text.length
      });

      return result.text;
    } catch (error) {
      logger.aiSdk.error('ASR failed', {
        model,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  }
}
