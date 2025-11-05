import { HFInferenceClient } from './HFInferenceClient';
import type {
  InferenceCall,
  InferenceResult,
  TextToImageInput,
  TextToImageOptions,
  ImageToTextInput,
  ASRInput,
  ASROptions
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
      case 'text-to-image':
        return this.handleTextToImage(call);

      case 'image-to-text':
        return this.handleImageToText(call);

      case 'automatic-speech-recognition':
        return this.handleASR(call);

      case 'chat':
        throw new Error('Chat task should use Router API, not Inference API');

      default:
        throw new Error(`Unsupported inference task: ${call.task}`);
    }
  }

  /**
   * Handle text-to-image task
   */
  private async handleTextToImage(call: InferenceCall): Promise<InferenceResult> {
    const input = call.input as TextToImageInput;
    const options = call.options as TextToImageOptions | undefined;

    const blob = await this.client.textToImage(call.model, input, options);

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
   * Handle image-to-text task
   */
  private async handleImageToText(call: InferenceCall): Promise<InferenceResult> {
    const input = call.input as ImageToTextInput;

    const text = await this.client.imageToText(call.model, input);

    return {
      kind: 'text',
      text
    };
  }

  /**
   * Handle automatic speech recognition task
   */
  private async handleASR(call: InferenceCall): Promise<InferenceResult> {
    const input = call.input as ASRInput;
    const options = call.options as ASROptions | undefined;

    const text = await this.client.automaticSpeechRecognition(call.model, input, options);

    return {
      kind: 'text',
      text
    };
  }
}
