/**
 * System Tray Module
 * 
 * Manages the system tray icon and menu for background operation.
 * Allows the app to continue running when all windows are closed.
 */

import { Tray, Menu, nativeImage, app } from 'electron';
import { join } from 'path';
import { getLogger } from '../services/logging';

const logger = getLogger();

let tray: Tray | null = null;

interface TrayCallbacks {
  onToggleMiniChat: () => void;
  onShowMainWindow: () => void;
  onOpenSettings?: () => void;
}

/**
 * Creates the system tray icon and context menu
 */
export function createSystemTray(callbacks: TrayCallbacks): Tray {
  if (tray) {
    logger.core.debug('System tray already exists');
    return tray;
  }

  logger.core.info('Creating system tray');

  // Get icon path based on platform
  const iconName = process.platform === 'darwin' 
    ? 'trayIconTemplate.png'  // macOS template image (adapts to dark/light)
    : 'trayIcon.png';
  
  // Try multiple possible icon locations
  const possiblePaths = [
    join(__dirname, '../../resources/icons', iconName),
    join(__dirname, '../../../resources/icons', iconName),
    join(__dirname, '../../resources/icons/icon.png'),
    join(__dirname, '../../../resources/icons/icon.png'),
  ];

  let iconPath = possiblePaths[0];
  for (const path of possiblePaths) {
    try {
      const icon = nativeImage.createFromPath(path);
      if (!icon.isEmpty()) {
        iconPath = path;
        break;
      }
    } catch {
      // Continue to next path
    }
  }

  const icon = nativeImage.createFromPath(iconPath);
  
  // On macOS, use template image for automatic dark/light mode adaptation
  if (process.platform === 'darwin' && !icon.isEmpty()) {
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Levante AI');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Quick Chat',
      accelerator: 'CmdOrCtrl+Shift+Space',
      click: callbacks.onToggleMiniChat,
    },
    {
      label: 'Open Levante',
      click: callbacks.onShowMainWindow,
    },
    { type: 'separator' },
    {
      label: 'Settings...',
      accelerator: 'CmdOrCtrl+,',
      click: callbacks.onOpenSettings || callbacks.onShowMainWindow,
    },
    { type: 'separator' },
    {
      label: 'Quit Levante',
      accelerator: 'CmdOrCtrl+Q',
      click: () => {
        logger.core.info('Quit requested from tray menu');
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Click on tray icon toggles mini-chat
  tray.on('click', () => {
    logger.core.debug('Tray icon clicked');
    callbacks.onToggleMiniChat();
  });

  // Double-click opens main window (Windows/Linux)
  tray.on('double-click', () => {
    logger.core.debug('Tray icon double-clicked');
    callbacks.onShowMainWindow();
  });

  logger.core.info('System tray created successfully');
  return tray;
}

/**
 * Updates the tray tooltip (e.g., to show status)
 */
export function updateTrayTooltip(tooltip: string): void {
  if (tray) {
    tray.setToolTip(tooltip);
  }
}

/**
 * Destroys the system tray
 */
export function destroySystemTray(): void {
  if (tray) {
    logger.core.info('Destroying system tray');
    tray.destroy();
    tray = null;
  }
}

/**
 * Gets the current tray instance
 */
export function getSystemTray(): Tray | null {
  return tray;
}
