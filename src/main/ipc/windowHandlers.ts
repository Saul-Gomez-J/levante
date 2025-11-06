/**
 * Window Control IPC Handlers
 * Handles window minimize, maximize, close operations
 */

import { ipcMain, BrowserWindow } from "electron";
import { getLogger } from "../services/logging";

const logger = getLogger();

/**
 * Register all window control IPC handlers
 */
export function registerWindowHandlers(mainWindow: BrowserWindow): void {
  // Minimize window
  ipcMain.handle("levante/window/minimize", async () => {
    try {
      mainWindow.minimize();
      logger.core.debug("Window minimized");
      return { success: true };
    } catch (error) {
      logger.core.error("Failed to minimize window", {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to minimize window",
      };
    }
  });

  // Maximize or restore window
  ipcMain.handle("levante/window/maximize", async () => {
    try {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
        logger.core.debug("Window restored");
      } else {
        mainWindow.maximize();
        logger.core.debug("Window maximized");
      }
      return { success: true };
    } catch (error) {
      logger.core.error("Failed to maximize/restore window", {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to maximize/restore window",
      };
    }
  });

  // Close window
  ipcMain.handle("levante/window/close", async () => {
    try {
      mainWindow.close();
      logger.core.debug("Window closed");
      return { success: true };
    } catch (error) {
      logger.core.error("Failed to close window", {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to close window",
      };
    }
  });

  // Check if window is maximized
  ipcMain.handle("levante/window/isMaximized", async () => {
    try {
      const isMaximized = mainWindow.isMaximized();
      return { success: true, data: isMaximized };
    } catch (error) {
      logger.core.error("Failed to check maximize state", {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to check maximize state",
      };
    }
  });

  // Listen for maximize/unmaximize events and notify renderer
  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("levante/window/maximize-changed", true);
    logger.core.debug("Window maximize event");
  });

  mainWindow.on("unmaximize", () => {
    mainWindow.webContents.send("levante/window/maximize-changed", false);
    logger.core.debug("Window unmaximize event");
  });
}
