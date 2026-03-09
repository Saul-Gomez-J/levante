import { FileCode } from 'lucide-react';
import { useSidePanelStore } from '@/stores/sidePanelStore';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface FileMentionChipProps {
  fileName: string;
  relativePath: string;
  filePath: string;
}

export function FileMentionChip({ fileName, relativePath, filePath }: FileMentionChipProps) {
  const openFileTab = useSidePanelStore((s) => s.openFileTab);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void openFileTab(filePath);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            contentEditable={false}
            onClick={handleClick}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 rounded-md bg-primary/10 text-primary text-xs font-medium cursor-pointer hover:bg-primary/20 transition-colors align-baseline select-none"
          >
            <FileCode className="h-3 w-3 shrink-0" />
            <span className="truncate max-w-[150px]">{fileName}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {relativePath}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
