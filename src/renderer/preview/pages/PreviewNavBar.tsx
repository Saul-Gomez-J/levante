import React, { useEffect, useCallback, useRef } from 'react';
import { NavigationBar } from '../components/NavigationBar';
import { LoadErrorDisplay } from '../components/LoadErrorDisplay';
import { usePreviewStore } from '../stores/previewStore';

const DISCOVERY_POLL_INTERVAL_MS = 12000; // 12 seconds

export function PreviewNavBar() {
  const {
    loadError,
    currentUrl,
    setCurrentUrl,
    setIsLoading,
    setNavState,
    setDevToolsOpen,
    setAutoRefresh,
    addConsoleError,
    setLoadError,
    setDiscoveryResult,
    setDiscovering,
  } = usePreviewStore();

  const requestTokenRef = useRef(0);
  const hasAutoNavigatedRef = useRef(false);

  // Subscribe to events from main process
  useEffect(() => {
    const nav = window.levantePreviewNav;
    if (!nav) {
      console.error('levantePreviewNav not available');
      return;
    }

    const cleanupFns: (() => void)[] = [];

    cleanupFns.push(
      nav.onUrlChanged(({ url }) => {
        setCurrentUrl(url);
      })
    );

    cleanupFns.push(
      nav.onLoading(({ isLoading }) => {
        setIsLoading(isLoading);
        if (isLoading) {
          setLoadError(null); // Clear error when starting new load
        }
      })
    );

    cleanupFns.push(
      nav.onNavigated((event) => {
        setCurrentUrl(event.url);
        setNavState(event.canGoBack, event.canGoForward);
        setIsLoading(event.isLoading);
      })
    );

    cleanupFns.push(
      nav.onConsoleError((error) => {
        addConsoleError(error);
      })
    );

    cleanupFns.push(
      nav.onDevToolsToggled(({ isOpen }) => {
        setDevToolsOpen(isOpen);
      })
    );

    cleanupFns.push(
      nav.onLoadError((error) => {
        setLoadError(error);
        setIsLoading(false);
      })
    );

    cleanupFns.push(
      nav.onFileChanged(() => {
        // File changed event - could show a toast or indicator
        // For now, the auto-refresh happens automatically in main process
      })
    );

    return () => {
      cleanupFns.forEach((cleanup) => cleanup());
    };
  }, [setCurrentUrl, setIsLoading, setNavState, setDevToolsOpen, setAutoRefresh, addConsoleError, setLoadError]);

  // Discovery function
  const runDiscovery = useCallback(async (autoNavigate = false) => {
    const nav = window.levantePreviewNav;
    if (!nav?.discoverUrls) {
      console.error('discoverUrls not available');
      return;
    }

    const token = ++requestTokenRef.current;
    setDiscovering(true);

    try {
      const result = await nav.discoverUrls();

      // Ignore stale responses
      if (token !== requestTokenRef.current) {
        return;
      }

      setDiscoveryResult(result);

      // Auto-navigate to recommended URL if no current URL and hasn't auto-navigated yet
      if (autoNavigate && !hasAutoNavigatedRef.current && result.recommendedUrl && !currentUrl) {
        hasAutoNavigatedRef.current = true;
        nav.navigateTo(result.recommendedUrl);
      }
    } catch (error) {
      if (token === requestTokenRef.current) {
        setDiscovering(false);
      }
    }
  }, [currentUrl, setDiscovering, setDiscoveryResult]);

  // Initial discovery and polling
  useEffect(() => {
    // Run initial discovery with auto-navigate
    runDiscovery(true);

    // Set up polling
    const intervalId = setInterval(() => {
      runDiscovery(false);
    }, DISCOVERY_POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [runDiscovery]);

  // Handler for manual refresh
  const handleRefreshDiscovery = useCallback(() => {
    runDiscovery(false);
  }, [runDiscovery]);

  // Handlers that call the nav API
  const handleNavigateTo = useCallback((url: string) => {
    window.levantePreviewNav?.navigateTo(url);
  }, []);

  const handleGoBack = useCallback(() => {
    window.levantePreviewNav?.goBack();
  }, []);

  const handleGoForward = useCallback(() => {
    window.levantePreviewNav?.goForward();
  }, []);

  const handleReload = useCallback(() => {
    window.levantePreviewNav?.reload();
  }, []);

  const handleToggleDevTools = useCallback(() => {
    window.levantePreviewNav?.toggleDevTools();
  }, []);

  const handleOpenExternal = useCallback(() => {
    window.levantePreviewNav?.openExternal();
  }, []);

  const handleToggleAutoRefresh = useCallback((enabled: boolean) => {
    setAutoRefresh(enabled);
    window.levantePreviewNav?.setAutoRefresh(enabled);
  }, [setAutoRefresh]);

  return (
    <div className="relative h-12 bg-background">
      <NavigationBar
        onNavigateTo={handleNavigateTo}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onReload={handleReload}
        onToggleDevTools={handleToggleDevTools}
        onOpenExternal={handleOpenExternal}
        onToggleAutoRefresh={handleToggleAutoRefresh}
        onRefreshDiscovery={handleRefreshDiscovery}
      />
      {loadError && <LoadErrorDisplay error={loadError} />}
    </div>
  );
}
