export interface PreviewState {
  isOpen: boolean;
  currentUrl: string | null;
  isDevToolsOpen: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  autoRefreshEnabled: boolean;
}

export interface ConsoleError {
  level: 'warn' | 'error';
  message: string;
  source: string;
  line: number;
  column: number;
  timestamp: number;
}

export interface NavigationEvent {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

export interface WebAppLoadError {
  errorCode: number;
  errorDescription: string;
  url: string;
}

// Discovery types
export * from './discovery';
