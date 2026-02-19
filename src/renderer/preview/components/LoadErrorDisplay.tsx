import React from 'react';
import { AlertCircle } from 'lucide-react';
import type { WebAppLoadError } from '../../../types/preview';

interface LoadErrorDisplayProps {
  error: WebAppLoadError;
}

export function LoadErrorDisplay({ error }: LoadErrorDisplayProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/95">
      <div className="max-w-md p-6 text-center">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-destructive" />
        <h2 className="text-lg font-semibold mb-2">Failed to load page</h2>
        <p className="text-sm text-muted-foreground mb-4">{error.url}</p>
        <div className="p-3 bg-muted rounded text-sm text-left">
          <p className="font-medium">Error {error.errorCode}</p>
          <p className="text-muted-foreground">{error.errorDescription}</p>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Make sure the URL is in your allowlist and the server is running.
        </p>
      </div>
    </div>
  );
}
