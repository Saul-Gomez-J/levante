/**
 * Global Shortcuts Module
 * 
 * Manages system-wide keyboard shortcuts that work even when
 * the application doesn't have focus.
 */

import { globalShortcut, app } from 'electron';
import { getLogger } from '../services/logging';

const logger = getLogger();

interface ShortcutConfig {
  miniChat: string;
}

const DEFAULT_SHORTCUTS: ShortcutConfig = {
  miniChat: 'CommandOrControl+Shift+Space',
};

interface ShortcutCallbacks {
  onMiniChatToggle: () => void;
}

const registeredShortcuts: string[] = [];

/**
 * Registers all global shortcuts
 */
export function registerGlobalShortcuts(callbacks: ShortcutCallbacks): void {
  logger.core.info('Registering global shortcuts');

  const shortcuts = { ...DEFAULT_SHORTCUTS };

  // Register Mini Chat shortcut
  try {
    const miniChatRegistered = globalShortcut.register(
      shortcuts.miniChat,
      () => {
        logger.core.debug('Mini chat shortcut triggered', { shortcut: shortcuts.miniChat });
        callbacks.onMiniChatToggle();
      }
    );

    if (miniChatRegistered) {
      registeredShortcuts.push(shortcuts.miniChat);
      logger.core.info('Global shortcut registered', { 
        shortcut: shortcuts.miniChat, 
        action: 'miniChat' 
      });
    } else {
      logger.core.warn('Failed to register global shortcut - may be in use by another app', {
        shortcut: shortcuts.miniChat,
      });
    }
  } catch (error) {
    logger.core.error('Error registering global shortcut', {
      shortcut: shortcuts.miniChat,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Checks if a specific shortcut is registered
 */
export function isShortcutRegistered(shortcut: string): boolean {
  return globalShortcut.isRegistered(shortcut);
}

/**
 * Unregisters all global shortcuts
 */
export function unregisterAllShortcuts(): void {
  logger.core.info('Unregistering all global shortcuts', { 
    count: registeredShortcuts.length 
  });

  for (const shortcut of registeredShortcuts) {
    try {
      globalShortcut.unregister(shortcut);
      logger.core.debug('Unregistered shortcut', { shortcut });
    } catch (error) {
      logger.core.error('Error unregistering shortcut', {
        shortcut,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  registeredShortcuts.length = 0;
}

/**
 * Gets currently registered shortcuts
 */
export function getRegisteredShortcuts(): string[] {
  return [...registeredShortcuts];
}

// Cleanup shortcuts when app is quitting
app.on('will-quit', () => {
  unregisterAllShortcuts();
});
