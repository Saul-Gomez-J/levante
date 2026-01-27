/**
 * Mini Chat Window Module
 * 
 * Manages the floating mini-chat window that appears with global shortcut.
 * Styled similar to Spotlight/Alfred/Raycast for quick AI interactions.
 */

import { BrowserWindow, screen, shell, ipcMain } from 'electron';
import { join } from 'path';
import { getLogger } from '../services/logging';

const logger = getLogger();

let miniChatWindow: BrowserWindow | null = null;

interface MiniChatWindowConfig {
  width: number;
  height: number;
  maxHeight: number;
}

const DEFAULT_CONFIG: MiniChatWindowConfig = {
  width: 600,
  height: 140,      // Initial height (input only)
  maxHeight: 500,   // Max height when conversation grows
};

/**
 * Creates the mini-chat window (initially hidden)
 */
export function createMiniChatWindow(): BrowserWindow {
  if (miniChatWindow && !miniChatWindow.isDestroyed()) {
    logger.core.debug('Mini chat window already exists');
    return miniChatWindow;
  }

  logger.core.info('Creating mini chat window');

  // Get primary display for initial positioning
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Position at center-top of screen (Spotlight style)
  const x = Math.floor((screenWidth - DEFAULT_CONFIG.width) / 2);
  const y = Math.floor(screenHeight * 0.2); // 20% from top

  miniChatWindow = new BrowserWindow({
    width: DEFAULT_CONFIG.width,
    height: DEFAULT_CONFIG.height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    closable: true,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    hasShadow: true,
    // macOS specific styling
    ...(process.platform === 'darwin' && {
      vibrancy: 'popover',
      visualEffectState: 'active',
    }),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // Set always on top level based on platform
  const alwaysOnTopLevel = process.platform === 'darwin' ? 'floating' : 'pop-up-menu';
  miniChatWindow.setAlwaysOnTop(true, alwaysOnTopLevel);

  // Make visible on all workspaces/desktops
  miniChatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Load the mini-chat page
  if (process.env['MAIN_WINDOW_VITE_DEV_SERVER_URL']) {
    const devUrl = process.env['MAIN_WINDOW_VITE_DEV_SERVER_URL'].replace(/\/$/, '');
    miniChatWindow.loadURL(`${devUrl}/mini-chat.html`);
    logger.core.debug('Mini chat loading from dev server', { url: `${devUrl}/mini-chat.html` });
  } else if (process.env.NODE_ENV === 'development' && process.env['ELECTRON_RENDERER_URL']) {
    const devUrl = process.env['ELECTRON_RENDERER_URL'].replace(/\/$/, '');
    miniChatWindow.loadURL(`${devUrl}/mini-chat.html`);
  } else {
    const filePath = join(__dirname, '../renderer/mini_chat/index.html');
    miniChatWindow.loadFile(filePath);
    logger.core.debug('Mini chat loading from file', { path: filePath });
  }

  // Hide when loses focus (Spotlight behavior)
  miniChatWindow.on('blur', () => {
    // Small delay to allow interactions within the window
    setTimeout(() => {
      if (miniChatWindow && !miniChatWindow.isDestroyed() && !miniChatWindow.isFocused()) {
        hideMiniChat();
      }
    }, 150);
  });

  // Clean up reference when closed
  miniChatWindow.on('closed', () => {
    logger.core.debug('Mini chat window closed');
    miniChatWindow = null;
  });

  // Handle external links
  miniChatWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  logger.core.info('Mini chat window created');
  return miniChatWindow;
}

/**
 * Shows the mini-chat window, centering on the current display
 */
export function showMiniChat(): void {
  if (!miniChatWindow || miniChatWindow.isDestroyed()) {
    createMiniChatWindow();
  }

  if (miniChatWindow) {
    // Center on the display where the cursor currently is
    const cursorPoint = screen.getCursorScreenPoint();
    const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
    const { width: screenWidth } = currentDisplay.workAreaSize;
    const { x: displayX, y: displayY } = currentDisplay.bounds;

    const x = displayX + Math.floor((screenWidth - DEFAULT_CONFIG.width) / 2);
    const y = displayY + Math.floor(currentDisplay.workAreaSize.height * 0.2);

    miniChatWindow.setPosition(x, y);
    miniChatWindow.show();
    miniChatWindow.focus();

    // Notify renderer that window is shown
    miniChatWindow.webContents.send('levante/mini-chat/shown');

    logger.core.debug('Mini chat window shown', { x, y });
  }
}

/**
 * Hides the mini-chat window
 */
export function hideMiniChat(): void {
  if (miniChatWindow && !miniChatWindow.isDestroyed()) {
    miniChatWindow.hide();
    
    // Reset height to minimum
    miniChatWindow.setSize(DEFAULT_CONFIG.width, DEFAULT_CONFIG.height);
    
    // Notify renderer that window is hidden
    miniChatWindow.webContents.send('levante/mini-chat/hidden');

    logger.core.debug('Mini chat window hidden');
  }
}

/**
 * Toggles the mini-chat window visibility
 */
export function toggleMiniChat(): void {
  if (miniChatWindow && miniChatWindow.isVisible()) {
    hideMiniChat();
  } else {
    showMiniChat();
  }
}

/**
 * Resizes the mini-chat window height (for when conversation grows)
 */
export function resizeMiniChatHeight(height: number): void {
  if (miniChatWindow && !miniChatWindow.isDestroyed()) {
    const clampedHeight = Math.min(
      Math.max(height, DEFAULT_CONFIG.height),
      DEFAULT_CONFIG.maxHeight
    );
    miniChatWindow.setSize(DEFAULT_CONFIG.width, clampedHeight);
    logger.core.debug('Mini chat window resized', { height: clampedHeight });
  }
}

/**
 * Gets the mini-chat window instance
 */
export function getMiniChatWindow(): BrowserWindow | null {
  return miniChatWindow;
}

/**
 * Destroys the mini-chat window
 */
export function destroyMiniChatWindow(): void {
  if (miniChatWindow && !miniChatWindow.isDestroyed()) {
    logger.core.info('Destroying mini chat window');
    miniChatWindow.destroy();
    miniChatWindow = null;
  }
}

/**
 * Registers IPC handlers for mini-chat window control
 */
export function registerMiniChatIPC(): void {
  ipcMain.handle('levante/mini-chat/hide', () => {
    hideMiniChat();
    return { success: true };
  });

  ipcMain.handle('levante/mini-chat/resize', (_, height: number) => {
    resizeMiniChatHeight(height);
    return { success: true };
  });

  ipcMain.handle('levante/mini-chat/toggle', () => {
    toggleMiniChat();
    return { success: true };
  });

  logger.core.debug('Mini chat IPC handlers registered');
}
