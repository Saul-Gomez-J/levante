/**
 * SidePanel
 *
 * Unified right panel that replaces WebPreviewPanel.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { useSidePanelStore } from '@/stores/sidePanelStore';
import { PanelTabBar, PanelContextBar, PanelContent } from './panel';
import { useSidebar } from '@/components/ui/sidebar';

const MIN_PANEL_WIDTH = 320;
const MIN_CHAT_WIDTH = 300;
const DEFAULT_PANEL_WIDTH = 960;

export function SidePanel() {
  const tabs = useSidePanelStore((state) => state.tabs);
  const activeTabId = useSidePanelStore((state) => state.activeTabId);
  const isPanelOpen = useSidePanelStore((state) => state.isPanelOpen);
  const closeTab = useSidePanelStore((state) => state.closeTab);
  const setActiveTab = useSidePanelStore((state) => state.setActiveTab);
  const closePanel = useSidePanelStore((state) => state.closePanel);

  const { setOpen: setSidebarOpen } = useSidebar();

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  // Hide left sidebar only on the transition from closed → open (not on every render).
  const wasPanelOpen = useRef(false);
  useEffect(() => {
    if (isPanelOpen && !wasPanelOpen.current) {
      setSidebarOpen(false);
    }
    wasPanelOpen.current = isPanelOpen;
  }, [isPanelOpen, setSidebarOpen]);

  const [width, setWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [iframeKey, setIframeKey] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const maxWidthRef = useRef(DEFAULT_PANEL_WIDTH * 2);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      setIsDragging(true);
      startX.current = e.clientX;
      startWidth.current = width;

      maxWidthRef.current = containerRef.current?.parentElement
        ? containerRef.current.parentElement.clientWidth - MIN_CHAT_WIDTH
        : DEFAULT_PANEL_WIDTH * 2;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isResizing.current) return;

        const delta = startX.current - ev.clientX;
        const nextWidth = Math.min(
          maxWidthRef.current,
          Math.max(MIN_PANEL_WIDTH, startWidth.current + delta)
        );

        setWidth(nextWidth);
      };

      const handleMouseUp = () => {
        isResizing.current = false;
        setIsDragging(false);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [width]
  );

  const handleReload = () => {
    setIframeKey((value) => value + 1);
  };

  const handleOpenExternal = () => {
    if (activeTab?.type === 'server') {
      void window.levante.openExternal(activeTab.url);
    }
  };

  if (!isPanelOpen || tabs.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef} className="flex shrink-0 h-full" style={{ width }}>
      <div
        className="w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors shrink-0 h-full"
        onMouseDown={handleMouseDown}
      />

      <div className="flex-1 min-h-0 min-w-0 flex flex-col border-l bg-background overflow-hidden">
        <PanelTabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={setActiveTab}
          onCloseTab={closeTab}
          onClosePanel={closePanel}
          activeTab={activeTab}
          onReload={handleReload}
          onOpenExternal={handleOpenExternal}
        />

        <PanelContextBar tab={activeTab} />

        <PanelContent tab={activeTab} isDragging={isDragging} iframeKey={iframeKey} />
      </div>
    </div>
  );
}
