import {
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from 'ai';

export function shouldAutoSendAfterApproval(messages: UIMessage[]): boolean {
  if (!lastAssistantMessageIsCompleteWithApprovalResponses({ messages })) {
    return false;
  }

  const message = messages[messages.length - 1];
  if (!message || message.role !== 'assistant') {
    return false;
  }

  const lastStepStartIndex = message.parts.reduce((lastIndex, part, index) => {
    return part.type === 'step-start' ? index : lastIndex;
  }, -1);

  const lastStepToolParts = message.parts
    .slice(lastStepStartIndex + 1)
    .filter(isToolUIPart)
    .filter(part => !part.providerExecuted);

  return lastStepToolParts.some(
    part =>
      part.state === 'approval-responded' &&
      part.approval?.approved === true,
  );
}
