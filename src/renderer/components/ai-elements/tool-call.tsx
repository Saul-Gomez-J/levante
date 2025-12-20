import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Wrench,
  CheckCircle2,
  XCircle,
  Clock,
  Copy
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { useThemeDetector } from '@/hooks/useThemeDetector';

// ═══════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════

export interface ToolCallData {
  id: string;
  name: string;
  arguments: Record<string, any>;
  result?: {
    success: boolean;
    content?: string;
    error?: string;
  };
  status: 'pending' | 'running' | 'success' | 'error';
  serverId?: string;
  timestamp?: number;
}

interface ToolCallProps {
  toolCall: ToolCallData;
  className?: string;
}

// ═══════════════════════════════════════════════════════
// CONFIGURACIÓN DE ESTADOS
// ═══════════════════════════════════════════════════════

const statusConfig = {
  pending: {
    icon: Clock,
    label: 'Pendiente',
    className: 'text-muted-foreground'
  },
  running: {
    icon: Clock,
    label: 'Ejecutando...',
    className: 'text-muted-foreground animate-pulse'
  },
  success: {
    icon: CheckCircle2,
    label: 'Completado',
    className: 'text-muted-foreground'
  },
  error: {
    icon: XCircle,
    label: 'Error',
    className: 'text-muted-foreground'
  }
};

// ═══════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════

/**
 * ToolCall - Componente de visualización de llamadas a herramientas
 *
 * Diseño: Título clickeable que abre un Drawer lateral con los detalles
 * Patrón: Similar a los tool results en Claude Desktop
 *
 * Estados:
 * - Running: Indicador "Ejecutando..." con pulse
 * - Success: Checkmark verde
 * - Error: X roja
 * - Click en título: Abre Drawer con argumentos, resultado y metadata
 *
 * @param toolCall - Datos de la tool call (ver ToolCallData)
 */
export function ToolCall({ toolCall, className }: ToolCallProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const statusInfo = statusConfig[toolCall.status];
  const StatusIcon = statusInfo.icon;

  return (
    <>
      {/* Título clickeable de la tool */}
      <button
        onClick={() => setIsDrawerOpen(true)}
        className={cn(
          'flex items-center gap-2 text-muted-foreground text-sm',
          'hover:text-foreground transition-colors',
          'w-full text-left group my-2 cursor-pointer',
          className
        )}
      >
        {/* Icono de herramienta */}
        <Wrench className="w-3.5 h-3.5 flex-shrink-0" />

        {/* Nombre de la tool */}
        <span className="font-medium">{toolCall.name}</span>

        {/* Indicador de estado */}
        <StatusIcon className={cn('w-3.5 h-3.5 ml-auto', statusInfo.className)} />
      </button>

      {/* Drawer lateral con detalles completos */}
      <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <SheetContent side="right" className="w-[30vw] min-w-[400px] max-w-[600px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 pr-8">
              <Wrench className="w-5 h-5" />
              {toolCall.name}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {/* Sección: Arguments */}
            <ArgumentsSection arguments={toolCall.arguments} />

            {/* Sección: Result */}
            {toolCall.result && (
              <ResultSection result={toolCall.result} />
            )}

            {/* Sección: Metadata */}
            <MetadataSection toolCall={toolCall} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

// ═══════════════════════════════════════════════════════
// SUB-COMPONENTES
// ═══════════════════════════════════════════════════════

function ArgumentsSection({ arguments: args }: { arguments: Record<string, any> }) {
  const argEntries = Object.entries(args);

  if (argEntries.length === 0) return null;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(JSON.stringify(args, null, 2));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Argumentos
        </h4>
        <Button
          variant="ghost"
          size="sm"
          onClick={copyToClipboard}
          className="h-6 px-2 text-muted-foreground hover:text-foreground"
        >
          <Copy className="w-3 h-3" />
        </Button>
      </div>

      <div className="space-y-2">
        {argEntries.map(([key, value]) => (
          <div key={key} className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">
              {key}
            </div>
            <div className="bg-background/50 rounded border border-border/50 p-2">
              <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap overflow-x-auto">
                {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
              </pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultSection({ result }: { result: NonNullable<ToolCallData['result']> }) {
  const theme = useThemeDetector();

  const content = result.success ? result.content : result.error;
  const isJSON = typeof content !== 'string';
  const contentString = isJSON ? JSON.stringify(content, null, 2) : (content || '');

  const copyToClipboard = () => {
    if (contentString) {
      navigator.clipboard.writeText(contentString);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          {result.success ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
              Resultado
            </>
          ) : (
            <>
              <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
              Error
            </>
          )}
        </h4>
        <Button
          variant="outline"
          size="sm"
          onClick={copyToClipboard}
          className="gap-2"
        >
          <Copy className="w-4 h-4" />
          Copiar
        </Button>
      </div>

      <div className="border rounded-md overflow-hidden">
        <CodeMirror
          value={contentString}
          height="400px"
          extensions={isJSON ? [json()] : []}
          theme={theme === 'dark' ? oneDark : 'light'}
          editable={false}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: false,
            highlightActiveLine: false,
            foldGutter: true,
            bracketMatching: true,
            autocompletion: false,
          }}
        />
      </div>
    </div>
  );
}

function MetadataSection({ toolCall }: { toolCall: ToolCallData }) {
  const statusInfo = statusConfig[toolCall.status];
  const StatusIcon = statusInfo.icon;

  return (
    <div className="pt-2 border-t border-border/50">
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <StatusIcon className={cn('w-3 h-3', statusInfo.className)} />
          <span>Estado: {statusInfo.label}</span>
        </div>

        {toolCall.serverId && (
          <div>
            <span className="font-medium">Servidor:</span> {toolCall.serverId}
          </div>
        )}

        {toolCall.timestamp && (
          <div>
            <span className="font-medium">Ejecutado:</span>{' '}
            {new Date(toolCall.timestamp).toLocaleTimeString()}
          </div>
        )}

        <div>
          <span className="font-medium">ID:</span>{' '}
          <span className="font-mono text-[10px]">{toolCall.id.slice(0, 8)}</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// COMPONENTE PARA MÚLTIPLES TOOL CALLS
// ═══════════════════════════════════════════════════════

interface ToolCallsProps {
  toolCalls: ToolCallData[];
  className?: string;
}

export function ToolCalls({ toolCalls, className }: ToolCallsProps) {
  if (toolCalls.length === 0) return null;

  return (
    <div className={cn('space-y-1', className)}>
      {toolCalls.map((toolCall) => (
        <ToolCall key={toolCall.id} toolCall={toolCall} />
      ))}
    </div>
  );
}
