/**
 * Tool Approval Manager
 *
 * Gestiona las solicitudes de aprobacion pendientes.
 * Permite que el stream de AI SDK pause y espere la respuesta del usuario.
 */

import { getLogger } from "../logging";

const logger = getLogger();

interface PendingApproval {
  approvalId: string;
  toolName: string;
  input: Record<string, any>;
  resolve: (response: ApprovalResponse) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

export interface ApprovalResponse {
  approved: boolean;
  reason?: string;
}

// Mapa de aprobaciones pendientes: approvalId -> Promise resolver
const pendingApprovals = new Map<string, PendingApproval>();

// Timeout para aprobaciones (5 minutos)
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Crea una promesa que se resolvera cuando el usuario responda.
 * El stream de AI SDK llamara a esta funcion y esperara (await).
 *
 * @param approvalId - ID unico de la solicitud de aprobacion
 * @param toolName - Nombre de la tool que requiere aprobacion
 * @param input - Argumentos de la tool
 * @returns Promise que se resuelve con la respuesta del usuario
 */
export function waitForApproval(
  approvalId: string,
  toolName: string,
  input: Record<string, any>
): Promise<ApprovalResponse> {
  return new Promise((resolve, reject) => {
    logger.aiSdk.info("Waiting for user approval", {
      approvalId,
      toolName,
      inputKeys: Object.keys(input),
    });

    const pending: PendingApproval = {
      approvalId,
      toolName,
      input,
      resolve,
      reject,
      timestamp: Date.now(),
    };

    pendingApprovals.set(approvalId, pending);

    // Timeout de seguridad
    setTimeout(() => {
      if (pendingApprovals.has(approvalId)) {
        logger.aiSdk.warn("Approval request timed out", { approvalId, toolName });
        pendingApprovals.delete(approvalId);
        reject(new Error(`Approval request timed out for tool: ${toolName}`));
      }
    }, APPROVAL_TIMEOUT_MS);
  });
}

/**
 * Resuelve una solicitud de aprobacion pendiente.
 * El frontend llama a esta funcion cuando el usuario responde.
 *
 * @param approvalId - ID de la solicitud
 * @param approved - true si el usuario aprobo
 * @param reason - Razon opcional (principalmente para denegaciones)
 */
export function resolveApproval(
  approvalId: string,
  approved: boolean,
  reason?: string
): boolean {
  const pending = pendingApprovals.get(approvalId);

  if (!pending) {
    logger.aiSdk.warn("No pending approval found", { approvalId });
    return false;
  }

  logger.aiSdk.info("Resolving approval", {
    approvalId,
    toolName: pending.toolName,
    approved,
    reason,
    waitTimeMs: Date.now() - pending.timestamp,
  });

  pendingApprovals.delete(approvalId);
  pending.resolve({ approved, reason });

  return true;
}

/**
 * Cancela todas las aprobaciones pendientes.
 * Util cuando el usuario cancela el stream o cambia de sesion.
 */
export function cancelAllPendingApprovals(): void {
  const count = pendingApprovals.size;

  if (count > 0) {
    logger.aiSdk.info("Cancelling all pending approvals", { count });

    for (const [approvalId, pending] of pendingApprovals) {
      pending.reject(new Error("Approval cancelled"));
    }

    pendingApprovals.clear();
  }
}

/**
 * Obtiene el numero de aprobaciones pendientes.
 */
export function getPendingApprovalsCount(): number {
  return pendingApprovals.size;
}
