/**
 * Window Management Module
 *
 * Handles browser window creation and security configuration
 */

import { BrowserWindow, nativeTheme } from "electron";
import { join } from "path";
import { getLogger } from "../services/logging";
import { safeOpenExternal } from "../utils/urlSecurity";

const logger = getLogger();

/**
 * Creates and configures the main application window
 * Includes security handlers and navigation protection
 */
export function createMainWindow(): BrowserWindow {
  // IMPORTANT: Set nativeTheme to follow system BEFORE creating window
  nativeTheme.themeSource = "system";

  logger.core.info("NativeTheme configured", {
    themeSource: nativeTheme.themeSource,
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
  });
const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';

  // Create the browser window
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    useContentSize: true, // Width/height refer to content, not frame - reduces rounding issues on maximize
    icon: join(__dirname, "../../resources/icons/icon.png"), // App icon
    // Frameless on Windows/Linux to avoid thick frame hit-test issues with DPI scaling
    // See: https://github.com/electron/electron/issues/7347
    frame: isMac, // Only macOS keeps frame (for traffic lights)
    ...((isWin || isLinux) ? { thickFrame: false } : {}), // Disable thick frame on Windows/Linux
    // Remove default title bar on all platforms
    titleBarStyle: 'hidden',
    // No titleBarOverlay - causes hit-test issues with DPI scaling
    titleBarOverlay: undefined,
    // Position traffic lights for macOS
    trafficLightPosition: isMac ? { x: 12, y: 16 } : undefined,
    backgroundColor: "#ffffff", // White background for titlebar
    webPreferences: {
      // Con Electron Forge + Vite, preload.js está en __dirname directamente
      preload: join(__dirname, "preload.js"),
      sandbox: true, // ✅ Enabled - renderer uses only Web APIs
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // Load the app
  // Electron Forge usa MAIN_WINDOW_VITE_DEV_SERVER_URL para dev
  // electron-vite usa ELECTRON_RENDERER_URL para dev

  // Debug: ver qué variables están disponibles
  logger.core.debug("Environment variables", {
    MAIN_WINDOW_VITE_DEV_SERVER_URL:
      process.env["MAIN_WINDOW_VITE_DEV_SERVER_URL"],
    ELECTRON_RENDERER_URL: process.env["ELECTRON_RENDERER_URL"],
    NODE_ENV: process.env.NODE_ENV,
    viteVars: Object.keys(process.env).filter((k) => k.includes("VITE")),
  });

  if (process.env["MAIN_WINDOW_VITE_DEV_SERVER_URL"]) {
    logger.core.info("Loading from Forge dev server", {
      url: process.env["MAIN_WINDOW_VITE_DEV_SERVER_URL"],
    });
    mainWindow.loadURL(process.env["MAIN_WINDOW_VITE_DEV_SERVER_URL"]);
  } else if (
    process.env.NODE_ENV === "development" &&
    process.env["ELECTRON_RENDERER_URL"]
  ) {
    logger.core.info("Loading from electron-vite dev server", {
      url: process.env["ELECTRON_RENDERER_URL"],
    });
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    // En producción con Forge: main está en .vite/build/main.js
    // y renderer está en .vite/renderer/main_window/index.html
    const filePath = join(__dirname, "../renderer/main_window/index.html");
    logger.core.info("Loading from file (production build)", { filePath });
    mainWindow.loadFile(filePath);
  }

  // Force light theme for window (affects titlebar on macOS)
  nativeTheme.themeSource = "light";

  // Listen for theme changes and update title bar overlay (Windows/Linux only)
  if (process.platform !== "darwin") {
    nativeTheme.on("updated", () => {
      const isDark = nativeTheme.shouldUseDarkColors;
      mainWindow.setTitleBarOverlay({
        color: isDark ? "#0f0f0f" : "#ffffff",
        symbolColor: isDark ? "#ffffff" : "#000000",
        height: 48
      });
      logger.core.debug("Title bar overlay updated", { isDark });
    });
  }

  // Lock zoom to prevent DPI-related hit-test issues on Windows
  // This mitigates render/hit-test misalignment with fractional DPI scaling (125%, 150%)
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {
    logger.core.debug("Could not set visual zoom limits (older Electron version?)");
  });
  mainWindow.webContents.setZoomFactor(1);

  // Show window when ready to prevent visual flash
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();

    if (process.env.NODE_ENV === "development") {
      mainWindow.webContents.openDevTools();

      // Note: Autofill DevTools errors are a known Electron issue and cannot be suppressed
      // See: https://github.com/electron/electron/issues/46868
    }
  });

  // Handle window closed
  mainWindow.on("closed", () => {
    // Window cleanup handled by Electron
  });

  // Security: Handle external links with protocol validation
  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Validate and open URL with protocol allowlist (http, https, mailto only)
    // Blocks file://, javascript:, and other dangerous protocols
    safeOpenExternal(details.url, "window-open-handler");
    return { action: "deny" };
  });

  // Security: Prevent navigation to external/malicious URLs
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const parsedUrl = new URL(url);

    // Allow navigation within the app
    const isDevServer = url.startsWith(process.env["MAIN_WINDOW_VITE_DEV_SERVER_URL"] || "");
    const isLocalhost = parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";
    const isAppFile = parsedUrl.protocol === "file:";

    if (isDevServer || (isLocalhost && process.env.NODE_ENV === "development") || isAppFile) {
      // Allow internal navigation
      logger.core.debug("Allowing internal navigation", {
        url: parsedUrl.host + parsedUrl.pathname,
        protocol: parsedUrl.protocol
      });
      return;
    }

    // Block and open externally
    event.preventDefault();
    logger.core.info("Blocked external navigation, opening in browser", {
      protocol: parsedUrl.protocol,
      host: parsedUrl.host
    });

    // Open in external browser with validation
    safeOpenExternal(url, "will-navigate");
  });

  return mainWindow;
}
