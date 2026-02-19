import { create } from 'zustand';
import type {
  ConsoleError,
  WebAppLoadError,
  DiscoveredPreviewService,
  PreviewDiscoveryResult,
} from '../../../types/preview';

interface PreviewNavState {
  currentUrl: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isDevToolsOpen: boolean;
  autoRefresh: boolean;
  consoleErrors: ConsoleError[];
  loadError: WebAppLoadError | null;

  // Discovery state
  discoveredServices: DiscoveredPreviewService[];
  recommendedUrl: string | null;
  isDiscovering: boolean;
  lastDiscoveryAt: number | null;
  discoveryError: string | null;

  // Actions
  setCurrentUrl: (url: string) => void;
  setIsLoading: (loading: boolean) => void;
  setNavState: (canBack: boolean, canForward: boolean) => void;
  setDevToolsOpen: (open: boolean) => void;
  setAutoRefresh: (enabled: boolean) => void;
  addConsoleError: (error: ConsoleError) => void;
  clearConsoleErrors: () => void;
  setLoadError: (error: WebAppLoadError | null) => void;

  // Discovery actions
  setDiscoveryResult: (result: PreviewDiscoveryResult) => void;
  setDiscovering: (discovering: boolean) => void;
  setDiscoveryError: (error: string | null) => void;

  reset: () => void;
}

const initialState = {
  currentUrl: '',
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  isDevToolsOpen: false,
  autoRefresh: true,
  consoleErrors: [] as ConsoleError[],
  loadError: null as WebAppLoadError | null,
  // Discovery initial state
  discoveredServices: [] as DiscoveredPreviewService[],
  recommendedUrl: null as string | null,
  isDiscovering: false,
  lastDiscoveryAt: null as number | null,
  discoveryError: null as string | null,
};

export const usePreviewStore = create<PreviewNavState>((set) => ({
  ...initialState,

  setCurrentUrl: (url) => set({ currentUrl: url, loadError: null }),

  setIsLoading: (loading) => set({ isLoading: loading }),

  setNavState: (canBack, canForward) => set({ canGoBack: canBack, canGoForward: canForward }),

  setDevToolsOpen: (open) => set({ isDevToolsOpen: open }),

  setAutoRefresh: (enabled) => set({ autoRefresh: enabled }),

  addConsoleError: (error) =>
    set((state) => ({
      consoleErrors: [...state.consoleErrors.slice(-99), error], // Keep max 100 errors
    })),

  clearConsoleErrors: () => set({ consoleErrors: [] }),

  setLoadError: (error) => set({ loadError: error }),

  // Discovery actions
  setDiscoveryResult: (result) =>
    set({
      discoveredServices: result.services,
      recommendedUrl: result.recommendedUrl,
      lastDiscoveryAt: Date.now(),
      discoveryError: result.error || null,
      isDiscovering: false,
    }),

  setDiscovering: (discovering) => set({ isDiscovering: discovering }),

  setDiscoveryError: (error) => set({ discoveryError: error, isDiscovering: false }),

  reset: () => set(initialState),
}));
