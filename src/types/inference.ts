/**
 * Hugging Face Inference Types
 * Defines types for multi-task inference capabilities
 */

export type InferenceTask =
  | 'chat'                           // LLM chat completions (Router)
  | 'conversational'                 // HF conversational pipeline (chatCompletion API)
  | 'text-generation'                // Text generation / chat-compatible models
  | 'text2text-generation'           // Instruction-tuned seq2seq (T5, etc.)
  | 'text-to-image'                  // Generate images from text (FLUX, Stable Diffusion)
  | 'image-text-to-text'             // Multimodal models (LLaVA, vision models)
  | 'image-to-image'                 // Image transformation (ControlNet, img2img)
  | 'text-to-video'                  // Generate videos from text (new)
  | 'text-to-speech'                 // Generate audio from text (TTS models)
  | 'visual-question-answering'      // VQA style models
  | 'document-question-answering'    // Document QA models
  | 'table-question-answering';      // Table QA models

export interface InferenceCall<TInput = unknown, TOutput = unknown> {
  task: InferenceTask;
  model: string;           // Hugging Face model ID (e.g., "black-forest-labs/FLUX.1-dev")
  provider?: string;       // Inference provider slug (e.g., "featherless-ai", "novita", "fireworks-ai")
  input: TInput;          // Shape depends on task
  options?: Record<string, unknown>;  // Task-specific parameters
}

/**
 * Unified result type for different inference tasks
 */
export type InferenceResult =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mime: string; dataUrl: string }
  | { kind: 'video'; mime: string; dataUrl: string }
  | { kind: 'audio'; mime: string; dataUrl: string };

/**
 * Chat / conversational message types
 */
export type ChatMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'input_text'; text: string }
  | { type: 'image'; image_url: { url: string } }
  | { type: 'input_image'; image_url: { url: string } };

export interface HFChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'function';
  content: string | ChatMessageContentPart[];
  name?: string;
}

export interface ConversationalInput {
  messages: HFChatMessage[];
}

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
 * Image-Text-to-Text specific types (Multimodal)
 */
export interface ImageTextToTextInput {
  image: Buffer | Blob;
  text?: string;  // Optional text prompt/question about the image
  mimeType?: string; // Optional override if Blob is missing type
  preferChatMode?: boolean;
}

/**
 * Text-to-Video specific types
 */
export interface TextToVideoInput {
  text: string;
}

export interface TextToVideoOptions {
  num_frames?: number;
  fps?: number;
  duration?: number;
  guidance_scale?: number;
}

/**
 * Text Generation specific types
 */
export interface TextGenerationInput {
  prompt: string;
}

export interface TextGenerationOptions {
  max_new_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  repetition_penalty?: number;
}

/**
 * Image-to-Image specific types
 */
export interface ImageToImageInput {
  image: Buffer | Blob;
  prompt?: string;  // Optional guidance text
}

export interface ImageToImageOptions {
  strength?: number;  // How much to transform (0.0-1.0)
  guidance_scale?: number;
  num_inference_steps?: number;
}

/**
 * Text-to-Speech specific types
 */
export interface TextToSpeechInput {
  text: string;
}

export interface TextToSpeechOptions {
  voice?: string;
  speed?: number;
  language?: string;
}

export interface VisualQuestionAnsweringInput {
  image: Buffer | Blob;
  question: string;
}

export interface DocumentQuestionAnsweringInput {
  image: Buffer | Blob;
  question: string;
}

export interface TableQuestionAnsweringInput {
  table: Record<string, unknown> | Record<string, unknown>[] | string;
  query: string;
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
