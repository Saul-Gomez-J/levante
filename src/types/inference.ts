/**
 * Hugging Face Inference Types
 * Defines types for multi-task inference capabilities
 */

export type InferenceTask =
  | 'chat'                           // LLM chat completions (Router)
  | 'text-to-image'                  // Generate images from text (FLUX, Stable Diffusion)
  | 'image-to-text'                  // Image captioning/OCR (BLIP, etc.)
  | 'automatic-speech-recognition';  // Speech-to-text (Whisper, etc.)

export interface InferenceCall<TInput = unknown, TOutput = unknown> {
  task: InferenceTask;
  model: string;           // Hugging Face model ID (e.g., "black-forest-labs/FLUX.1-dev")
  input: TInput;          // Shape depends on task
  options?: Record<string, unknown>;  // Task-specific parameters
}

/**
 * Unified result type for different inference tasks
 */
export type InferenceResult =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mime: string; dataUrl: string }
  | { kind: 'audio'; mime: string; dataUrl: string };

/**
 * Text-to-Image specific types
 */
export interface TextToImageInput {
  prompt: string;
}

export interface TextToImageOptions {
  negative_prompt?: string;
  width?: number;
  height?: number;
  num_inference_steps?: number;
  guidance_scale?: number;
}

/**
 * Image-to-Text specific types
 */
export interface ImageToTextInput {
  image: Buffer | Blob;
}

/**
 * Automatic Speech Recognition specific types
 */
export interface ASRInput {
  audio: Buffer | Blob;
}

export interface ASROptions {
  language?: string;  // e.g., "en", "es"
}

/**
 * Attachment types for multimodal chat
 */
export interface MessageAttachment {
  type: 'image' | 'audio';
  data: string;  // base64 or dataURL
  mime: string;  // MIME type (e.g., "image/png", "audio/wav")
  filename?: string;
}
