import { useState, useEffect, useRef } from 'react';
import { useInference } from '@/hooks/useInference';
import { useModelStore } from '@/stores/modelStore';
import { Button } from '@/components/ui/button';
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
import { Loader2, Upload, Mic, AlertCircle, Copy, Check } from 'lucide-react';
import type { Model } from '../../../types/models';

export function ASRPanel() {
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { automaticSpeechRecognition, loading, error, result, clearResult, clearError } = useInference();
  const providers = useModelStore((state) => state.providers);

  // Get ASR models from Hugging Face provider
  const asrModels: Model[] = (() => {
    const hfProvider = providers.find((p) => p.id === 'huggingface');
    if (!hfProvider) return [];

    return (hfProvider.models || []).filter(
      (model) => model.taskType === 'automatic-speech-recognition' && model.isSelected
    );
  })();

  // Auto-select first model if none selected
  useEffect(() => {
    if (asrModels.length > 0 && !selectedModel) {
      setSelectedModel(asrModels[0].id);
    }
  }, [asrModels, selectedModel]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      const validTypes = ['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/m4a'];
      if (!validTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|ogg|flac|m4a)$/i)) {
        alert('Please select a valid audio file (MP3, WAV, OGG, FLAC, M4A)');
        return;
      }

      setSelectedFile(file);
      clearResult();
      clearError();
    }
  };

  const handleTranscribe = async () => {
    if (!selectedFile || !selectedModel) return;

    const options = language ? { language } : undefined;
    await automaticSpeechRecognition(selectedModel, selectedFile, options);
  };

  const handleClear = () => {
    setSelectedFile(null);
    clearResult();
    clearError();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleCopy = () => {
    if (result && result.kind === 'text') {
      navigator.clipboard.writeText(result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDuration = (file: File): string => {
    // Would need to load audio to get duration, simplified for now
    return 'Unknown';
  };

  if (asrModels.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-500" />
              No Models Available
            </CardTitle>
            <CardDescription>
              You haven't added any speech recognition models yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              To use this feature, go to the Model page and add an ASR model (e.g., Whisper).
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
        <h2 className="text-2xl font-bold">Automatic Speech Recognition</h2>
        <p className="text-muted-foreground">Transcribe audio to text</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 flex-1 overflow-hidden">
        {/* Input Panel */}
        <Card className="flex-1 flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload Audio
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
                  {asrModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Language Selection (Optional) */}
            <div className="space-y-2">
              <Label htmlFor="language">Language (Optional)</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger id="language">
                  <SelectValue placeholder="Auto-detect" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Auto-detect</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="es">Spanish</SelectItem>
                  <SelectItem value="fr">French</SelectItem>
                  <SelectItem value="de">German</SelectItem>
                  <SelectItem value="it">Italian</SelectItem>
                  <SelectItem value="pt">Portuguese</SelectItem>
                  <SelectItem value="zh">Chinese</SelectItem>
                  <SelectItem value="ja">Japanese</SelectItem>
                  <SelectItem value="ko">Korean</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* File Upload */}
            <div className="space-y-2 flex-1 flex flex-col">
              <Label htmlFor="audio">Audio File</Label>
              <input
                ref={fileInputRef}
                id="audio"
                type="file"
                accept="audio/*"
                onChange={handleFileSelect}
                className="hidden"
              />

              {selectedFile ? (
                <div className="flex-1 border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-4 bg-muted/30">
                  <div className="p-4 rounded-full bg-primary/10">
                    <Mic className="h-8 w-8 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium">{selectedFile.name}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {formatFileSize(selectedFile.size)}
                    </p>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 hover:bg-muted/50 transition-colors"
                >
                  <Upload className="h-12 w-12 text-muted-foreground opacity-50" />
                  <p className="text-sm text-muted-foreground">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-xs text-muted-foreground">
                    MP3, WAV, OGG, FLAC, M4A
                  </p>
                </button>
              )}
            </div>

            {/* Error Display */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2">
              {selectedFile && (
                <Button
                  onClick={handleClear}
                  variant="outline"
                  className="flex-1"
                  disabled={loading}
                >
                  Clear
                </Button>
              )}
              <Button
                onClick={handleTranscribe}
                disabled={loading || !selectedFile || !selectedModel}
                className="flex-1"
                size="lg"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Transcribing...
                  </>
                ) : (
                  'Transcribe'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Result Panel */}
        <Card className="flex-1 flex flex-col">
          <CardHeader>
            <CardTitle>Transcription</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col">
            {result && result.kind === 'text' ? (
              <div className="flex flex-col gap-4 flex-1">
                <div className="flex-1 p-4 rounded-lg bg-muted overflow-auto">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{result.text}</p>
                </div>
                <Button onClick={handleCopy} variant="outline" className="w-full">
                  {copied ? (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-4 w-4" />
                      Copy to Clipboard
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Mic className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p>Your transcription will appear here</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
