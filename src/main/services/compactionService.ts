import type { UIMessage } from 'ai';
import type { Message } from '../../types/database';
import { chatService } from './chatService';
import { getLogger } from './logging';

const COMPACTION_MARKER = '[COMPACTION_SUMMARY]';
const CHARS_PER_TOKEN = 4;
export interface CompactInput {
  sessionId: string;
  model: string;
}

export interface CompactResult {
  success: boolean;
  summaryMessageId?: string;
  error?: string;
}

export class CompactionService {
  private logger = getLogger();

  private estimateTokens(text: string): number {
    return Math.max(0, Math.round((text || '').length / CHARS_PER_TOKEN));
  }

  private estimateMessageTokens(message: Message): number {
    const contentTokens = this.estimateTokens(message.content || '');
    const toolTokens = message.tool_calls ? this.estimateTokens(message.tool_calls) : 0;
    const reasoningTokens = message.reasoningText ? this.estimateTokens(message.reasoningText) : 0;
    return contentTokens + toolTokens + reasoningTokens;
  }

  private prepareMessagesForSummary(messages: Message[]): Message[] {
    return messages.map((m) => {
      if (!m.tool_calls) return m;
      const toolTokens = this.estimateTokens(m.tool_calls);
      if (toolTokens <= 500) return m;

      return {
        ...m,
        tool_calls: JSON.stringify([{ summary: `[Tool output truncated: ~${toolTokens} tokens]` }]),
      };
    });
  }

  private serializeMessage(message: Message): string {
    const isSummary =
      message.role === 'system' &&
      typeof message.content === 'string' &&
      message.content.startsWith(COMPACTION_MARKER);

    const baseContent = isSummary
      ? `PREVIOUS_SUMMARY:\n${message.content.replace(COMPACTION_MARKER, '').trim()}`
      : message.content;

    const toolPart = message.tool_calls ? `\n\n[TOOL_CALLS]\n${message.tool_calls}` : '';
    const reasoningPart = message.reasoningText ? `\n\n[REASONING]\n${message.reasoningText}` : '';

    return `[${message.role.toUpperCase()}] ${baseContent}${toolPart}${reasoningPart}`;
  }

  private buildSummaryPrompt(): string {
    return `Create a compact but actionable summary to continue the conversation safely.

Format exactly:

## Goal
- ...

## Constraints
- ...

## Decisions
- ...

## Key Context
- ...

## Pending Work
- ...

## Active Files / Topics
- ...

Rules:
- Keep critical technical details.
- Keep unresolved questions.
- Do not invent facts.
- If context was truncated, mention that clearly.`;
  }

  private async generateSummary(input: { messages: Message[]; model: string }): Promise<string> {
    const { AIService } = await import('./aiService');
    const aiService = new AIService();

    const conversationText = input.messages.map((m) => this.serializeMessage(m)).join('\n\n');
    const prompt = this.buildSummaryPrompt();

    const message: UIMessage = {
      id: `compaction-${Date.now()}`,
      role: 'user',
      parts: [
        {
          type: 'text',
          text: `${conversationText}\n\n---\n\n${prompt}`,
        } as any,
      ],
    };

    const result = await aiService.sendSingleMessage({
      messages: [message],
      model: input.model,
      webSearch: false,
      enableMCP: false,
    });

    return result.response.trim();
  }

  async compact(input: CompactInput): Promise<CompactResult> {
    this.logger.aiSdk.info('Manual compaction started', {
      sessionId: input.sessionId,
      model: input.model,
    });

    try {
      const contextResult = await chatService.getMessagesForContext(input.sessionId);
      if (!contextResult.success) {
        return {
          success: false,
          error: contextResult.error || 'Failed to load conversation context',
        };
      }

      const contextMessages = contextResult.data;
      if (contextMessages.length === 0) {
        return { success: false, error: 'No messages to compact' };
      }

      const prepared = this.prepareMessagesForSummary(contextMessages);
      const summary = await this.generateSummary({
        messages: prepared,
        model: input.model,
      });

      const saved = await chatService.createMessage({
        session_id: input.sessionId,
        role: 'system',
        content: `${COMPACTION_MARKER}\n\n${summary}`,
      });

      if (!saved.success) {
        return {
          success: false,
          error: saved.error || 'Failed to persist compaction summary',
        };
      }

      this.logger.aiSdk.info('Manual compaction completed', {
        sessionId: input.sessionId,
        sourceMessages: contextMessages.length,
        sentToSummarizer: prepared.length,
        summaryLength: summary.length,
      });

      return {
        success: true,
        summaryMessageId: saved.data?.id,
      };
    } catch (error) {
      this.logger.aiSdk.error('Manual compaction failed', {
        sessionId: input.sessionId,
        error: error instanceof Error ? error.message : error,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const compactionService = new CompactionService();
