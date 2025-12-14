import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { X, ZoomIn, ZoomOut, RotateCcw, Download } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface ImageViewerProps {
  src: string;
  alt?: string;
  className?: string;
  children?: React.ReactNode;
}

export function ImageViewer({ src, alt, className, children }: ImageViewerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement>(null);
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(null);

  // Reset state when closed
  useEffect(() => {
    if (!isOpen) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [isOpen]);

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.5, 4));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.5, 1));
    if (scale <= 1.5) {
      setPosition({ x: 0, y: 0 });
    }
  };

  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = src;
    link.download = alt || 'image';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Handle wheel event with non-passive listener to prevent default behavior
  useEffect(() => {
    if (!containerNode) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY * -0.01;

      setScale((prevScale) => {
        const newScale = Math.min(Math.max(1, prevScale + delta), 4);
        if (newScale === 1) {
          setPosition({ x: 0, y: 0 });
        }
        return newScale;
      });
    };

    containerNode.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      containerNode.removeEventListener('wheel', onWheel);
    };
  }, [containerNode]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      e.preventDefault();
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <div className={cn("cursor-zoom-in relative group", className)}>
          {children}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
            <ZoomIn className="w-6 h-6 text-white drop-shadow-md" />
          </div>
        </div>
      </DialogTrigger>
      <DialogContent
        className="max-w-[95vw] max-h-[95vh] w-full h-full p-0 border-none bg-transparent shadow-none overflow-hidden flex flex-col items-center justify-center focus:outline-none [&>button]:hidden"
        onKeyDown={(e) => {
          // Prevent closing on escape if dragging? No, escape should always close.
        }}
      >
        <DialogTitle className="sr-only">Image Viewer</DialogTitle>
        <DialogDescription className="sr-only">
          Zoom and pan controls for viewing the image in full size
        </DialogDescription>

        {/* Controls */}
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 flex items-center gap-2 bg-black/50 backdrop-blur-sm p-2 rounded-full">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomOut}
            disabled={scale <= 1}
            className="text-white hover:bg-white/20 rounded-full h-8 w-8"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-white text-xs font-medium w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomIn}
            disabled={scale >= 4}
            className="text-white hover:bg-white/20 rounded-full h-8 w-8"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleReset}
            disabled={scale === 1}
            className="text-white hover:bg-white/20 rounded-full h-8 w-8"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <div className="w-px h-4 bg-white/30" />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDownload}
            className="text-white hover:bg-white/20 rounded-full h-8 w-8"
            title="Download image"
          >
            <Download className="h-4 w-4" />
          </Button>
          <div className="w-px h-4 bg-white/30" />
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20 rounded-full h-8 w-8"
              title="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogClose>
        </div>

        {/* Image Container */}
        <div
          ref={setContainerNode}
          className="relative w-full h-full flex items-center justify-center overflow-hidden"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
        >
          <img
            ref={imageRef}
            src={src}
            alt={alt || 'Image viewer'}
            className="max-w-full max-h-full object-contain transition-transform duration-100 ease-out"
            style={{
              transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
            }}
            draggable={false}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
