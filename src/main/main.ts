// Fix PATH for packaged macOS/Linux apps - must be first import
// Safe on Windows (no-op), required for macOS/Linux GUI apps
import fixPath from "fix-path";
fixPath();

import { app, BrowserWindow } from "electron";
import { join } from "path";
import { config } from "dotenv";
import { initializeLogger } from "./services/logging";
import { updateService } from "./services/updateService";
import { announcementService } from "./services/announcementService";
import { deepLinkService } from "./services/deepLinkService";
import { oauthCallbackServer } from "./services/oauthCallbackServer";
import { analyticsService } from "./services/analytics";
import { createApplicationMenu } from "./menu";
import { widgetProxyService } from "./services/widgetProxy";

// Lifecycle modules
import { initializeServices, registerIPCHandlers } from "./lifecycle/initialization";
import { createMainWindow } from "./lifecycle/window";
import { registerAppEvents, setupDeepLinkHandling } from "./lifecycle/events";
import { setupLogViewerHandlers } from "./ipc/logViewerHandlers";

// Mini Chat modules
import { createSystemTray, destroySystemTray } from "./tray/systemTray";
import { registerGlobalShortcuts, unregisterAllShortcuts } from "./shortcuts/globalShortcuts";
import { 
  createMiniChatWindow, 
  toggleMiniChat, 
  destroyMiniChatWindow,
  registerMiniChatIPC 
} from "./windows";

// Load environment variables
config({ path: join(__dirname, "../../.env.local") });
config({ path: join(__dirname, "../../.env") });

// Initialize logger
initializeLogger();

// Initialize auto-updates
updateService.initialize();

// Initialize announcement service
announcementService.initialize();

// Register custom protocol for deep linking
if (process.defaultApp) {
  // Development mode
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("levante", process.execPath, [
      join(__dirname, "../../"),
    ]);
  }
} else {
  // Production mode
  app.setAsDefaultProtocolClient("levante");
}

// Keep global reference to main window
let mainWindow: BrowserWindow | null = null;

// App ready event
app.whenReady().then(async () => {
  try {
    // Start widget proxy HTTP server for serving widget HTML with permissive CSP
    await widgetProxyService.start();

    // Initialize all services
    await initializeServices();

    // Register all IPC handlers
    await registerIPCHandlers(() => mainWindow);

    // Create main window
    mainWindow = createMainWindow();

    // Register log viewer handlers (requires mainWindow instance)
    setupLogViewerHandlers(mainWindow);

    // Ensure user has UUID and is tracked (fire and forget, don't block UI)
    analyticsService.ensureUserTracked().catch(() => { });

    // Track app open (fire and forget, don't block UI)
    analyticsService.trackAppOpen().catch(() => { });

    // Create application menu
    createApplicationMenu(mainWindow);

    // Register main window with services
    deepLinkService.setMainWindow(mainWindow);
    oauthCallbackServer.setMainWindow(mainWindow);

    // Register app event handlers
    registerAppEvents(() => mainWindow);

    // Setup deep link handling (Windows/Linux)
    setupDeepLinkHandling();

    // Initialize Mini Chat system
    registerMiniChatIPC();
    
    // Create system tray for background operation
    createSystemTray({
      onToggleMiniChat: toggleMiniChat,
      onShowMainWindow: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    });

    // Register global shortcuts (e.g., Cmd+Shift+Space for quick chat)
    registerGlobalShortcuts({
      onMiniChatToggle: toggleMiniChat,
    });

    // Pre-create mini chat window (hidden) for instant response
    createMiniChatWindow();
  } catch (error) {
    console.error('Fatal error during app initialization:', error);
    // Show error dialog and quit
    const { dialog } = await import('electron');
    dialog.showErrorBox(
      'Initialization Error',
      `Failed to start the application:\n\n${error instanceof Error ? error.message : String(error)}`
    );
    app.quit();
  }
});

// Cleanup on app quit
app.on('will-quit', () => {
  unregisterAllShortcuts();
  destroySystemTray();
  destroyMiniChatWindow();
});

// On macOS, keep app running when all windows are closed (tray mode)
app.on('window-all-closed', () => {
  // Don't quit on macOS - allow tray mode
  if (process.platform !== 'darwin') {
    // On Windows/Linux, we could also keep running with tray
    // but for now follow platform conventions
    // Comment out app.quit() to enable tray mode on all platforms
    // app.quit();
  }
});
