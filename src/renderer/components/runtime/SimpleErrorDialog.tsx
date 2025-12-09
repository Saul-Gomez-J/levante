import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, Copy } from 'lucide-react';

interface SimpleErrorDialogProps {
  open: boolean;
  onClose: () => void;
  serverName: string;
  error: {
    message: string;
    technicalDetails?: {
      errorCode?: string;
      url?: string;
      attempts?: number;
      logs?: string;
    };
  };
  onRetry?: () => void;
}

export const SimpleErrorDialog: React.FC<SimpleErrorDialogProps> = ({
  open,
  onClose,
  serverName,
  error,
  onRetry
}) => {
  const [showDetails, setShowDetails] = useState(false);

  const copyLogs = () => {
    if (error.technicalDetails?.logs) {
      navigator.clipboard.writeText(error.technicalDetails.logs);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Couldn't set up {serverName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {error.message || "Please check your internet connection and try again."}
          </p>

          {/* Botones de acción */}
          <div className="flex gap-2">
            {onRetry && (
              <Button onClick={onRetry}>Try Again</Button>
            )}
            <Button variant="outline" onClick={onClose}>Close</Button>
          </div>

          {/* Detalles técnicos expandibles */}
          {error.technicalDetails && (
            <div className="border-t pt-4">
              <button
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setShowDetails(!showDetails)}
              >
                {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                Show technical details
              </button>

              {showDetails && (
                <div className="mt-3 space-y-2 text-xs">
                  {error.technicalDetails.errorCode && (
                    <p><strong>Error:</strong> {error.technicalDetails.errorCode}</p>
                  )}
                  {error.technicalDetails.url && (
                    <p><strong>URL:</strong> {error.technicalDetails.url}</p>
                  )}
                  {error.technicalDetails.attempts && (
                    <p><strong>Attempts:</strong> {error.technicalDetails.attempts} of 3</p>
                  )}
                  {error.technicalDetails.logs && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between mb-1">
                        <strong>Logs:</strong>
                        <Button variant="ghost" size="sm" onClick={copyLogs}>
                          <Copy className="h-3 w-3 mr-1" />
                          Copy
                        </Button>
                      </div>
                      <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
                        {error.technicalDetails.logs}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
