/**
 * ToolApprovalInline - UI para aprobar/denegar ejecución de herramientas
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Wrench,
  X,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { CodeBlock } from './code-block';

// ═══════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════

interface ToolApprovalInlineProps {
  /** Nombre de la herramienta (formato: serverId_toolName) */
  toolName: string;
  /** Argumentos que se van a pasar a la herramienta */
  input: Record<string, unknown>;
  /** ID de aprobación del AI SDK */
  approvalId: string;
  /** Callback cuando el usuario aprueba */
  onApprove: () => void;
  /** Callback cuando el usuario deniega */
  onDeny: () => void;
  /** Callback cuando el usuario aprueba para toda la sesión */
  onApproveForSession?: (serverId: string) => void;
  /** Clases CSS adicionales */
  className?: string;
}

// ═══════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════

export function ToolApprovalInline({
  toolName,
  input,
  approvalId,
  onApprove,
  onDeny,
  onApproveForSession,
  className,
}: ToolApprovalInlineProps) {
  const { t } = useTranslation('chat');
  const [showDetails, setShowDetails] = useState(false);

  // Extraer nombre de herramienta sin prefijo del servidor
  // Formato: serverId_toolName → toolName
  const displayToolName = toolName.includes('_')
    ? toolName.split('_').slice(1).join('_')
    : toolName;

  // Extraer serverId
  const serverId = toolName.includes('_')
    ? toolName.split('_')[0]
    : 'unknown';

  // Handler para aprobar para toda la sesión
  const handleApproveForSession = () => {
    // Primero aprobar esta herramienta
    onApprove();
    // Luego registrar el servidor para auto-aprobación
    onApproveForSession?.(serverId);
  };

  return (
    <div
      className={cn(
        'space-y-3',
        className
      )}
    >
      {/* Tool Info */}
      <div className="flex items-center gap-2 text-sm">
        <Wrench className="w-4 h-4 text-muted-foreground" />
        <span className="font-mono font-medium">{displayToolName}</span>
        <Badge variant="outline" className="text-xs">
          {serverId}
        </Badge>
      </div>

      {/* Toggle Parameters */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {showDetails ? (
          <>
            <ChevronUp className="w-3 h-3" />
            {t('tool_approval.hide_parameters')}
          </>
        ) : (
          <>
            <ChevronDown className="w-3 h-3" />
            {t('tool_approval.show_parameters')}
          </>
        )}
      </button>

      {/* Parameters */}
      {showDetails && (
        <div className="rounded-md border overflow-hidden">
          <CodeBlock
            code={JSON.stringify(input, null, 2)}
            language="json"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onDeny}
          className="gap-1"
        >
          <X className="w-3 h-3" />
          {t('tool_approval.deny')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onApprove}
          className="gap-1"
        >
          <Check className="w-3 h-3" />
          {t('tool_approval.approve')}
        </Button>
        {/* Botón para aprobar todas las herramientas del servidor para esta sesión */}
        {onApproveForSession && (
          <Button
            size="sm"
            onClick={handleApproveForSession}
            className="gap-1"
          >
            <Check className="w-3 h-3" />
            {t('tool_approval.approve_for_session')}
          </Button>
        )}
      </div>
    </div>
  );
}
