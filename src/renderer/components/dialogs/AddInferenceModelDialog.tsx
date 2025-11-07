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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useModelStore } from '@/stores/modelStore';

interface AddInferenceModelDialogProps {
  providerId: string;
  open: boolean;
  onClose: () => void;
}

type TaskType =
  | 'text-generation'
  | 'text2text-generation'
  | 'conversational'
  | 'text-to-image'
  | 'image-text-to-text'
  | 'image-to-image'
  | 'text-to-video'
  | 'text-to-speech'
  | 'visual-question-answering'
  | 'document-question-answering'
  | 'table-question-answering';

interface HuggingFaceModelInfo {
  id: string;
  pipeline_tag?: string;
  modelId?: string;
  author?: string;
}

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  'text-generation': 'Text Generation (Chat preferred)',
  'text2text-generation': 'Text2Text Generation',
  'conversational': 'Conversational Chat',
  'text-to-image': 'Text-to-Image',
  'image-text-to-text': 'Image-Text-to-Text (Multimodal)',
  'image-to-image': 'Image-to-Image',
  'text-to-video': 'Text-to-Video',
  'text-to-speech': 'Text-to-Speech',
  'visual-question-answering': 'Visual Question Answering',
  'document-question-answering': 'Document Question Answering',
  'table-question-answering': 'Table Question Answering',
};

export const AddInferenceModelDialog = ({ providerId, open, onClose }: AddInferenceModelDialogProps) => {
  const [modelId, setModelId] = useState('');
  const [inferenceProvider, setInferenceProvider] = useState('');
  const [detectedTaskType, setDetectedTaskType] = useState<TaskType | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  const { addUserModel } = useModelStore();

  const validateModelId = (id: string): boolean => {
    // Validate HF format: owner/model-name
    const hfPattern = /^[\w-]+\/[\w.-]+$/;
    return hfPattern.test(id);
  };

  /**
   * Fetch model info from Hugging Face API to detect task type
   * Uses IPC to avoid CSP restrictions
   */
  const detectModelTaskType = async (modelIdToCheck: string): Promise<TaskType | null> => {
    try {
      const response = await window.levante.models.validateHuggingFaceModel(modelIdToCheck);

      if (!response.success) {
        throw new Error(response.error || 'Failed to validate model');
      }

      const data: HuggingFaceModelInfo = response.data;

      // Check if pipeline_tag is one of our supported types
      const pipelineTag = data.pipeline_tag;
      const supportedTasks: TaskType[] = [
        'conversational',
        'text-generation',
        'text2text-generation',
        'text-to-image',
        'image-text-to-text',
        'image-to-image',
        'text-to-video',
        'text-to-speech',
        'visual-question-answering',
        'document-question-answering',
        'table-question-answering'
      ];

      if (pipelineTag && supportedTasks.includes(pipelineTag as TaskType)) {
        return pipelineTag as TaskType;
      }

      throw new Error(
        `Model task type "${pipelineTag || 'unknown'}" is not supported. ` +
        'Supported types: conversational, text-generation, text2text-generation, text-to-image, image-text-to-text, image-to-image, text-to-video, text-to-speech, visual/document/table QA'
      );
    } catch (err) {
      if (err instanceof Error) {
        throw err;
      }
      throw new Error('Failed to validate model');
    }
  };

  const handleSubmit = async () => {
    setError(null);
    setDetectedTaskType(null);

    // Validation
    if (!modelId.trim()) {
      setError('Model ID is required');
      return;
    }

    if (!validateModelId(modelId)) {
      setError('Model ID must be in format: owner/model-name (e.g., black-forest-labs/FLUX.1-dev)');
      return;
    }

    if (!inferenceProvider.trim()) {
      setError('Inference Provider is required');
      return;
    }

    setIsValidating(true);
    setIsSubmitting(true);

    try {
      // Detect task type from HF API
      const taskType = await detectModelTaskType(modelId);

      if (!taskType) {
        throw new Error('Could not determine model task type');
      }

      setDetectedTaskType(taskType);
      setIsValidating(false);

      // Create model object
      const newModel = {
        id: modelId,
        name: displayName.trim() || modelId,
        provider: 'huggingface',
        taskType,
        inferenceProvider: inferenceProvider.trim(),
        contextLength: 0,
        capabilities: [],
        userDefined: true,
      };

      await addUserModel(providerId, newModel);

      // Reset form and close
      setModelId('');
      setInferenceProvider('');
      setDetectedTaskType(null);
      setDisplayName('');
      setError(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add model');
      setDetectedTaskType(null);
    } finally {
      setIsValidating(false);
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setModelId('');
      setInferenceProvider('');
      setDetectedTaskType(null);
      setDisplayName('');
      setError(null);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Inference Model</DialogTitle>
          <DialogDescription>
            Enter a Hugging Face model ID. We'll automatically detect if it's compatible with text-generation, text-to-image, image-to-text, or speech recognition.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {detectedTaskType && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Detected task type: <strong>{TASK_TYPE_LABELS[detectedTaskType]}</strong>
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="model-id">
              Model ID <span className="text-red-500">*</span>
            </Label>
            <Input
              id="model-id"
              placeholder="e.g., black-forest-labs/FLUX.1-dev"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Format: owner/model-name (from Hugging Face Hub)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="inference-provider">
              Inference Provider <span className="text-red-500">*</span>
            </Label>
            <Input
              id="inference-provider"
              placeholder="e.g., featherless-ai, novita, fireworks-ai"
              value={inferenceProvider}
              onChange={(e) => setInferenceProvider(e.target.value)}
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Provider slug for Hugging Face Inference API
            </p>
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
            disabled={isSubmitting || !modelId.trim() || !inferenceProvider.trim()}
          >
            {isValidating ? 'Validating...' : isSubmitting ? 'Adding...' : 'Add Model'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
