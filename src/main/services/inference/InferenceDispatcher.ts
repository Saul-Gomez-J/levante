import { HFInferenceClient } from './HFInferenceClient';
import type {
  InferenceCall,
  InferenceResult,
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
 * Dispatcher for Hugging Face Inference tasks
 * Routes inference calls to appropriate methods based on task type
 */
export class InferenceDispatcher {
  private client: HFInferenceClient;

  constructor(token: string) {
    this.client = new HFInferenceClient(token);
    logger.aiSdk.debug('InferenceDispatcher initialized');
  }

  /**
   * Dispatch an inference call to the appropriate handler
   * @param call - Inference call with task, model, input, and options
   * @returns Unified InferenceResult
   */
  async dispatch(call: InferenceCall): Promise<InferenceResult> {
    logger.aiSdk.debug('Dispatching inference call', {
      task: call.task,
      model: call.model
    });

    switch (call.task) {
      case 'text-generation':
        return this.handleTextGeneration(call);

      case 'text-to-image':
        return this.handleTextToImage(call);

      case 'image-text-to-text':
        return this.handleImageTextToText(call);

      case 'image-to-image':
        return this.handleImageToImage(call);

      case 'text-to-video':
        return this.handleTextToVideo(call);

      case 'text-to-speech':
        return this.handleTextToSpeech(call);

      case 'chat':
        throw new Error('Chat task should use Router API, not Inference API');

      default:
        throw new Error(`Unsupported inference task: ${call.task}`);
    }
  }

  /**
   * Handle text-generation task
   */
  private async handleTextGeneration(call: InferenceCall): Promise<InferenceResult> {
    const input = call.input as TextGenerationInput;
    const options = call.options as TextGenerationOptions | undefined;

    const text = await this.client.textGeneration(call.model, input, options, call.provider);

    return {
      kind: 'text',
      text
    };
  }

  /**
   * Handle text-to-image task
   */
  private async handleTextToImage(call: InferenceCall): Promise<InferenceResult> {
    const input = call.input as TextToImageInput;
    const options = call.options as TextToImageOptions | undefined;

    const blob = await this.client.textToImage(call.model, input, options, call.provider);

    // Convert Blob to base64 dataURL
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');
    const mime = blob.type || 'image/png';
    const dataUrl = `data:${mime};base64,${base64}`;

    return {
      kind: 'image',
      mime,
      dataUrl
    };
  }

  /**
   * Handle image-text-to-text task (multimodal)
   */
  private async handleImageTextToText(call: InferenceCall): Promise<InferenceResult> {
    const input = call.input as ImageTextToTextInput;

    const text = await this.client.imageTextToText(call.model, input, call.provider);

    return {
      kind: 'text',
      text
    };
  }

  /**
   * Handle image-to-image task
   */
  private async handleImageToImage(call: InferenceCall): Promise<InferenceResult> {
    const input = call.input as ImageToImageInput;
    const options = call.options as ImageToImageOptions | undefined;

    const blob = await this.client.imageToImage(call.model, input, options, call.provider);

    // Convert Blob to base64 dataURL
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');
    const mime = blob.type || 'image/png';
    const dataUrl = `data:${mime};base64,${base64}`;

    return {
      kind: 'image',
      mime,
      dataUrl
    };
  }

  /**
   * Handle text-to-video task
   */
  private async handleTextToVideo(call: InferenceCall): Promise<InferenceResult> {
    const input = call.input as TextToVideoInput;
    const options = call.options as TextToVideoOptions | undefined;

    const blob = await this.client.textToVideo(call.model, input, options, call.provider);

    // Convert Blob to base64 dataURL
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');
    const mime = blob.type || 'video/mp4';
    const dataUrl = `data:${mime};base64,${base64}`;

    return {
      kind: 'video',
      mime,
      dataUrl
    };
  }

  /**
   * Handle text-to-speech task
   */
  private async handleTextToSpeech(call: InferenceCall): Promise<InferenceResult> {
    const input = call.input as TextToSpeechInput;
    const options = call.options as TextToSpeechOptions | undefined;

    const blob = await this.client.textToSpeech(call.model, input, options, call.provider);

    // Convert Blob to base64 dataURL
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');
    const mime = blob.type || 'audio/wav';
    const dataUrl = `data:${mime};base64,${base64}`;

    return {
      kind: 'audio',
      mime,
      dataUrl
    };
  }
}
