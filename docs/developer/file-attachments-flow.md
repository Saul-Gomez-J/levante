# File Attachments Flow Documentation

Complete technical documentation of how document and image loading works in Levante, from the ChatPage UI to model inference.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [File Loading in ChatPage](#file-loading-in-chatpage)
- [File Validation](#file-validation)
- [Sending to Models](#sending-to-models)
- [IPC Transport Layer](#ipc-transport-layer)
- [Main Process Processing](#main-process-processing)
- [Special Cases: Inference Models](#special-cases-inference-models)
- [Key System Features](#key-system-features)

## Overview

The file attachment system in Levante handles the complete lifecycle of user-uploaded files:
1. Selection and validation in the renderer process
2. Conversion to appropriate formats (base64, Blob)
3. Persistence to disk for chat history
4. Transmission to AI models via IPC
5. Integration with AI SDK and inference APIs

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Renderer Process                         │
├─────────────────────────────────────────────────────────────────┤
│  ChatPage.tsx                                                    │
│    ↓                                                             │
│  useFileAttachments Hook                                         │
│    ├─ Drag & Drop / File Selection                              │
│    ├─ Validation (size, type, dimensions)                       │
│    ├─ Convert to base64 data URLs                               │
│    └─ Save to disk via IPC                                      │
│    ↓                                                             │
│  ElectronChatTransport                                           │
│    └─ Inject attachments into messages                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓ IPC
┌─────────────────────────────────────────────────────────────────┐
│                          Main Process                            │
├─────────────────────────────────────────────────────────────────┤
│  chatHandlers.ts → aiService.ts                                  │
│    ├─ includeAttachmentsInMessageParts()                        │
│    ├─ convertAttachmentToFilePart()                             │
│    └─ Send to AI SDK or Inference API                           │
│                                                                  │
│  AI SDK (Chat Models)              Inference Dispatcher          │
│    └─ FilePart format                └─ Blob format (HF API)    │
└─────────────────────────────────────────────────────────────────┘
```

## File Loading in ChatPage

**Location:** `src/renderer/pages/ChatPage.tsx`

### useFileAttachments Hook

The ChatPage component uses the `useFileAttachments` hook to manage all file-related operations:

```typescript
// Lines 111-130
const {
  attachedFiles,              // Files in local state
  handleFilesSelected,        // Validation and adding files
  handleFileRemove,           // Remove files
  processAttachments,         // Save to disk
  convertFilesToInferenceData,
  supportsFileAttachment,     // Check if model supports files
  clearAttachments,
} = useFileAttachments({
  modelTaskType,
  modelCapabilities: currentModelInfo?.capabilities,
});
```

### File Upload Methods

1. **Manual Selection** - File picker via attach button
2. **Drag & Drop** - Dragging files into the chat window

```typescript
// Lines 690-703 - Drag overlay with visual feedback
{isDragging && enableFileAttachment && (
  <div className="absolute inset-0 z-50 bg-primary/10 backdrop-blur-sm">
    <div className="text-center">
      <p className="text-lg font-semibold text-primary">Drop images here</p>
      <p className="text-sm text-muted-foreground mt-1">to attach them to your message</p>
    </div>
  </div>
)}
```

## File Validation

**Location:** `src/renderer/hooks/useFileAttachments.ts`

### Validation Rules

```typescript
// Lines 21-24
const MAX_FILE_SIZE = 10 * 1024 * 1024;  // 10MB limit
const MIN_IMAGE_DIMENSION = 256;          // Minimum px for inference models
const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp'
];
```

### Validation Process

The `handleFilesSelected` function (lines 172-254) validates files through multiple checks:

#### 1. File Size Validation
```typescript
if (file.size > MAX_FILE_SIZE) {
  errors.push(`${file.name}: File size exceeds 10MB limit`);
  logger.core.warn('File size exceeds limit', {
    filename: file.name,
    size: file.size,
    maxSize: MAX_FILE_SIZE,
  });
  continue;
}
```

#### 2. MIME Type Validation
```typescript
const allowedTypes = getAllowedMimeTypes();
if (!allowedTypes.includes(file.type)) {
  errors.push(
    `${file.name}: Only ${typeDescription} are supported for this model (got ${file.type})`
  );
  continue;
}
```

#### 3. Image Dimensions Validation (for inference models)
```typescript
// Lines 82-100 - Get image dimensions helper
function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Lines 203-217 - Validation for image-to-image models
if (requiresMinDimensions) {
  const dimensions = await getImageDimensions(file);
  if (dimensions.width < MIN_IMAGE_DIMENSION || dimensions.height < MIN_IMAGE_DIMENSION) {
    errors.push(
      `${file.name}: Image must be at least ${MIN_IMAGE_DIMENSION}x${MIN_IMAGE_DIMENSION}px`
    );
    continue;
  }
}
```

## Sending to Models

**Location:** `src/renderer/pages/ChatPage.tsx:364-540`

### Two Message Flow Patterns

#### Flow A: First Message (No Session)

```typescript
// Lines 404-441
if (!currentSession) {
  // 1. Create new session
  const newSession = await createSession('New Chat', model, sessionType);

  // 2. Save message and files as pending
  setPendingFirstMessage(messageText);
  setPendingFirstAttachments(filesToAttach);

  // 3. useEffect at line 543-659 will send them later
  return;
}
```

#### Flow B: Existing Session

```typescript
// Lines 444-538
const messageId = `user-${Date.now()}`;

// 1. Convert files to inference format (base64 data URLs)
const attachmentDataForInference = [];
for (const file of filesToAttach) {
  const arrayBuffer = await file.arrayBuffer();
  const base64 = btoa(
    new Uint8Array(arrayBuffer).reduce(
      (data, byte) => data + String.fromCharCode(byte),
      ''
    )
  );

  attachmentDataForInference.push({
    type: file.type.startsWith('image/') ? 'image' : 'audio',
    data: `data:${file.type};base64,${base64}`,
    mime: file.type,
    filename: file.name
  });
}

// 2. Save files to disk
const savedAttachments = await processAttachments(
  filesToAttach,
  currentSession.id,
  messageId
);

// 3. Persist message to database with file references
await persistMessage({
  id: messageId,
  role: 'user',
  parts: [{ type: 'text', text: messageText }],
  attachments: savedAttachments  // DB references
});

// 4. Send to AI with attachments in base64
await sendMessageAI(
  { text: messageText },
  {
    body: {
      attachments: attachmentDataForInference  // Base64 data for AI
    }
  }
);
```

### Dual Storage Strategy

Files are stored in two formats simultaneously:

1. **Base64 in memory** - For transmission to AI models
2. **Files on disk** - For persistence and chat history (via `processAttachments`)

```typescript
// Lines 307-349 - processAttachments function
const processAttachments = async (
  files: File[],
  sessionId: string,
  messageId: string
): Promise<SavedAttachment[]> => {
  const attachmentResults = [];

  for (const file of files) {
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
    }
  }

  return attachmentResults;
};
```

## IPC Transport Layer

**Location:** `src/renderer/transports/ElectronChatTransport.ts`

### Attachment Injection

The transport extracts attachments from the request body and injects them into the last user message:

```typescript
// Lines 59-105
async sendMessages(options) {
  const { messages, body } = options;

  // Extract attachments from body
  const attachments = body?.attachments;

  if (attachments && attachments.length > 0) {
    // Find the last user message
    const lastUserMessageIndex = messages
      .map((m) => m.role)
      .lastIndexOf("user");

    if (lastUserMessageIndex !== -1) {
      // Inject attachments into that message
      messagesWithAttachments[lastUserMessageIndex] = {
        ...messagesWithAttachments[lastUserMessageIndex],
        attachments  // Array of { type, data, mime, filename }
      };
    }
  }

  // Create IPC request
  const request: ChatRequest = {
    messages: messagesWithAttachments,
    model,
    enableMCP,
  };

  // Stream via Electron IPC
  await window.levante.streamChat(request, callback);
}
```

### Attachment Format

Attachments sent through IPC have this structure:

```typescript
type RendererAttachmentPayload = {
  type: 'image' | 'audio' | 'video';
  data: string;      // Base64 data URL
  mime: string;      // MIME type
  filename: string;  // Original filename
};
```

## Main Process Processing

**Location:** `src/main/services/aiService.ts`

### Converting Attachments to AI SDK Format

The main process converts renderer attachments into AI SDK FilePart format:

```typescript
// Lines 123-150
private includeAttachmentsInMessageParts(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    if (message.role !== "user") return message;

    const attachments = message.attachments;
    if (!attachments?.length) return message;

    // Convert each attachment to FilePart
    const fileParts = attachments
      .map(attachment => this.convertAttachmentToFilePart(attachment))
      .filter(Boolean);

    if (fileParts.length === 0) return message;

    // Add fileParts to message
    const existingParts = Array.isArray(message.parts) ? [...message.parts] : [];
    return {
      ...message,
      parts: [...existingParts, ...fileParts]
    };
  });
}
```

### FilePart Conversion

```typescript
// Lines 155-192
private convertAttachmentToFilePart(
  attachment: RendererAttachmentPayload
): FileUIPart | null {
  // Validate data presence
  if (!attachment || !attachment.data) {
    this.logger.aiSdk.debug("Skipping attachment without data payload");
    return null;
  }

  // Infer MIME type if missing
  const mediaType = attachment.mime ||
    this.inferMimeTypeFromFilename(attachment.filename) ||
    "application/octet-stream";

  // Currently only images supported for chat providers
  if (!mediaType.startsWith("image/")) {
    this.logger.aiSdk.debug(
      "Attachment media type not yet supported for chat providers",
      { mediaType }
    );
    return null;
  }

  // Ensure data URL format
  const url = attachment.data.startsWith("data:")
    ? attachment.data
    : `data:${mediaType};base64,${attachment.data}`;

  return {
    type: "file",
    mediaType,
    filename: attachment.filename,
    url  // data:image/png;base64,xxxxx
  };
}
```

### MIME Type Inference

```typescript
// Lines 194-215
private inferMimeTypeFromFilename(filename?: string): string | undefined {
  if (!filename || !filename.includes(".")) {
    return undefined;
  }

  const extension = filename.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    default:
      return undefined;
  }
}
```

### Sending to AI Models

```typescript
// Lines 593-603
const messagesWithFileParts = this.includeAttachmentsInMessageParts(messages);

const result = streamText({
  model: modelProvider,
  messages: convertToModelMessages(messagesWithFileParts),  // ← Conversion happens here
  tools,
  system: await buildSystemPrompt(...),
});
```

## Special Cases: Inference Models

**Location:** `src/main/services/aiService.ts:834-1124`

### Image-to-Image Models

Image-to-image models have a unique feature: they can reuse the last generated image from the conversation.

```typescript
case "image-to-image": {
  let imageData = null;
  let imageSource = "unknown";

  // 1. Try to use user-attached image first
  const imageAttachment = attachments.find(a => a.type === "image");

  if (imageAttachment?.data) {
    imageData = imageAttachment.data;
    imageSource = "user-attachment";
    this.logger.aiSdk.debug("Using user-attached image for image-to-image");
  } else {
    // 2. No attachment - search for last generated image in conversation
    this.logger.aiSdk.debug("No attachment provided, searching for previous generated image");
    const lastImage = await this.findLastGeneratedImage(messages);

    if (lastImage) {
      imageData = lastImage.data;
      imageSource = "previous-generation";
      this.logger.aiSdk.info("Using previous generated image for editing", {
        filename: lastImage.filename,
      });
    }
  }

  // 3. Error if no image found
  if (!imageData) {
    yield {
      error: "Image-to-image models require an image. Please attach an image or generate one first.",
      done: true,
    };
    return;
  }

  // 4. Convert to Blob for HuggingFace API
  const imageBlob = await this.dataURLToBlob(imageData);

  inferenceInput = {
    image: imageBlob,
    prompt: inputText || undefined
  };
  break;
}
```

### Finding Last Generated Image

```typescript
// Lines 218-281
private async findLastGeneratedImage(
  messages: UIMessage[]
): Promise<{ data: string; filename: string } | null> {
  // Search messages in reverse (most recent first)
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    if (message.role !== "assistant") continue;

    const attachments = message.attachments;
    if (!attachments || !Array.isArray(attachments)) continue;

    // Find the first image attachment
    const imageAttachment = attachments.find(att => att.type === "image");

    if (imageAttachment) {
      // If it has dataUrl, use it
      if (imageAttachment.dataUrl) {
        return {
          data: imageAttachment.dataUrl,
          filename: imageAttachment.filename,
        };
      }

      // Otherwise, load from storage
      const storagePath = imageAttachment.storagePath || imageAttachment.path;
      if (storagePath) {
        try {
          const loaded = await attachmentStorage.loadAttachment({
            ...imageAttachment,
            path: storagePath,
          });

          if (loaded.dataUrl) {
            return {
              data: loaded.dataUrl,
              filename: imageAttachment.filename,
            };
          }
        } catch (error) {
          this.logger.aiSdk.warn("Failed to load previous image from storage", {
            path: storagePath,
            error: error instanceof Error ? error.message : error,
          });
        }
      }
    }
  }

  return null;
}
```

### Multimodal Vision Models (image-text-to-text)

```typescript
// Lines 969-1004
case "image-text-to-text":
  // Requires image attachment
  if (attachments.length === 0) {
    yield {
      error: "Multimodal models require an image attachment. Please attach an image to your message.",
      done: true,
    };
    return;
  }

  // Get first image attachment
  const imageAttachmentVLM = attachments.find(a => a.type === "image");
  if (!imageAttachmentVLM) {
    yield {
      error: "No image found in attachments. Multimodal models require an image.",
      done: true,
    };
    return;
  }

  // Convert dataURL to Blob
  const imageBlobVLM = await this.dataURLToBlob(imageAttachmentVLM.data);

  inferenceInput = {
    image: imageBlobVLM,
    text: inputText || undefined,
    mimeType: imageBlobVLM.type || undefined,
    preferChatMode: true,
  };
  break;
```

### Data URL to Blob Conversion

```typescript
// Lines 75-84
private async dataURLToBlob(dataURL: string): Promise<Blob> {
  // Handle both data URLs and direct base64
  if (!dataURL.startsWith("data:")) {
    // Assume it's base64, add data URL prefix
    dataURL = `data:image/png;base64,${dataURL}`;
  }

  const response = await fetch(dataURL);
  return await response.blob();
}
```

## Key System Features

### 1. Dual Storage Strategy

Files are stored in two formats for different purposes:

- **Base64 in Memory**: For transmission to AI APIs
- **Files on Disk**: For persistence and chat history replay

### 2. Multi-Layer Validation

Validation happens at multiple stages:

- **Renderer**: Size, type, dimensions (immediate user feedback)
- **Main**: MIME type validation and inference

### 3. Model-Specific Support

Different models handle attachments differently:

- **Chat Models (vision)**: Images as FilePart via AI SDK
- **Inference Models**: Conversion to Blob for HuggingFace API
- **Image-to-Image**: Can reuse previously generated images

### 4. Image Reuse Feature

For iterative workflows, image-to-image models can automatically use the last generated image without requiring the user to re-attach it. This enables seamless image editing conversations.

### 5. Currently Supported Formats

**Fully Implemented:**
- Images: PNG, JPEG, GIF, WebP

**Defined but Partially Implemented:**
- Audio: MP3, WAV, OGG, FLAC, M4A
- Video: Limited support

### 6. File Size Limits

- **Maximum file size**: 10MB
- **Minimum image dimensions** (for inference models): 256x256px

## Related Files

- `src/renderer/pages/ChatPage.tsx` - Main chat UI with file handling
- `src/renderer/hooks/useFileAttachments.ts` - File validation and processing hook
- `src/renderer/transports/ElectronChatTransport.ts` - IPC transport layer
- `src/main/ipc/chatHandlers.ts` - IPC handlers in main process
- `src/main/services/aiService.ts` - AI service with attachment processing
- `src/main/services/attachmentStorage.ts` - Disk storage management
- `src/main/services/inference/InferenceDispatcher.ts` - Inference API integration

## Future Enhancements

Potential improvements to the file attachment system:

1. **PDF Support**: Enable document analysis with vision models
2. **Audio Support**: Full implementation for audio-to-text models
3. **Video Support**: Complete video processing pipeline
4. **Batch Upload**: Support for multiple files at once
5. **Compression**: Automatic image compression for large files
6. **Preview**: Thumbnail previews before sending
7. **Progress Indicators**: Upload progress for large files
