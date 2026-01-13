import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Check, X, Shield } from 'lucide-react';

interface ToolApprovalDialogProps {
  isOpen: boolean;
  toolName: string;
  serverId: string;
  input: Record<string, unknown>;
  onApprove: () => void;
  onApproveForSession: () => void;
  onDeny: (feedback?: string) => void;
  onClose: () => void;
}

export function ToolApprovalDialog({
  isOpen,
  toolName,
  serverId,
  input,
  onApprove,
  onApproveForSession,
  onDeny,
  onClose,
}: ToolApprovalDialogProps) {
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const handleDenyWithFeedback = () => {
    onDeny(feedback || undefined);
    setFeedback('');
    setShowFeedback(false);
  };

  const displayToolName = toolName.replace(`${serverId}_`, '');

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Tool Approval Required
          </DialogTitle>
          <DialogDescription>
            The AI wants to execute a tool from MCP server <strong>{serverId}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Tool Info */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Tool</div>
            <code className="block rounded bg-muted px-3 py-2 text-sm">
              {displayToolName}
            </code>
          </div>

          {/* Input Preview */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Input Parameters</div>
            <pre className="max-h-[200px] overflow-auto rounded bg-muted px-3 py-2 text-xs">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>

          {/* Feedback Input (cuando se muestra) */}
          {showFeedback && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Feedback (optional)</div>
              <Textarea
                placeholder="Explain why you're denying this tool execution..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
              />
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {!showFeedback ? (
            <>
              {/* Approve Once */}
              <Button
                onClick={onApprove}
                className="w-full"
                variant="default"
              >
                <Check className="mr-2 h-4 w-4" />
                Approve
              </Button>

              {/* Approve for Session */}
              <Button
                onClick={onApproveForSession}
                className="w-full"
                variant="secondary"
              >
                <Shield className="mr-2 h-4 w-4" />
                Approve for this session
              </Button>

              {/* Deny */}
              <Button
                onClick={() => setShowFeedback(true)}
                className="w-full"
                variant="outline"
              >
                <X className="mr-2 h-4 w-4" />
                Deny and provide feedback
              </Button>
            </>
          ) : (
            <>
              {/* Confirm Deny */}
              <Button
                onClick={handleDenyWithFeedback}
                className="w-full"
                variant="destructive"
              >
                <X className="mr-2 h-4 w-4" />
                Deny execution
              </Button>

              {/* Back */}
              <Button
                onClick={() => setShowFeedback(false)}
                className="w-full"
                variant="outline"
              >
                Back
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
