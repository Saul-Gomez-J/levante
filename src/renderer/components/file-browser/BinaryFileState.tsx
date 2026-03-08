/**
 * BinaryFileState
 *
 * Placeholder for binary files.
 */

import { FileX } from 'lucide-react';

interface BinaryFileStateProps {
  fileName: string;
}

export function BinaryFileState({ fileName }: BinaryFileStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
      <FileX size={32} className="opacity-30" />
      <div className="text-center">
        <p className="text-sm font-medium">Binary file</p>
        <p className="text-xs mt-1 opacity-70">{fileName} cannot be previewed</p>
      </div>
    </div>
  );
}
