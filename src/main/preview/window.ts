import { BrowserWindow, WebContentsView, screen } from 'electron';
import { join } from 'path';
import { getLogger } from '../services/logging';
import { preferencesService } from '../services/preferencesService';
import { normalizeEndpoint } from '../utils/urlValidator';
import { safeOpenExternal } from '../utils/urlSecurity';
import type { ConsoleError, NavigationEvent, PreviewState, WebAppLoadError } from '../../types/preview';

const logger = getLogger();
const NAV_BAR_HEIGHT = 48;

let previewWindow: BrowserWindow | null = null;
let navBarView: WebContentsView | null = null;
let webAppView: WebContentsView | null = null;
let currentUrl: string | null = null;
let isDevToolsOpen = false;
let autoRefreshEnabled = true;

/**
 * Creates the preview window with nav bar and webapp views
 */
export function createPreviewWindow(url?: string): BrowserWindow {
  if (previewWindow && !previewWindow.isDestroyed()) {
    logger.core.debug('Preview window already exists, focusing');
    previewWindow.focus();
    if (url) {
      loadPreviewUrl(url);
    }
    return previewWindow;
  }

  logger.core.info('Creating preview window');

  // Get current display based on cursor position
  const cursorPoint = screen.getCursorScreenPoint();
  const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const { width: screenWidth, height: screenHeight } = currentDisplay.workAreaSize;
  const { x: displayX, y: displayY } = currentDisplay.bounds;

  // Default size and position
  const windowWidth = Math.min(1024, screenWidth * 0.7);
  const windowHeight = Math.min(768, screenHeight * 0.8);
  const x = displayX + Math.floor((screenWidth - windowWidth) / 2);
  const y = displayY + Math.floor((screenHeight - windowHeight) / 2);

  previewWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x,
    y,
    minWidth: 400,
    minHeight: 300,
    show: false,
    frame: true,
    title: 'Preview',
    webPreferences: {
      // Main window doesn't need webPreferences, we use WebContentsView
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Create the two views
  createNavBarView();
  createWebAppView();

  // Add views to window
  if (navBarView) {
    previewWindow.contentView.addChildView(navBarView);
  }
  if (webAppView) {
    previewWindow.contentView.addChildView(webAppView);
  }

  // Set initial bounds
  updateViewBounds();

  // Load nav bar UI
  loadNavBarUI();

  // Handle resize
  previewWindow.on('resize', () => {
    updateViewBounds();
  });

  // Handle close
  previewWindow.on('closed', () => {
    logger.core.info('Preview window closed');
    previewWindow = null;
    navBarView = null;
    webAppView = null;
    currentUrl = null;
    isDevToolsOpen = false;
    notifyMainWindows('preview-closed');
  });

  // Show window when navBar finishes loading
  if (navBarView) {
    navBarView.webContents.once('did-finish-load', () => {
      if (previewWindow && !previewWindow.isDestroyed()) {
        previewWindow.show();
        if (url) {
          loadPreviewUrl(url);
        }
      }
    });

    // Fallback: show after timeout if did-finish-load doesn't fire
    setTimeout(() => {
      if (previewWindow && !previewWindow.isDestroyed() && !previewWindow.isVisible()) {
        logger.core.warn('Preview window shown via fallback timeout');
        previewWindow.show();
      }
    }, 3000);
  }

  logger.core.info('Preview window created');
  return previewWindow;
}

/**
 * Creates the navigation bar view with dedicated preload
 */
function createNavBarView(): void {
  navBarView = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, 'navPreload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  logger.core.debug('NavBar view created');
}

/**
 * Creates the web app view (no preload for user's webapp)
 */
function createWebAppView(): void {
  webAppView = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  setupWebAppEventListeners();
  logger.core.debug('WebApp view created');
}

/**
 * Updates view bounds based on window size
 */
function updateViewBounds(): void {
  if (!previewWindow || previewWindow.isDestroyed()) return;

  const { width, height } = previewWindow.getContentBounds();

  if (navBarView) {
    navBarView.setBounds({
      x: 0,
      y: 0,
      width,
      height: NAV_BAR_HEIGHT,
    });
  }

  if (webAppView) {
    webAppView.setBounds({
      x: 0,
      y: NAV_BAR_HEIGHT,
      width,
      height: height - NAV_BAR_HEIGHT,
    });
  }
}

/**
 * Loads the nav bar UI (React app)
 */
function loadNavBarUI(): void {
  if (!navBarView) return;

  // Add error logging for nav bar loading
  navBarView.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    logger.core.error('NavBar failed to load', { errorCode, errorDescription, validatedUrl });
  });

  navBarView.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) {
      logger.core.warn('NavBar console', { level, message });
    }
  });

  if (process.env['MAIN_WINDOW_VITE_DEV_SERVER_URL']) {
    const devUrl = process.env['MAIN_WINDOW_VITE_DEV_SERVER_URL'].replace(/\/$/, '');
    const navUrl = `${devUrl}/preview/nav.html`;
    logger.core.info('NavBar loading from dev server', { url: navUrl });
    navBarView.webContents.loadURL(navUrl);
  } else if (process.env.NODE_ENV === 'development' && process.env['ELECTRON_RENDERER_URL']) {
    const devUrl = process.env['ELECTRON_RENDERER_URL'].replace(/\/$/, '');
    const navUrl = `${devUrl}/preview/nav.html`;
    logger.core.info('NavBar loading from electron-vite dev server', { url: navUrl });
    navBarView.webContents.loadURL(navUrl);
  } else {
    // Production - load from file
    const filePath = join(__dirname, '../renderer/main_window/preview/nav.html');
    logger.core.info('NavBar loading from file', { path: filePath });
    navBarView.webContents.loadFile(filePath);
  }
}

/**
 * Sets up event listeners for the webapp view
 */
function setupWebAppEventListeners(): void {
  if (!webAppView) return;

  const wc = webAppView.webContents;

  wc.on('did-start-loading', () => {
    sendToNavBar('levante/preview/nav/webapp-loading', { isLoading: true });
  });

  wc.on('did-stop-loading', () => {
    sendToNavBar('levante/preview/nav/webapp-loading', { isLoading: false });
  });

  wc.on('did-navigate', (_event, url) => {
    currentUrl = url;
    const navEvent: NavigationEvent = {
      url,
      title: wc.getTitle(),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
      isLoading: wc.isLoading(),
    };
    sendToNavBar('levante/preview/nav/webapp-navigated', navEvent);
    sendToNavBar('levante/preview/nav/url-changed', { url });
    notifyMainWindows('navigation-event', navEvent);
  });

  wc.on('did-navigate-in-page', (_event, url) => {
    currentUrl = url;
    const navEvent: NavigationEvent = {
      url,
      title: wc.getTitle(),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
      isLoading: wc.isLoading(),
    };
    sendToNavBar('levante/preview/nav/webapp-navigated', navEvent);
    sendToNavBar('levante/preview/nav/url-changed', { url });
    notifyMainWindows('navigation-event', navEvent);
  });

  wc.on('console-message', (_event, level, message, line, sourceId) => {
    // Only capture warnings and errors
    if (level >= 2) {
      // Filter out Electron internal warnings (not from user's webapp)
      if (message.includes('Electron Security Warning') ||
          message.includes('%cElectron Security Warning')) {
        return;
      }

      const consoleError: ConsoleError = {
        level: level === 2 ? 'warn' : 'error',
        message,
        source: sourceId,
        line,
        column: 0,
        timestamp: Date.now(),
      };
      sendToNavBar('levante/preview/nav/console-error', consoleError);
      notifyMainWindows('console-error', consoleError);
    }
  });

  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    const loadError: WebAppLoadError = {
      errorCode,
      errorDescription,
      url: validatedUrl,
    };
    sendToNavBar('levante/preview/nav/webapp-load-error', loadError);
    logger.core.warn('WebApp load failed', loadError);
  });

  // Handle page title changes
  wc.on('page-title-updated', (_event, title) => {
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.setTitle(`Preview - ${title}`);
    }
  });
}

/**
 * Sends a message to the nav bar view
 */
function sendToNavBar(channel: string, data: unknown): void {
  if (navBarView && !navBarView.webContents.isDestroyed()) {
    navBarView.webContents.send(channel, data);
  }
}

/**
 * Notifies all main windows (not preview) about events
 */
function notifyMainWindows(event: string, data?: unknown): void {
  const channel = `levante/preview/${event}`;
  const windows = BrowserWindow.getAllWindows();

  windows.forEach(window => {
    if (window && !window.isDestroyed() && window !== previewWindow) {
      try {
        window.webContents.send(channel, data);
      } catch (error) {
        logger.core.error('Failed to notify main window', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
}

/**
 * Validates if URL matches allowed patterns
 */
function isUrlAllowed(url: string, patterns: string[]): boolean {
  try {
    const parsedUrl = new URL(url);
    const hostWithPort = parsedUrl.port
      ? `${parsedUrl.hostname}:${parsedUrl.port}`
      : parsedUrl.hostname;

    for (const pattern of patterns) {
      if (matchPattern(hostWithPort, pattern)) {
        return true;
      }
      // Also try matching just the hostname
      if (matchPattern(parsedUrl.hostname, pattern)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Matches a string against a wildcard pattern
 */
function matchPattern(str: string, pattern: string): boolean {
  // Convert pattern to regex
  // * matches any characters within a segment
  // Replace * with [^.:]*
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars except *
    .replace(/\*/g, '[^.:]*'); // * matches anything except . and :

  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(str);
}

/**
 * Loads a URL in the webapp view
 */
export function loadPreviewUrl(url: string): { success: boolean; error?: string } {
  if (!webAppView) {
    return { success: false, error: 'Preview window not open' };
  }

  // Normalize the URL
  const normalizedUrl = normalizeEndpoint(url);

  // Get allowed patterns from preferences
  const allowedPatterns = preferencesService.get<string[]>('previewAllowedUrls') || [];

  // Validate URL
  if (!isUrlAllowed(normalizedUrl, allowedPatterns)) {
    const error: WebAppLoadError = {
      errorCode: -1,
      errorDescription: `URL not in allowlist. Only localhost and local network URLs are permitted.`,
      url: normalizedUrl,
    };
    sendToNavBar('levante/preview/nav/webapp-load-error', error);
    logger.core.warn('URL blocked by allowlist', { url: normalizedUrl, patterns: allowedPatterns });
    return { success: false, error: error.errorDescription };
  }

  try {
    currentUrl = normalizedUrl;
    webAppView.webContents.loadURL(normalizedUrl);
    sendToNavBar('levante/preview/nav/url-changed', { url: normalizedUrl });
    logger.core.info('Loading preview URL', { url: normalizedUrl });
    return { success: true };
  } catch (error) {
    logger.core.error('Failed to load preview URL', {
      url: normalizedUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: 'Failed to load URL' };
  }
}

/**
 * Reloads the webapp
 */
export function reloadPreview(): void {
  if (webAppView && !webAppView.webContents.isDestroyed()) {
    webAppView.webContents.reload();
    logger.core.debug('Preview reloaded');
  }
}

/**
 * Navigates back or forward
 */
export function navigatePreview(direction: 'back' | 'forward'): void {
  if (!webAppView || webAppView.webContents.isDestroyed()) return;

  if (direction === 'back' && webAppView.webContents.canGoBack()) {
    webAppView.webContents.goBack();
  } else if (direction === 'forward' && webAppView.webContents.canGoForward()) {
    webAppView.webContents.goForward();
  }
}

/**
 * Toggles DevTools for the webapp view
 */
export function togglePreviewDevTools(): boolean {
  if (!webAppView || webAppView.webContents.isDestroyed()) return false;

  if (webAppView.webContents.isDevToolsOpened()) {
    webAppView.webContents.closeDevTools();
    isDevToolsOpen = false;
  } else {
    webAppView.webContents.openDevTools({ mode: 'detach' });
    isDevToolsOpen = true;
  }

  sendToNavBar('levante/preview/nav/devtools-toggled', { isOpen: isDevToolsOpen });
  return isDevToolsOpen;
}

/**
 * Sets auto-refresh enabled state
 */
export function setPreviewAutoRefresh(enabled: boolean): void {
  autoRefreshEnabled = enabled;
  logger.core.debug('Preview auto-refresh set', { enabled });
}

/**
 * Opens current URL in external browser
 */
export function openPreviewExternal(): void {
  if (currentUrl) {
    safeOpenExternal(currentUrl, 'preview-window');
  }
}

/**
 * Notifies about file changes for auto-refresh
 */
export function notifyPreviewFileChanged(filePath: string): void {
  const timestamp = Date.now();
  const payload = { filePath, timestamp };

  // Notify nav bar
  sendToNavBar('levante/preview/nav/file-changed', payload);

  // Notify main windows
  notifyMainWindows('file-changed', payload);

  // Auto-refresh if enabled
  if (autoRefreshEnabled && webAppView && !webAppView.webContents.isDestroyed()) {
    webAppView.webContents.reloadIgnoringCache();
    logger.core.debug('Preview auto-refreshed due to file change', { filePath });
  }
}

/**
 * Gets current preview state
 */
export function getPreviewState(): PreviewState {
  const canGoBack = webAppView?.webContents?.canGoBack() ?? false;
  const canGoForward = webAppView?.webContents?.canGoForward() ?? false;

  return {
    isOpen: previewWindow !== null && !previewWindow.isDestroyed(),
    currentUrl,
    isDevToolsOpen,
    canGoBack,
    canGoForward,
    autoRefreshEnabled,
  };
}

/**
 * Closes the preview window
 */
export function closePreviewWindow(): void {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.close();
  }
}

/**
 * Gets the preview window instance (for internal use)
 */
export function getPreviewWindow(): BrowserWindow | null {
  return previewWindow;
}
