/**
 * PromptInputModal Component
 *
 * Modal for entering prompt arguments before adding an MCP prompt to context.
 * Shows prompt name, description, and input fields for each argument.
 */

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from 'react-i18next';
import type { MCPPrompt, MCPPromptArgument } from '@/hooks/useMCPResources';

interface PromptInputModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: MCPPrompt | null;
  serverName: string;
  onSubmit: (args: Record<string, string>) => void;
}

export function PromptInputModal({
  open,
  onOpenChange,
  prompt,
  serverName,
  onSubmit,
}: PromptInputModalProps) {
  const { t } = useTranslation('chat');
  const [values, setValues] = useState<Record<string, string>>({});

  if (!prompt) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(values);
    setValues({});
    onOpenChange(false);
  };

  const handleCancel = () => {
    setValues({});
    onOpenChange(false);
  };

  const handleValueChange = (argName: string, value: string) => {
    setValues(prev => ({ ...prev, [argName]: value }));
  };

  // Check if all required arguments are filled
  const requiredArgs = prompt.arguments?.filter(arg => arg.required) || [];
  const isValid = requiredArgs.every(arg => values[arg.name]?.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t('prompt_modal.title', 'Enter prompt inputs')}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1">
              <span className="font-medium">{prompt.name}</span>
              {prompt.description && (
                <p className="text-sm text-muted-foreground">{prompt.description}</p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            {prompt.arguments?.map((arg: MCPPromptArgument) => (
              <div key={arg.name} className="grid gap-2">
                <Label htmlFor={arg.name}>
                  {arg.name}
                  {arg.required && <span className="text-destructive ml-1">*</span>}
                </Label>
                <Input
                  id={arg.name}
                  value={values[arg.name] || ''}
                  onChange={(e) => handleValueChange(arg.name, e.target.value)}
                  placeholder={arg.description || arg.name}
                />
                {arg.description && (
                  <p className="text-xs text-muted-foreground">{arg.description}</p>
                )}
              </div>
            ))}

            {(!prompt.arguments || prompt.arguments.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-2">
                {t('prompt_modal.no_arguments', 'This prompt has no arguments')}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCancel}>
              {t('prompt_modal.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={!isValid && requiredArgs.length > 0}>
              {t('prompt_modal.add', 'Add prompt')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
