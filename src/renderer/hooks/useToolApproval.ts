import { useState, useCallback, useEffect } from 'react';
import { useToolApprovalStore } from '@/stores/toolApprovalStore';
import type { UIMessage } from 'ai';

interface PendingApproval {
  approvalId: string;
  toolName: string;
  toolCallId: string;
  serverId: string;
  input: Record<string, unknown>;
}

interface UseToolApprovalOptions {
  sessionId: string | null;
  messages: UIMessage[];
  addToolApprovalResponse: (params: {
    id: string;
    approved: boolean;
    reason?: string;
  }) => void;
  // Callback cuando se deniega una tool (para actualizar UI)
  onToolDenied?: (info: {
    toolName: string;
    serverId: string;
    feedback?: string;
  }) => void;
}

export function useToolApproval({
  sessionId,
  messages,
  addToolApprovalResponse,
  onToolDenied,
}: UseToolApprovalOptions) {
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const { isServerApprovedForSession, approveServerForSession } = useToolApprovalStore();

  // Detectar tool-approval-request en los mensajes
  useEffect(() => {
    if (!sessionId) {
      return;
    }

    // Buscar en el último mensaje del assistant
    const lastMessage = messages.filter(m => m.role === 'assistant').pop();
    if (!lastMessage) {
      return;
    }

    for (const part of lastMessage.parts) {
      // Para tools MCP con schema, el tipo es 'tool-{serverId}_{toolName}'
      // Para tools dinámicas sin schema, el tipo es 'dynamic-tool'
      const isToolPart = part.type.startsWith('tool-') || part.type === 'dynamic-tool';
      if (isToolPart && (part as any).state === 'approval-requested') {
        // DEBUG: Log the entire part structure to understand what AI SDK provides
        const partAnyDebug = part as any;
        console.log('[useToolApproval] Tool part with approval-requested:', {
          type: part.type,
          state: partAnyDebug.state,
          toolName: partAnyDebug.toolName,
          toolCallId: partAnyDebug.toolCallId,
          input: partAnyDebug.input,
          inputStringified: JSON.stringify(partAnyDebug.input),
          args: partAnyDebug.args,
          argsStringified: JSON.stringify(partAnyDebug.args),
          approval: partAnyDebug.approval,
          allKeys: Object.keys(partAnyDebug),
          // Check for nested structures
          toolInvocation: partAnyDebug.toolInvocation,
          toolCall: partAnyDebug.toolCall,
        });
        // Log the raw part object to inspect in console
        console.log('[useToolApproval] RAW part object:', part);

        const toolName = (part as any).toolName || part.type.replace(/^tool-/, '');
        const serverId = extractServerId(toolName);

        // Obtener el approval ID de forma segura
        const approvalId = (part as any).approval?.id;
        if (!approvalId) {
          continue;
        }

        // Si ya está aprobado para esta sesión, auto-aprobar
        if (isServerApprovedForSession(sessionId, serverId)) {
          addToolApprovalResponse({
            id: approvalId,
            approved: true,
            reason: 'Auto-approved for this session',
          });
          return;
        }

        // Si no está aprobado, mostrar diálogo
        // Buscar input en diferentes ubicaciones posibles del AI SDK
        const partAny = part as any;
        const extractedInput =
          partAny.input ??
          partAny.args ??
          partAny.toolInput ??
          {};

        console.log('[useToolApproval] Extracted input:', extractedInput);

        setPendingApproval({
          approvalId,
          toolName,
          toolCallId: (part as any).toolCallId,
          serverId,
          input: extractedInput as Record<string, unknown>,
        });
        return;
      }
    }
  }, [messages, sessionId, isServerApprovedForSession, addToolApprovalResponse]);

  // Handler: Aprobar una vez
  const handleApprove = useCallback(async () => {
    if (!pendingApproval) return;

    // 1. Enviar respuesta al main process (desbloquea el stream)
    const result = await window.levante.sendToolApprovalResponse(
      pendingApproval.approvalId,
      true
    );

    if (!result.success) {
      console.error("Failed to send approval response:", result.error);
    }

    // 2. Tambien llamar al hook del AI SDK para actualizar el UI
    addToolApprovalResponse({
      id: pendingApproval.approvalId,
      approved: true,
    });

    setPendingApproval(null);
  }, [pendingApproval, addToolApprovalResponse]);

  // Handler: Aprobar para la sesion
  const handleApproveForSession = useCallback(async () => {
    if (!pendingApproval || !sessionId) return;

    // 1. Enviar respuesta al main process (desbloquea el stream)
    const result = await window.levante.sendToolApprovalResponse(
      pendingApproval.approvalId,
      true,
      'Approved for this session'
    );

    if (!result.success) {
      console.error("Failed to send approval response:", result.error);
    }

    // 2. Guardar en el store
    approveServerForSession(sessionId, pendingApproval.serverId);

    // 3. Tambien llamar al hook del AI SDK para actualizar el UI
    addToolApprovalResponse({
      id: pendingApproval.approvalId,
      approved: true,
      reason: 'Approved for this session',
    });

    setPendingApproval(null);
  }, [pendingApproval, sessionId, approveServerForSession, addToolApprovalResponse]);

  // Handler: Denegar con feedback
  // NOTE: We do NOT call stop() here. The AI SDK's sendAutomatically will trigger
  // a second request, and the server will short-circuit it and return a fast response.
  const handleDeny = useCallback(async (feedback?: string) => {
    if (!pendingApproval) return;

    const reason = feedback || 'User denied the tool execution';

    // 1. Enviar respuesta al main process (desbloquea el stream)
    const result = await window.levante.sendToolApprovalResponse(
      pendingApproval.approvalId,
      false,
      reason
    );

    if (!result.success) {
      console.error("Failed to send denial response:", result.error);
    }

    // 2. Tambien llamar al hook del AI SDK para actualizar el UI
    addToolApprovalResponse({
      id: pendingApproval.approvalId,
      approved: false,
      reason,
    });

    // 3. Notificar a ChatPage para actualizar UI
    onToolDenied?.({
      toolName: pendingApproval.toolName,
      serverId: pendingApproval.serverId,
      feedback,
    });

    // 4. Limpiar estado local
    setPendingApproval(null);
  }, [pendingApproval, addToolApprovalResponse, onToolDenied]);

  // Handler: Cerrar diálogo sin acción (equivalente a denegar)
  const handleClose = useCallback(() => {
    handleDeny('User dismissed the approval dialog');
  }, [handleDeny]);

  return {
    pendingApproval,
    handleApprove,
    handleApproveForSession,
    handleDeny,
    handleClose,
  };
}

// Utilidad: Extraer serverId del toolName
// Formato: {serverId}_{toolName}
function extractServerId(toolId: string): string {
  const underscoreIndex = toolId.indexOf('_');
  if (underscoreIndex === -1) return toolId;
  return toolId.substring(0, underscoreIndex);
}
