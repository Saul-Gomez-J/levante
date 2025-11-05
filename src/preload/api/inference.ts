import { ipcRenderer } from 'electron';
import type { InferenceCall } from '../../types/inference';

export const inferenceApi = {
  /**
   * Generic inference dispatch - routes based on task type
   */
  dispatch: (apiKey: string, call: InferenceCall) =>
    ipcRenderer.invoke('levante/inference/dispatch', apiKey, call),

  /**
   * Text-to-Image: Generate images from text prompts
   */
  textToImage: (apiKey: string, model: string, prompt: string, options?: any) =>
    ipcRenderer.invoke('levante/inference/text-to-image', apiKey, model, prompt, options),

  /**
   * Image-to-Text: Generate text descriptions from images
   */
  imageToText: (apiKey: string, model: string, imageBuffer: ArrayBuffer, options?: any) =>
    ipcRenderer.invoke('levante/inference/image-to-text', apiKey, model, imageBuffer, options),

  /**
   * Automatic Speech Recognition: Transcribe audio to text
   */
  asr: (apiKey: string, model: string, audioBuffer: ArrayBuffer, options?: any) =>
    ipcRenderer.invoke('levante/inference/asr', apiKey, model, audioBuffer, options),
};
