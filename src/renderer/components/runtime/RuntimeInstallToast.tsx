import { toast } from 'sonner';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';

export const RuntimeInstallToast = {
  installing: (serverName: string) => {
    return toast.loading(
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <div>
          <p className="font-medium">Setting up {serverName}...</p>
          <p className="text-xs text-muted-foreground">This may take a minute</p>
        </div>
      </div>,
      { duration: Infinity }
    );
  },

  success: (serverName: string, toastId: string | number) => {
    toast.success(
      <div className="flex items-center gap-2">
        <CheckCircle className="h-4 w-4" />
        <p className="font-medium">{serverName} is ready!</p>
      </div>,
      { id: toastId, duration: 3000 }
    );
  },

  error: (serverName: string, toastId: string | number, onShowDetails?: () => void) => {
    toast.error(
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          <p className="font-medium">Couldn't set up {serverName}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Please check your internet connection and try again
        </p>
        {onShowDetails && (
          <button
            className="text-xs text-primary hover:underline"
            onClick={onShowDetails}
          >
            Show technical details →
          </button>
        )}
      </div>,
      { id: toastId, duration: 8000 }
    );
  }
};
