/**
 * PdfViewer
 *
 * Renders a PDF document using pdfjs-dist with continuous scroll.
 * All pages are displayed in a scrollable container.
 * Uses IntersectionObserver for lazy rendering of visible pages.
 * State (loading/error/scale) is local; only page/totalPages sync to store.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { ZoomIn, ZoomOut, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSidePanelStore, type PdfTab } from '@/stores/sidePanelStore';

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfViewerProps {
  tab: PdfTab;
}

export function PdfViewer({ tab }: PdfViewerProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const renderTasks = useRef<Map<number, RenderTask>>(new Map());
  const renderedPages = useRef<Set<number>>(new Set());
  const loadingTaskRef = useRef<ReturnType<typeof pdfjs.getDocument> | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [pageDimensions, setPageDimensions] = useState<{ width: number; height: number }[]>([]);

  const setPdfPage = useSidePanelStore((s) => s.setPdfPage);
  const setPdfTotalPages = useSidePanelStore((s) => s.setPdfTotalPages);

  // Render a single page onto its canvas
  const renderPage = useCallback(async (pageNum: number, renderScale: number) => {
    const doc = pdfDocRef.current;
    const canvas = canvasRefs.current.get(pageNum);
    if (!doc || !canvas) return;

    // Cancel existing render for this page
    const existing = renderTasks.current.get(pageNum);
    if (existing) {
      try { existing.cancel(); } catch { /* ok */ }
      renderTasks.current.delete(pageNum);
    }

    try {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: renderScale });
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const task = page.render({ canvasContext: ctx, viewport, canvas });
      renderTasks.current.set(pageNum, task);
      await task.promise;
      renderTasks.current.delete(pageNum);
      renderedPages.current.add(pageNum);
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('cancelled')) return;
      console.error(`PDF render error (page ${pageNum}):`, err);
    }
  }, []);

  // Calculate fit-to-width scale
  const calcFitScale = useCallback(async () => {
    const doc = pdfDocRef.current;
    const container = scrollContainerRef.current;
    if (!doc || !container) return 1;

    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const containerWidth = container.clientWidth - 32; // padding
    return containerWidth / viewport.width;
  }, []);

  // Load document and collect page dimensions
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      renderedPages.current.clear();

      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }

      const url = window.levante.fs.getPdfUrl(tab.filePath);
      const loadingTask = pdfjs.getDocument({ url });
      loadingTaskRef.current = loadingTask;

      try {
        const doc = await loadingTask.promise;
        if (cancelled) { doc.destroy(); return; }

        pdfDocRef.current = doc;
        setPdfTotalPages(tab.id, doc.numPages);

        // Get dimensions for all pages at scale 1
        const dims: { width: number; height: number }[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          dims.push({ width: vp.width, height: vp.height });
        }
        if (cancelled) return;

        setPageDimensions(dims);

        const newFitScale = await calcFitScale();
        if (cancelled) return;

        setFitScale(newFitScale);
        setScale(newFitScale);
        setIsLoading(false);
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
      for (const task of renderTasks.current.values()) {
        try { task.cancel(); } catch { /* ok */ }
      }
      renderTasks.current.clear();
      renderedPages.current.clear();
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
  }, [tab.filePath, tab.id, setPdfTotalPages, calcFitScale]);

  // IntersectionObserver: lazy-render visible pages + track current page
  useEffect(() => {
    if (isLoading || pageDimensions.length === 0) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    // Clear rendered tracking (scale may have changed)
    renderedPages.current.clear();

    const observer = new IntersectionObserver(
      (entries) => {
        // Render newly visible pages
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const pageNum = parseInt(entry.target.getAttribute('data-page') || '0', 10);
          if (pageNum && !renderedPages.current.has(pageNum)) {
            renderPage(pageNum, scale);
          }
        });

        // Determine current page (topmost visible in viewport)
        const visiblePages: number[] = [];
        container.querySelectorAll('canvas[data-page]').forEach((el) => {
          const rect = el.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
            visiblePages.push(parseInt(el.getAttribute('data-page') || '0', 10));
          }
        });

        if (visiblePages.length > 0) {
          setPdfPage(tab.id, Math.min(...visiblePages));
        }
      },
      {
        root: container,
        rootMargin: '100% 0px', // Pre-render 1 viewport ahead/behind
        threshold: 0,
      },
    );

    container.querySelectorAll('canvas[data-page]').forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      // Cancel in-flight renders so stale tasks don't mark pages as rendered
      for (const task of renderTasks.current.values()) {
        try { task.cancel(); } catch { /* ok */ }
      }
      renderTasks.current.clear();
    };
  }, [isLoading, pageDimensions, scale, tab.id, setPdfPage, renderPage]);

  // ResizeObserver for fit-to-width recalculation
  useEffect(() => {
    const container = scrollContainerRef.current;
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

  // Zoom handlers
  const zoomIn = () => setScale((s) => Math.min(s * 1.25, fitScale * 3));
  const zoomOut = () => setScale((s) => Math.max(s / 1.25, fitScale * 0.25));

  // Go-to-page: scroll target canvas into view
  const handleGoToPage = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (!isNaN(val) && val >= 1 && val <= pageDimensions.length) {
      const canvas = canvasRefs.current.get(val);
      canvas?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      {/* Toolbar: go-to-page + zoom */}
      <div className="flex items-center justify-between gap-2 px-2 py-1 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Go to:</span>
          <input
            type="text"
            onKeyDown={handleGoToPage}
            className="w-8 h-5 text-center text-xs bg-background border rounded px-0.5"
            placeholder="#"
          />
          <span>/ {pageDimensions.length || '...'}</span>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={zoomOut} title="Zoom out">
            <ZoomOut size={14} />
          </Button>
          <span className="text-xs text-muted-foreground w-10 text-center">
            {Math.round((scale / fitScale) * 100)}%
          </span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={zoomIn} title="Zoom in">
            <ZoomIn size={14} />
          </Button>
        </div>
      </div>

      {/* Scrollable container with all pages */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-auto flex flex-col items-center gap-4 p-4 bg-muted/10"
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={24} className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          pageDimensions.map((dim, idx) => {
            const pageNum = idx + 1;
            return (
              <canvas
                key={pageNum}
                data-page={pageNum}
                ref={(el) => {
                  if (el) canvasRefs.current.set(pageNum, el);
                  else canvasRefs.current.delete(pageNum);
                }}
                style={{
                  width: `${dim.width * scale}px`,
                  height: `${dim.height * scale}px`,
                }}
                className="shadow-md shrink-0 bg-white"
              />
            );
          })
        )}
      </div>
    </div>
  );
}
