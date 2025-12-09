import { useState, useCallback } from 'react';
import { useModelStore } from '@/stores/modelStore';
import type { InferenceResult } from '../../types/inference';

interface UseInferenceResult {
  loading: boolean;
  error: string | null;
  result: InferenceResult | null;
  textToImage: (model: string, prompt: string, options?: any) => Promise<InferenceResult | null>;
  imageToText: (model: string, imageFile: File) => Promise<InferenceResult | null>;
  automaticSpeechRecognition: (model: string, audioFile: File, options?: any) => Promise<InferenceResult | null>;
  clearResult: () => void;
  clearError: () => void;
}

/**
 * Hook for managing Hugging Face Inference API calls
 *
 * Provides functions for:
 * - Text-to-Image generation
 * - Image-to-Text captioning
 * - Automatic Speech Recognition
 *
 * @returns {UseInferenceResult} Inference state and functions
 *
 * @example
 * const { textToImage, loading, result, error } = useInference();
 *
 * const generateImage = async () => {
 *   const result = await textToImage('black-forest-labs/FLUX.1-dev', 'A cat in space');
 *   if (result) {
 *     console.log(result.dataUrl); // Display image
 *   }
 * };
 */
export function useInference(): UseInferenceResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InferenceResult | null>(null);

  const providers = useModelStore((state) => state.providers);

  /**
   * Get Hugging Face provider and validate API key
   */
  const getHFProvider = useCallback(() => {
    const hfProvider = providers.find(p => p.id === 'huggingface');

    if (!hfProvider) {
      throw new Error('Hugging Face provider not found. Please configure it in the Model page.');
    }

    if (!hfProvider.apiKey) {
      throw new Error('Hugging Face API key not configured. Please add your API key in the Model page.');
    }

    return hfProvider;
  }, [providers]);

  /**
   * Text-to-Image: Generate images from text prompts
   */
  const textToImage = useCallback(async (
    model: string,
    prompt: string,
    options?: { width?: number; height?: number; num_inference_steps?: number }
  ): Promise<InferenceResult | null> => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const provider = getHFProvider();

      const response = await window.levante.inference.textToImage(
        provider.apiKey!,
        model,
        prompt,
        options
      );

      if (!response.success) {
        throw new Error(response.error || 'Failed to generate image');
      }

      setResult(response.data!);
      return response.data!;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, [getHFProvider]);

  /**
   * Image-to-Text: Generate text descriptions from images
   */
  const imageToText = useCallback(async (
    model: string,
    imageFile: File
  ): Promise<InferenceResult | null> => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const provider = getHFProvider();
      const buffer = await imageFile.arrayBuffer();

      const response = await window.levante.inference.imageToText(
        provider.apiKey!,
        model,
        buffer
      );

      if (!response.success) {
        throw new Error(response.error || 'Failed to caption image');
      }

      setResult(response.data!);
      return response.data!;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, [getHFProvider]);

  /**
   * Automatic Speech Recognition: Transcribe audio to text
   */
  const automaticSpeechRecognition = useCallback(async (
    model: string,
    audioFile: File,
    options?: { language?: string }
  ): Promise<InferenceResult | null> => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const provider = getHFProvider();
      const buffer = await audioFile.arrayBuffer();

      const response = await window.levante.inference.asr(
        provider.apiKey!,
        model,
        buffer,
        options
      );

      if (!response.success) {
        throw new Error(response.error || 'Failed to transcribe audio');
      }

      setResult(response.data!);
      return response.data!;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, [getHFProvider]);

  /**
   * Clear the current result
   */
  const clearResult = useCallback(() => {
    setResult(null);
  }, []);

  /**
   * Clear the current error
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    loading,
    error,
    result,
    textToImage,
    imageToText,
    automaticSpeechRecognition,
    clearResult,
    clearError,
  };
}
