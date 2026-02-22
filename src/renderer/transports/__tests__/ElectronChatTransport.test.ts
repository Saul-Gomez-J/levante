import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ChatRequest } from '../../../preload/types';

// Mock window.levante
const capturedRequests: ChatRequest[] = [];

const mockLevante = {
  streamChat: vi.fn(async (request: ChatRequest, _onChunk: any) => {
    capturedRequests.push(request);
    // Immediately call onChunk with done
    _onChunk({ done: true });
  }),
  stopStreaming: vi.fn(),
};

vi.stubGlobal('window', { levante: mockLevante });

// Mock logger
vi.mock('@/services/logger', () => ({
  logger: {
    aiSdk: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock('@/utils/chunkBatcher', () => ({
  ChunkBatcher: class {
    constructor(private flush: (chunks: any[]) => void) {}
    add(chunk: any) { this.flush([chunk]); }
    destroy() {}
  },
}));

import { ElectronChatTransport, createElectronChatTransport } from '../ElectronChatTransport';
import type { UIMessage } from 'ai';

const mockMessages: UIMessage[] = [
  {
    id: 'msg-1',
    role: 'user',
    parts: [{ type: 'text', text: 'Hello' }],
  } as any,
];

async function sendAndCapture(transport: ElectronChatTransport): Promise<ChatRequest> {
  capturedRequests.length = 0;
  const stream = await transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat-1',
    messageId: 'msg-1',
    messages: mockMessages,
    abortSignal: undefined,
  } as any);

  // Consume the stream
  const reader = stream.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } catch {
    // ignore
  } finally {
    reader.releaseLock();
  }

  return capturedRequests[0];
}

describe('ElectronChatTransport', () => {
  describe('projectContext', () => {
    it('includes projectContext when projectId is set', async () => {
      const transport = createElectronChatTransport({
        model: 'openai/gpt-4o',
        projectId: 'proj_test_123',
      });

      const request = await sendAndCapture(transport);

      expect(request.projectContext).toBeDefined();
      expect(request.projectContext?.projectId).toBe('proj_test_123');
    });

    it('omits projectContext when projectId is null', async () => {
      const transport = createElectronChatTransport({
        model: 'openai/gpt-4o',
        projectId: null,
      });

      const request = await sendAndCapture(transport);

      expect(request.projectContext).toBeUndefined();
    });

    it('omits projectContext when projectId is not set', async () => {
      const transport = createElectronChatTransport({
        model: 'openai/gpt-4o',
      });

      const request = await sendAndCapture(transport);

      expect(request.projectContext).toBeUndefined();
    });

    it('updates projectId via updateOptions', async () => {
      const transport = createElectronChatTransport({
        model: 'openai/gpt-4o',
      });

      transport.updateOptions({ projectId: 'proj_updated' });

      const request = await sendAndCapture(transport);
      expect(request.projectContext?.projectId).toBe('proj_updated');
    });

    it('clears projectContext after setting projectId to null', async () => {
      const transport = createElectronChatTransport({
        model: 'openai/gpt-4o',
        projectId: 'proj_initial',
      });

      transport.updateOptions({ projectId: null });

      const request = await sendAndCapture(transport);
      expect(request.projectContext).toBeUndefined();
    });
  });
});
