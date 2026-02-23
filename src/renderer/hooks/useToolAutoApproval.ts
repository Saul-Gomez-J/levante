/**
 * useToolAutoApproval - Hook para manejar auto-aprobación de herramientas por sesión
 *
 * Este hook mantiene un estado en memoria de los servidores MCP cuyas herramientas
 * se deben auto-aprobar durante la sesión actual.
 */

import { useState, useCallback } from 'react';

interface UseToolAutoApprovalReturn {
  /** Set de IDs de servidores MCP auto-aprobados para esta sesión */
  autoApprovedServers: Set<string>;

  /** Añade un servidor a la lista de auto-aprobados */
  approveServerForSession: (serverId: string) => void;

  /** Verifica si un servidor está auto-aprobado */
  isServerAutoApproved: (serverId: string) => boolean;

  /** Limpia todos los auto-approvals (llamar al cambiar de sesión) */
  clearAutoApprovals: () => void;
}

export function useToolAutoApproval(): UseToolAutoApprovalReturn {
  const [autoApprovedServers, setAutoApprovedServers] = useState<Set<string>>(new Set());

  const approveServerForSession = useCallback((serverId: string) => {
    setAutoApprovedServers(prev => {
      const newSet = new Set(prev);
      newSet.add(serverId);
      return newSet;
    });
  }, []);

  const isServerAutoApproved = useCallback((serverId: string) => {
    return autoApprovedServers.has(serverId);
  }, [autoApprovedServers]);

  const clearAutoApprovals = useCallback(() => {
    setAutoApprovedServers(new Set());
  }, []);

  return {
    autoApprovedServers,
    approveServerForSession,
    isServerAutoApproved,
    clearAutoApprovals,
  };
}

/**
 * Extrae el serverId del nombre de la herramienta
 * Formato esperado: serverId_toolName → serverId
 */
export function extractServerIdFromToolName(toolName: string): string {
  return toolName.includes('_') ? toolName.split('_')[0] : 'unknown';
}
