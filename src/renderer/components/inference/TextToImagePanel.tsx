import { useState, useEffect } from 'react';
import { useInference } from '@/hooks/useInference';
import { useModelStore } from '@/stores/modelStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Download, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { Model } from '../../../types/models';

export function TextToImagePanel() {
  const [prompt, setPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [width, setWidth] = useState('1024');
  const [height, setHeight] = useState('1024');
  const [steps, setSteps] = useState('28');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { textToImage, loading, error, result, clearResult, clearError } = useInference();
  const providers = useModelStore((state) => state.providers);

  // Get text-to-image models from Hugging Face provider
  const textToImageModels: Model[] = (() => {
    const hfProvider = providers.find((p) => p.id === 'huggingface');
    if (!hfProvider) return [];

    return (hfProvider.models || []).filter(
      (model) => model.taskType === 'text-to-image' && model.isSelected
    );
  })();

  // Auto-select first model if none selected
  useEffect(() => {
    if (textToImageModels.length > 0 && !selectedModel) {
      setSelectedModel(textToImageModels[0].id);
    }
  }, [textToImageModels, selectedModel]);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      return;
    }

    if (!selectedModel) {
      return;
    }

    clearResult();
    clearError();

    const options: any = {};
    if (showAdvanced) {
      if (width) options.width = parseInt(width);
      if (height) options.height = parseInt(height);
      if (steps) options.num_inference_steps = parseInt(steps);
    }

    await textToImage(selectedModel, prompt, options);
  };

  const handleDownload = async () => {
    if (!result || result.kind !== 'image') return;

    const defaultFilename = `generated-${Date.now()}.png`;
    const response = await window.levante.inference.saveImage(result.dataUrl, defaultFilename);

    if (!response.success && response.error !== 'Save cancelled by user') {
      console.error('Failed to save image:', response.error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !loading) {
      e.preventDefault();
      handleGenerate();
    }
  };

  if (textToImageModels.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-500" />
              No Models Available
            </CardTitle>
            <CardDescription>
              You haven't added any text-to-image models yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              To use this feature, go to the Model page and add a text-to-image model (e.g., FLUX, Stable Diffusion).
            </p>
            <Button variant="outline" className="w-full" onClick={() => window.history.back()}>
              Go to Model Page
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-4 p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Text to Image</h2>
        <p className="text-muted-foreground">Generate images from text descriptions</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 flex-1 overflow-hidden">
        {/* Input Panel */}
        <Card className="flex-1 flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5" />
              Generate Image
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-4">
            {/* Model Selection */}
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger id="model">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {textToImageModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Prompt Input */}
            <div className="space-y-2 flex-1 flex flex-col">
              <Label htmlFor="prompt">Prompt</Label>
              <Textarea
                id="prompt"
                placeholder="A cyberpunk city at sunset, neon lights reflecting on wet streets..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Press Cmd/Ctrl + Enter to generate
              </p>
            </div>

            {/* Advanced Options */}
            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full">
                  {showAdvanced ? 'Hide' : 'Show'} Advanced Options
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="width">Width (px)</Label>
                    <Input
                      id="width"
                      type="number"
                      value={width}
                      onChange={(e) => setWidth(e.target.value)}
                      placeholder="1024"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="height">Height (px)</Label>
                    <Input
                      id="height"
                      type="number"
                      value={height}
                      onChange={(e) => setHeight(e.target.value)}
                      placeholder="1024"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="steps">Inference Steps</Label>
                  <Input
                    id="steps"
                    type="number"
                    value={steps}
                    onChange={(e) => setSteps(e.target.value)}
                    placeholder="28"
                  />
                  <p className="text-xs text-muted-foreground">
                    Higher values = better quality but slower generation
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Error Display */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Generate Button */}
            <Button
              onClick={handleGenerate}
              disabled={loading || !prompt.trim() || !selectedModel}
              className="w-full"
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                'Generate Image'
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Result Panel */}
        <Card className="flex-1 flex flex-col">
          <CardHeader>
            <CardTitle>Result</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col">
            {result && result.kind === 'image' ? (
              <div className="flex flex-col gap-4 flex-1">
                <div className="flex-1 relative rounded-lg overflow-hidden bg-muted flex items-center justify-center">
                  <img
                    src={result.dataUrl}
                    alt="Generated"
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
                <Button onClick={handleDownload} variant="outline" className="w-full">
                  <Download className="mr-2 h-4 w-4" />
                  Download Image
                </Button>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <ImageIcon className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p>Your generated image will appear here</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
