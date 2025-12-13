/**
 * useFileAttachments Hook
 *
 * Handles file attachment logic including:
 * - File validation (size, type, dimensions)
 * - Drag & drop functionality
 * - File processing and saving
 */

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { getRendererLogger } from '@/services/logger';
import type { Model } from '../../types/models';
import type { ModelCapabilities } from '../../types/modelCategories';

const logger = getRendererLogger();

// ============================================================================
// Constants
// ============================================================================

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MIN_IMAGE_DIMENSION = 256; // px for inference image tasks
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3', 'audio/flac', 'audio/m4a'];
const ALLOWED_PDF_TYPES = ['application/pdf'];
const MAX_PDF_SIZE = 25 * 1024 * 1024; // 25MB for PDFs

// ============================================================================
// Types
// ============================================================================

export interface SavedAttachment {
  id: string;
  type: 'image' | 'audio' | 'video' | 'document';
  filename: string;
  mimeType: string;
  size: number;
  storagePath: string;
  path: string;
}

export interface AttachmentDataForInference {
  type: 'image' | 'audio' | 'video';
  data: string;
  mime: string;
  filename: string;
}

interface UseFileAttachmentsOptions {
  modelTaskType?: string;
  modelCapabilities?: ModelCapabilities;
  isStreaming?: boolean;
}

interface UseFileAttachmentsReturn {
  attachedFiles: File[];
  isDragging: boolean;
  setAttachedFiles: React.Dispatch<React.SetStateAction<File[]>>;
  handleFilesSelected: (files: File[]) => Promise<void>;
  handleFileRemove: (index: number) => void;
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => Promise<void>;
  processAttachments: (
    files: File[],
    sessionId: string,
    messageId: string
  ) => Promise<SavedAttachment[]>;
  convertFilesToInferenceData: (files: File[]) => Promise<AttachmentDataForInference[]>;
  getFileAccept: () => string;
  getAttachmentTitle: () => string;
  supportsFileAttachment: boolean;
  clearAttachments: () => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get image dimensions from a file
 */
function getImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      img.onerror = () => reject(new Error('Failed to load image data'));
      if (typeof event.target?.result === 'string') {
        img.src = event.target.result;
      } else {
        reject(new Error('Invalid image data'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useFileAttachments(options: UseFileAttachmentsOptions = {}): UseFileAttachmentsReturn {
  const { modelTaskType, modelCapabilities, isStreaming = false } = options;

  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Check if model supports file attachments
  // We allow attachments if:
  // 1. Task indicates image input (image-text-to-text, image-to-image)
  // 2. Model capabilities natively support vision
  // 3. For standard chat, we now support PDF extraction (Hybrid mode), so we allow it there too
  const supportsFileAttachment = !!(
    (modelTaskType && ['image-text-to-text', 'image-to-image', 'chat', 'inference'].includes(modelTaskType)) ||
    modelCapabilities?.supportsVision
  );

  // Get allowed MIME types based on current model task type
  const getAllowedMimeTypes = useCallback((): string[] => {
    switch (modelTaskType) {
      case 'image-text-to-text':
      case 'image-to-image':
        return ALLOWED_IMAGE_TYPES;
      default:
        // Hybrid support: Vision models get images+PDF, others get images+PDF (via extraction)
        // Ideally we should allow PDF for everyone now.
        return [...ALLOWED_IMAGE_TYPES, ...ALLOWED_PDF_TYPES];
    }
  }, [modelTaskType]);

  // Get file type description for error messages
  const getFileTypeDescription = useCallback((): string => {
    switch (modelTaskType) {
      case 'image-text-to-text':
      case 'image-to-image':
        return 'images';
      default:
        return 'images or PDFs';
    }
  }, [modelTaskType]);

  // Get file accept attribute based on model task type
  const getFileAccept = useCallback((): string => {
    // Always allow PDF + Images for generic chat (hybrid support)
    return 'image/*,.pdf,application/pdf';
  }, []);

  // Get attachment button title based on model task type
  const getAttachmentTitle = useCallback((): string => {
    // If model supports vision natively or via hybrid text extraction
    if (modelCapabilities?.supportsVision || true) { // Always true due to hybrid support, but keeping logic clear
      return 'Attach images or PDFs';
    }
    // This part of the code is effectively unreachable due to `|| true` above.
    // It's kept here for context if the `|| true` condition were to be removed.
    switch (modelTaskType) {
      case 'image-text-to-text':
        return 'Attach image for multimodal chat';
      case 'image-to-image':
        return 'Attach image for transformation';
      default:
        return 'Attach image';
    }
  }, [modelTaskType, modelCapabilities]);

  // Handle file selection with validation
  const handleFilesSelected = useCallback(async (files: File[]) => {
    const validFiles: File[] = [];
    const errors: string[] = [];
    const allowedTypes = getAllowedMimeTypes();
    const typeDescription = getFileTypeDescription();
    const requiresMinDimensions = modelTaskType === 'image-to-image';

    for (const file of files) {
      // Check file size
      const isPDF = file.type === 'application/pdf';
      const maxSize = isPDF ? MAX_PDF_SIZE : MAX_FILE_SIZE;

      if (file.size > maxSize) {
        errors.push(`${file.name}: File size exceeds ${maxSize / (1024 * 1024)}MB limit`);
        logger.core.warn('File size exceeds limit', {
          filename: file.name,
          size: file.size,
          maxSize,
        });
        continue;
      }

      // Check MIME type
      if (!allowedTypes.includes(file.type)) {
        errors.push(`${file.name}: Only ${typeDescription} are supported for this model (got ${file.type})`);
        logger.core.warn('File type not supported for model', {
          filename: file.name,
          mimeType: file.type,
          modelTaskType,
          allowedTypes,
        });
        continue;
      }

      if (requiresMinDimensions) {
        try {
          const dimensions = await getImageDimensions(file);
          if (!dimensions || dimensions.width < MIN_IMAGE_DIMENSION || dimensions.height < MIN_IMAGE_DIMENSION) {
            errors.push(
              `${file.name}: Image must be at least ${MIN_IMAGE_DIMENSION}x${MIN_IMAGE_DIMENSION}px (got ${dimensions?.width || 0}x${dimensions?.height || 0})`
            );
            logger.core.warn('Image dimensions too small for inference model', {
              filename: file.name,
              width: dimensions?.width,
              height: dimensions?.height,
              min: MIN_IMAGE_DIMENSION
            });
            continue;
          }
        } catch (error) {
          errors.push(`${file.name}: Unable to read image dimensions`);
          logger.core.error('Failed to read image dimensions', {
            filename: file.name,
            error: error instanceof Error ? error.message : error,
          });
          continue;
        }
      }

      validFiles.push(file);
    }

    // Add valid files
    if (validFiles.length > 0) {
      setAttachedFiles((prev) => {
        const newFiles = [...prev, ...validFiles];
        logger.core.info('📎 Files attached to state', {
          previousCount: prev.length,
          addedCount: validFiles.length,
          newTotalCount: newFiles.length,
          fileNames: validFiles.map(f => f.name),
          modelTaskType,
          supportsFileAttachment,
        });
        return newFiles;
      });
    }

    // Log errors if any
    if (errors.length > 0) {
      logger.core.error('File validation errors', { errors, modelTaskType });
      toast.error('Some files were rejected', {
        description: errors.join('\n'),
      });
    }
  }, [getAllowedMimeTypes, getFileTypeDescription, modelTaskType]);

  // Handle file removal
  const handleFileRemove = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
    logger.core.info('File removed', { index });
  }, []);

  // Clear all attachments
  const clearAttachments = useCallback(() => {
    setAttachedFiles([]);
  }, []);

  // Drag & Drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!supportsFileAttachment || isStreaming) return;

    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, [supportsFileAttachment, isStreaming]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Only set isDragging to false if we're leaving the main container
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (!supportsFileAttachment || isStreaming) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await handleFilesSelected(files);
    }
  }, [supportsFileAttachment, isStreaming, handleFilesSelected]);

  // Process and save attachments to disk
  const processAttachments = useCallback(async (
    files: File[],
    sessionId: string,
    messageId: string
  ): Promise<SavedAttachment[]> => {
    const attachmentResults: SavedAttachment[] = [];

    for (const file of files) {
      try {
        const buffer = await file.arrayBuffer();
        const result = await window.levante.attachments.save(
          sessionId,
          messageId,
          buffer,
          file.name,
          file.type
        );

        if (result.success && result.data) {
          attachmentResults.push({
            ...result.data,
            storagePath: result.data.path
          });
          logger.core.info('Attachment saved', {
            filename: file.name,
            attachmentId: result.data.id,
          });
        } else {
          logger.core.error('Failed to save attachment', {
            filename: file.name,
            error: result.error,
          });
        }
      } catch (error) {
        logger.core.error('Error processing attachment', {
          filename: file.name,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    return attachmentResults;
  }, []);

  // Convert files to data format for inference
  const convertFilesToInferenceData = useCallback(async (files: File[]): Promise<AttachmentDataForInference[]> => {
    const attachmentData: AttachmentDataForInference[] = [];

    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );
      const dataUrl = `data:${file.type};base64,${base64}`;

      attachmentData.push({
        type: file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'video',
        data: dataUrl,
        mime: file.type,
        filename: file.name
      });
    }

    return attachmentData;
  }, []);

  return {
    attachedFiles,
    isDragging,
    setAttachedFiles,
    handleFilesSelected,
    handleFileRemove,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    processAttachments,
    convertFilesToInferenceData,
    getFileAccept,
    getAttachmentTitle,
    supportsFileAttachment,
    clearAttachments,
  };
}
