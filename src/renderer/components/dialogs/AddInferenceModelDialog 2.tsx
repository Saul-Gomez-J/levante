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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Search, Loader2, Info } from 'lucide-react';
import { useModelStore } from '@/stores/modelStore';
import { ModelBrowserDialog } from './ModelBrowserDialog';
import { hubService } from '@/services/huggingfaceHubService';
import type { InferenceTask } from '../../../types/inference';

interface AddInferenceModelDialogProps {
  providerId: string;
  open: boolean;
  onClose: () => void;
}

type TaskType = 'text-to-image' | 'image-to-text' | 'automatic-speech-recognition';

export const AddInferenceModelDialog = ({ providerId, open, onClose }: AddInferenceModelDialogProps) => {
  const [modelId, setModelId] = useState('');
  const [taskType, setTaskType] = useState<TaskType | ''>('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetchingInfo, setIsFetchingInfo] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [autoDetectedTask, setAutoDetectedTask] = useState<string | null>(null);

  const { addUserModel } = useModelStore();

  const validateModelId = (id: string): boolean => {
    // Validate HF format: owner/model-name
    const hfPattern = /^[\w-]+\/[\w.-]+$/;
    return hfPattern.test(id);
  };

  const fetchModelInfo = async (modelIdToFetch: string) => {
    if (!validateModelId(modelIdToFetch)) {
      return;
    }

    setIsFetchingInfo(true);
    setError(null);
    setAutoDetectedTask(null);

    try {
      const info = await hubService.getModelInfo(modelIdToFetch);

      // Auto-detect task type from pipeline_tag
      if (info.pipeline_tag) {
        const detectedTask = mapPipelineTagToTaskType(info.pipeline_tag);
        if (detectedTask) {
          setTaskType(detectedTask);
          setAutoDetectedTask(info.pipeline_tag);
        }
      }

      // Auto-fill display name if empty
      if (!displayName) {
        const name = modelIdToFetch.split('/').pop() || modelIdToFetch;
        setDisplayName(name);
      }
    } catch (err) {
      // Silently fail - user can still manually set task type
      console.warn('Failed to fetch model info:', err);
    } finally {
      setIsFetchingInfo(false);
    }
  };

  const mapPipelineTagToTaskType = (pipelineTag: string): TaskType | null => {
    switch (pipelineTag) {
      case 'text-to-image':
        return 'text-to-image';
      case 'image-to-text':
        return 'image-to-text';
      case 'automatic-speech-recognition':
        return 'automatic-speech-recognition';
      default:
        return null;
    }
  };

  const handleModelIdChange = (value: string) => {
    setModelId(value);
    setAutoDetectedTask(null);

    // Auto-fetch info when user finishes typing (with debounce)
    if (validateModelId(value)) {
      const timeoutId = setTimeout(() => {
        fetchModelInfo(value);
      }, 800);
      return () => clearTimeout(timeoutId);
    }
  };

  const handleBrowserSelect = (selectedModelId: string, selectedModelName: string, selectedTaskType: InferenceTask) => {
    setModelId(selectedModelId);
    setTaskType(selectedTaskType as TaskType);
    setDisplayName(selectedModelName);
    setAutoDetectedTask(selectedTaskType);
  };

  const handleSubmit = async () => {
    setError(null);

    // Validation
    if (!modelId.trim()) {
      setError('Model ID is required');
      return;
    }

    if (!validateModelId(modelId)) {
      setError('Model ID must be in format: owner/model-name (e.g., black-forest-labs/FLUX.1-dev)');
      return;
    }

    if (!taskType) {
      setError('Task type is required');
      return;
    }

    setIsSubmitting(true);

    try {
      // Create model object
      const newModel = {
        id: modelId,
        name: displayName.trim() || modelId,
        taskType,
        contextLength: 0,
        capabilities: [],
        userDefined: true,
      };

      await addUserModel(providerId, newModel);

      // Reset form and close
      setModelId('');
      setTaskType('');
      setDisplayName('');
      setError(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add model');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setModelId('');
      setTaskType('');
      setDisplayName('');
      setError(null);
      setAutoDetectedTask(null);
      onClose();
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Inference Model</DialogTitle>
            <DialogDescription>
              Add a Hugging Face Inference model for specialized tasks like image generation, image captioning, or speech recognition.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Browse Models Button */}
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => setBrowserOpen(true)}
                className="w-full"
                disabled={isSubmitting}
              >
                <Search className="mr-2 h-4 w-4" />
                Browse Popular Models
              </Button>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  Or enter manually
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="model-id">
                Model ID <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="model-id"
                  placeholder="e.g., black-forest-labs/FLUX.1-dev"
                  value={modelId}
                  onChange={(e) => handleModelIdChange(e.target.value)}
                  disabled={isSubmitting}
                />
                {isFetchingInfo && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Format: owner/model-name (from Hugging Face Hub)
              </p>
              {autoDetectedTask && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Task type auto-detected: <strong>{autoDetectedTask}</strong>
                  </AlertDescription>
                </Alert>
              )}
            </div>

          <div className="space-y-2">
            <Label htmlFor="task-type">
              Task Type <span className="text-red-500">*</span>
            </Label>
            <Select
              value={taskType}
              onValueChange={(value) => setTaskType(value as TaskType)}
              disabled={isSubmitting}
            >
              <SelectTrigger id="task-type">
                <SelectValue placeholder="Select task type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text-to-image">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Text-to-Image</span>
                    <span className="text-xs text-muted-foreground">Generate images from text prompts</span>
                  </div>
                </SelectItem>
                <SelectItem value="image-to-text">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Image-to-Text</span>
                    <span className="text-xs text-muted-foreground">Generate captions or descriptions from images</span>
                  </div>
                </SelectItem>
                <SelectItem value="automatic-speech-recognition">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Automatic Speech Recognition</span>
                    <span className="text-xs text-muted-foreground">Transcribe audio to text</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="display-name">Display Name (optional)</Label>
            <Input
              id="display-name"
              placeholder="e.g., FLUX Dev"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Friendly name for the model (defaults to model ID if not provided)
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Adding...' : 'Add Model'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
