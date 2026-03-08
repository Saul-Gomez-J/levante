/**
 * PdfViewer
 *
 * Renders a PDF document using pdfjs-dist.
 * Loads via levante-fs://pdf protocol (streamed from main process).
 * State (loading/error/scale) is local; only page/totalPages sync to store.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSidePanelStore, type PdfTab } from '@/stores/sidePanelStore';

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfViewerProps {
  tab: PdfTab;
}

export function PdfViewer({ tab }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const loadingTaskRef = useRef<ReturnType<typeof pdfjs.getDocument> | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [scale, setScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);

  const setPdfPage = useSidePanelStore((s) => s.setPdfPage);
  const setPdfTotalPages = useSidePanelStore((s) => s.setPdfTotalPages);

  // Render a specific page
  const renderPage = useCallback(async (pageNum: number, renderScale: number) => {
    const doc = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;

    // Cancel previous render
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel(); } catch { /* already done */ }
      renderTaskRef.current = null;
    }

    setIsRendering(true);
    try {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: renderScale });

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const task = page.render({ canvasContext: ctx, viewport, canvas });
      renderTaskRef.current = task;
      await task.promise;
      renderTaskRef.current = null;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('cancelled')) return;
      console.error('PDF render error:', err);
    } finally {
      setIsRendering(false);
    }
  }, []);

  // Calculate fit-to-width scale
  const calcFitScale = useCallback(async () => {
    const doc = pdfDocRef.current;
    const container = containerRef.current;
    if (!doc || !container) return 1;

    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const containerWidth = container.clientWidth - 32; // padding
    return containerWidth / viewport.width;
  }, []);

  // Load document
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      // Cleanup previous
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }

      const url = window.levante.fs.getPdfUrl(tab.filePath);
      const loadingTask = pdfjs.getDocument({ url });
      loadingTaskRef.current = loadingTask;

      try {
        const doc = await loadingTask.promise;
        if (cancelled) {
          doc.destroy();
          return;
        }

        pdfDocRef.current = doc;
        setPdfTotalPages(tab.id, doc.numPages);

        const newFitScale = await calcFitScale();
        if (cancelled) return;

        setFitScale(newFitScale);
        setScale(newFitScale);
        setIsLoading(false);

        await renderPage(tab.currentPage, newFitScale);
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Failed to load PDF';
        if (!msg.includes('destroy')) {
          setError(msg);
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      if (loadingTaskRef.current) {
        try { loadingTaskRef.current.destroy(); } catch { /* ok */ }
        loadingTaskRef.current = null;
      }
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch { /* ok */ }
        renderTaskRef.current = null;
      }
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
  }, [tab.filePath, tab.id, setPdfTotalPages, calcFitScale, renderPage, tab.currentPage]);

  // Re-render on page or scale change
  useEffect(() => {
    if (!isLoading && pdfDocRef.current) {
      renderPage(tab.currentPage, scale);
    }
  }, [tab.currentPage, scale, isLoading, renderPage]);

  // ResizeObserver for fit-to-width recalculation
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(async () => {
      if (!pdfDocRef.current) return;
      const newFit = await calcFitScale();
      setFitScale(newFit);
      setScale(newFit);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [calcFitScale]);

  // Navigation handlers
  const goToPrev = () => {
    if (tab.currentPage > 1) {
      setPdfPage(tab.id, tab.currentPage - 1);
    }
  };

  const goToNext = () => {
    if (tab.currentPage < tab.totalPages) {
      setPdfPage(tab.id, tab.currentPage + 1);
    }
  };

  const zoomIn = () => setScale((s) => Math.min(s * 1.25, fitScale * 3));
  const zoomOut = () => setScale((s) => Math.max(s / 1.25, fitScale * 0.25));

  const handlePageInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (!isNaN(val) && val >= 1 && val <= tab.totalPages) {
      setPdfPage(tab.id, val);
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground p-4">
        <p className="text-sm font-medium">Failed to load PDF</p>
        <p className="text-xs opacity-70 text-center">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-2 py-1 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={goToPrev}
            disabled={tab.currentPage <= 1 || isRendering}
            title="Previous page"
          >
            <ChevronLeft size={14} />
          </Button>

          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="text"
              defaultValue={tab.currentPage}
              key={tab.currentPage}
              onKeyDown={handlePageInput}
              className="w-8 h-5 text-center text-xs bg-background border rounded px-0.5"
              title="Go to page"
            />
            <span>/ {tab.totalPages || '...'}</span>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={goToNext}
            disabled={tab.currentPage >= tab.totalPages || isRendering}
            title="Next page"
          >
            <ChevronRight size={14} />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={zoomOut}
            disabled={isRendering}
            title="Zoom out"
          >
            <ZoomOut size={14} />
          </Button>
          <span className="text-xs text-muted-foreground w-10 text-center">
            {Math.round((scale / fitScale) * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={zoomIn}
            disabled={isRendering}
            title="Zoom in"
          >
            <ZoomIn size={14} />
          </Button>
        </div>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-auto flex justify-center p-4 bg-muted/10"
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={24} className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="shadow-md"
          />
        )}
      </div>
    </div>
  );
}
