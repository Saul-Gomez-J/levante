import { describe, it, expect } from 'vitest';
import type { UIMessage } from 'ai';
import { shouldAutoSendAfterApproval } from '../toolApprovalAutoSend';

function makeToolPart(overrides: Record<string, unknown> = {}) {
  return {
    type: 'tool-invocation' as const,
    toolCallId: overrides.toolCallId ?? 'call_1',
    toolName: overrides.toolName ?? 'bash',
    args: {},
    ...overrides,
  };
}

function makeAssistantMessage(
  parts: any[],
  id = 'msg-1',
): UIMessage {
  return {
    id,
    role: 'assistant',
    parts,
  } as UIMessage;
}

describe('shouldAutoSendAfterApproval', () => {
  it('returns false when a tool in the last step is still approval-requested', () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        { type: 'step-start' },
        makeToolPart({
          toolCallId: 'call_1',
          state: 'approval-responded',
          approval: { id: 'a1', approved: true },
        }),
        makeToolPart({
          toolCallId: 'call_2',
          state: 'approval-requested',
          approval: { id: 'a2' },
        }),
      ]),
    ];
    expect(shouldAutoSendAfterApproval(messages)).toBe(false);
  });

  it('returns true when all tools in last step are responded and at least one is approved', () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        { type: 'step-start' },
        makeToolPart({
          toolCallId: 'call_1',
          state: 'approval-responded',
          approval: { id: 'a1', approved: true },
        }),
        makeToolPart({
          toolCallId: 'call_2',
          state: 'approval-responded',
          approval: { id: 'a2', approved: false },
        }),
      ]),
    ];
    expect(shouldAutoSendAfterApproval(messages)).toBe(true);
  });

  it('returns false when all tools in last step were denied', () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        { type: 'step-start' },
        makeToolPart({
          toolCallId: 'call_1',
          state: 'approval-responded',
          approval: { id: 'a1', approved: false },
        }),
        makeToolPart({
          toolCallId: 'call_2',
          state: 'approval-responded',
          approval: { id: 'a2', approved: false },
        }),
      ]),
    ];
    expect(shouldAutoSendAfterApproval(messages)).toBe(false);
  });

  it('ignores tools from previous steps', () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        // Previous step with a pending approval — should be ignored
        { type: 'step-start' },
        makeToolPart({
          toolCallId: 'call_old',
          state: 'approval-requested',
          approval: { id: 'a_old' },
        }),
        // Last step — all responded, one approved
        { type: 'step-start' },
        makeToolPart({
          toolCallId: 'call_1',
          state: 'approval-responded',
          approval: { id: 'a1', approved: true },
        }),
      ]),
    ];
    expect(shouldAutoSendAfterApproval(messages)).toBe(true);
  });

  it('ignores tools with providerExecuted === true', () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        { type: 'step-start' },
        makeToolPart({
          toolCallId: 'call_provider',
          state: 'output-available',
          providerExecuted: true,
          output: 'result',
        }),
        makeToolPart({
          toolCallId: 'call_1',
          state: 'approval-responded',
          approval: { id: 'a1', approved: true },
        }),
      ]),
    ];
    expect(shouldAutoSendAfterApproval(messages)).toBe(true);
  });

  it('supports dynamic-tool parts', () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        { type: 'step-start' },
        {
          type: 'dynamic-tool',
          toolCallId: 'call_dyn',
          toolName: 'dynamic_bash',
          args: {},
          state: 'approval-responded',
          approval: { id: 'a_dyn', approved: true },
        },
      ]),
    ];
    expect(shouldAutoSendAfterApproval(messages)).toBe(true);
  });

  it('returns false for empty messages', () => {
    expect(shouldAutoSendAfterApproval([])).toBe(false);
  });

  it('returns false when last message is from user', () => {
    const messages: UIMessage[] = [
      {
        id: 'msg-user',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
      } as UIMessage,
    ];
    expect(shouldAutoSendAfterApproval(messages)).toBe(false);
  });
});
