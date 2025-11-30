import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Download, Cpu, AlertTriangle } from 'lucide-react';

export type RuntimeErrorType = 'RUNTIME_CHOICE_REQUIRED' | 'RUNTIME_NOT_FOUND';

interface RuntimeChoiceDialogProps {
  open: boolean;
  onClose: () => void;
  errorType: RuntimeErrorType;
  serverName: string;
  metadata: {
    systemPath?: string;
    runtimeType?: 'node' | 'python';
    runtimeVersion?: string;
  };
  onUseSystem?: () => void;
  onInstallLevante?: () => void;
}

export const RuntimeChoiceDialog: React.FC<RuntimeChoiceDialogProps> = ({
  open,
  onClose,
  errorType,
  serverName,
  metadata,
  onUseSystem,
  onInstallLevante
}) => {
  const runtimeName = metadata.runtimeType === 'node' ? 'Node.js' : 'Python';
  const version = metadata.runtimeVersion || 'latest';

  if (errorType === 'RUNTIME_CHOICE_REQUIRED') {
    return (
      <AlertDialog open={open} onOpenChange={onClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5" />
              Choose Runtime Source
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  <strong>{serverName}</strong> requires <strong>{runtimeName} {version}</strong>.
                </p>
                <p>
                  We detected {runtimeName} installed on your system at:
                </p>
                <code className="block bg-muted px-3 py-2 rounded text-xs break-all">
                  {metadata.systemPath}
                </code>
                <p className="text-sm">
                  Would you like to use your system runtime or download a managed Levante runtime?
                </p>
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded p-3 text-xs">
                  <strong>Recommendation:</strong> Levante runtimes are isolated and tracked automatically.
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                onUseSystem?.();
                onClose();
              }}
            >
              <Cpu className="h-4 w-4 mr-2" />
              Use System
            </Button>
            <AlertDialogAction
              onClick={() => {
                onInstallLevante?.();
                onClose();
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              Download {runtimeName}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  // RUNTIME_NOT_FOUND
  return (
    <AlertDialog open={open} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            Runtime Not Found
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                <strong>{serverName}</strong> requires <strong>{runtimeName} {version}</strong>, but it's not installed.
              </p>
              <p className="text-sm">
                Would you like to download and install it now? This may take a few minutes.
              </p>
              <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded p-3 text-xs">
                <strong>Note:</strong> The runtime will be downloaded to <code>~/levante/runtimes/</code> and managed automatically.
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onInstallLevante?.();
              onClose();
            }}
          >
            <Download className="h-4 w-4 mr-2" />
            Download {runtimeName}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
