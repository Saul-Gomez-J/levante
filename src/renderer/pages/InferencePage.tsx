import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TextToImagePanel } from '@/components/inference/TextToImagePanel';
import { ImageToTextPanel } from '@/components/inference/ImageToTextPanel';
import { ASRPanel } from '@/components/inference/ASRPanel';
import { Image, FileText, Mic } from 'lucide-react';

type InferenceTask = 'text-to-image' | 'image-to-text' | 'asr';

export default function InferencePage() {
  const [activeTask, setActiveTask] = useState<InferenceTask>('text-to-image');

  return (
    <div className="flex flex-col h-full">
      <Tabs value={activeTask} onValueChange={(value) => setActiveTask(value as InferenceTask)} className="flex-1 flex flex-col">
        {/* Task Selector */}
        <div className="px-6 pt-4 pb-2 border-b">
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="text-to-image" className="flex items-center gap-2">
              <Image className="h-4 w-4" />
              <span className="hidden sm:inline">Text to Image</span>
              <span className="sm:hidden">Image</span>
            </TabsTrigger>
            <TabsTrigger value="image-to-text" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Image to Text</span>
              <span className="sm:hidden">Caption</span>
            </TabsTrigger>
            <TabsTrigger value="asr" className="flex items-center gap-2">
              <Mic className="h-4 w-4" />
              <span className="hidden sm:inline">Speech to Text</span>
              <span className="sm:hidden">Speech</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Task Panels */}
        <TabsContent value="text-to-image" className="flex-1 m-0">
          <TextToImagePanel />
        </TabsContent>

        <TabsContent value="image-to-text" className="flex-1 m-0">
          <ImageToTextPanel />
        </TabsContent>

        <TabsContent value="asr" className="flex-1 m-0">
          <ASRPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
