import React, { useState, useCallback, KeyboardEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  ExternalLink,
  Code2,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  Radio,
  Search,
} from 'lucide-react';
import { usePreviewStore } from '../stores/previewStore';

interface NavigationBarProps {
  onNavigateTo: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onToggleDevTools: () => void;
  onOpenExternal: () => void;
  onToggleAutoRefresh: (enabled: boolean) => void;
  onRefreshDiscovery: () => void;
}

export function NavigationBar({
  onNavigateTo,
  onGoBack,
  onGoForward,
  onReload,
  onToggleDevTools,
  onOpenExternal,
  onToggleAutoRefresh,
  onRefreshDiscovery,
}: NavigationBarProps) {
  const {
    currentUrl,
    isLoading,
    canGoBack,
    canGoForward,
    isDevToolsOpen,
    autoRefresh,
    consoleErrors,
    discoveredServices,
    isDiscovering,
  } = usePreviewStore();

  const [inputUrl, setInputUrl] = useState(currentUrl);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Sync input with current URL when it changes externally
  React.useEffect(() => {
    setInputUrl(currentUrl);
  }, [currentUrl]);

  const handleSubmit = useCallback(() => {
    if (inputUrl.trim()) {
      onNavigateTo(inputUrl.trim());
    }
  }, [inputUrl, onNavigateTo]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const errorCount = consoleErrors.filter((e) => e.level === 'error').length;
  const warnCount = consoleErrors.filter((e) => e.level === 'warn').length;

  const handleSelectService = useCallback(
    (url: string) => {
      onNavigateTo(url);
      setIsDropdownOpen(false);
    },
    [onNavigateTo]
  );

  const handleDropdownToggle = useCallback(() => {
    setIsDropdownOpen((prev) => !prev);
  }, []);

  // Close dropdown when clicking outside
  React.useEffect(() => {
    if (!isDropdownOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.services-dropdown')) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  return (
    <div className="flex items-center h-12 px-2 gap-1 bg-background border-b border-border">
      {/* Navigation buttons */}
      <button
        onClick={onGoBack}
        disabled={!canGoBack}
        className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
        title="Go back"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      <button
        onClick={onGoForward}
        disabled={!canGoForward}
        className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
        title="Go forward"
      >
        <ArrowRight className="w-4 h-4" />
      </button>
      <button
        onClick={onReload}
        className="p-1.5 rounded hover:bg-accent"
        title="Reload"
      >
        <RotateCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
      </button>

      {/* Services dropdown */}
      <div className="relative services-dropdown">
        <button
          onClick={handleDropdownToggle}
          className={`flex items-center gap-1 px-2 py-1.5 rounded hover:bg-accent text-sm ${
            discoveredServices.length > 0 ? 'text-foreground' : 'text-muted-foreground'
          }`}
          title={
            discoveredServices.length > 0
              ? `${discoveredServices.length} services detected`
              : 'No services detected'
          }
        >
          <Radio className={`w-4 h-4 ${discoveredServices.length > 0 ? 'text-green-500' : ''}`} />
          <span className="hidden sm:inline">
            {discoveredServices.length > 0 ? discoveredServices.length : '0'}
          </span>
          <ChevronDown className="w-3 h-3" />
        </button>

        {isDropdownOpen && (
          <div className="absolute top-full left-0 mt-1 w-64 bg-popover border border-border rounded-md shadow-lg z-50">
            <div className="p-2 border-b border-border flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Detected services</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRefreshDiscovery();
                }}
                className="p-1 rounded hover:bg-accent"
                title="Refresh discovery"
                disabled={isDiscovering}
              >
                <Search className={`w-3 h-3 ${isDiscovering ? 'animate-pulse' : ''}`} />
              </button>
            </div>

            {discoveredServices.length === 0 ? (
              <div className="p-3 text-center">
                <p className="text-sm text-muted-foreground">No running local services detected</p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefreshDiscovery();
                  }}
                  className="mt-2 px-3 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
                  disabled={isDiscovering}
                >
                  {isDiscovering ? 'Scanning...' : 'Refresh'}
                </button>
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto">
                {discoveredServices.map((service) => (
                  <button
                    key={service.id}
                    onClick={() => handleSelectService(service.url)}
                    className={`w-full px-3 py-2 text-left hover:bg-accent flex items-center gap-2 ${
                      currentUrl === service.url ? 'bg-accent' : ''
                    }`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${
                        service.status === 'online' ? 'bg-green-500' : 'bg-gray-400'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">
                        {service.frameworkGuess ? (
                          <span className="font-medium">{service.frameworkGuess}</span>
                        ) : (
                          <span>Service</span>
                        )}
                        <span className="text-muted-foreground ml-1">
                          · {service.host}:{service.port}
                        </span>
                      </div>
                      {service.title && (
                        <div className="text-xs text-muted-foreground truncate">{service.title}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* URL input */}
      <div className="flex-1 mx-2">
        <input
          type="text"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSubmit}
          placeholder="Enter URL (e.g., localhost:3000)"
          className="w-full px-3 py-1.5 text-sm rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Console errors indicator */}
      {(errorCount > 0 || warnCount > 0) && (
        <div
          className="flex items-center gap-1 px-2 py-1 rounded text-xs"
          title={`${errorCount} errors, ${warnCount} warnings`}
        >
          <AlertTriangle
            className={`w-4 h-4 ${errorCount > 0 ? 'text-destructive' : 'text-yellow-500'}`}
          />
          <span className={errorCount > 0 ? 'text-destructive' : 'text-yellow-500'}>
            {errorCount + warnCount}
          </span>
        </div>
      )}

      {/* Auto-refresh toggle */}
      <button
        onClick={() => onToggleAutoRefresh(!autoRefresh)}
        className={`p-1.5 rounded hover:bg-accent ${autoRefresh ? 'text-primary' : 'text-muted-foreground'}`}
        title={autoRefresh ? 'Auto-refresh enabled' : 'Auto-refresh disabled'}
      >
        <RefreshCw className="w-4 h-4" />
      </button>

      {/* DevTools toggle */}
      <button
        onClick={onToggleDevTools}
        className={`p-1.5 rounded hover:bg-accent ${isDevToolsOpen ? 'text-primary' : ''}`}
        title={isDevToolsOpen ? 'Close DevTools' : 'Open DevTools'}
      >
        <Code2 className="w-4 h-4" />
      </button>

      {/* Open external */}
      <button
        onClick={onOpenExternal}
        className="p-1.5 rounded hover:bg-accent"
        title="Open in browser"
      >
        <ExternalLink className="w-4 h-4" />
      </button>
    </div>
  );
}
