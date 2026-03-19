import { app, dialog, nativeImage, autoUpdater } from 'electron';
import { join } from 'path';
import { getLogger } from './logging';

const logger = getLogger();

/**
 * Auto-update service for Levante
 *
 * macOS: uses update-electron-app + Electron's native autoUpdater
 * Windows: uses electron-updater (compatible with NSIS installer)
 */
class UpdateService {
  private repo = 'levante-hub/levante';
  private updateCheckInProgress = false;
  private appIcon: Electron.NativeImage | undefined;
  private autoUpdateInitialized = false;

  /**
   * Check if the current version is a pre-release (beta, alpha, rc)
   */
  private isBetaVersion(): boolean {
    const version = app.getVersion();
    return version.includes('-beta') || version.includes('-alpha') || version.includes('-rc');
  }

  /**
   * Compare two semver versions
   * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
   */
  private compareVersions(v1: string, v2: string): number {
    // Remove 'v' prefix if present
    const cleanV1 = v1.replace(/^v/, '');
    const cleanV2 = v2.replace(/^v/, '');

    // Split into parts: [major, minor, patch, prerelease]
    const parseVersion = (v: string) => {
      const match = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
      if (!match) return null;

      return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
        prerelease: match[4] || null
      };
    };

    const parsed1 = parseVersion(cleanV1);
    const parsed2 = parseVersion(cleanV2);

    if (!parsed1 || !parsed2) {
      logger.core.warn('Failed to parse versions for comparison', { v1, v2 });
      return 0;
    }

    // Compare major.minor.patch
    if (parsed1.major !== parsed2.major) return parsed1.major > parsed2.major ? 1 : -1;
    if (parsed1.minor !== parsed2.minor) return parsed1.minor > parsed2.minor ? 1 : -1;
    if (parsed1.patch !== parsed2.patch) return parsed1.patch > parsed2.patch ? 1 : -1;

    // If versions are equal in major.minor.patch, compare prerelease
    if (!parsed1.prerelease && !parsed2.prerelease) return 0; // Both stable, equal
    if (!parsed1.prerelease) return 1;  // v1 is stable, v2 is prerelease -> v1 is newer
    if (!parsed2.prerelease) return -1; // v2 is stable, v1 is prerelease -> v2 is newer

    // Both have prerelease, compare strings (beta.4 vs beta.5)
    return parsed1.prerelease.localeCompare(parsed2.prerelease);
  }

  /**
   * Get the app icon for dialogs
   */
  private getAppIcon(): Electron.NativeImage | undefined {
    if (!this.appIcon) {
      try {
        // In production (packaged app), icon is in resources
        // In development, icon is in project root
        const iconPath = app.isPackaged
          ? join(process.resourcesPath, 'icons', 'icon.png')
          : join(__dirname, '../../../resources/icons/icon.png');

        this.appIcon = nativeImage.createFromPath(iconPath);
        logger.core.debug('App icon loaded', { iconPath, isEmpty: this.appIcon.isEmpty() });
      } catch (error) {
        logger.core.warn('Failed to load app icon for dialogs', {
          error: error instanceof Error ? error.message : error
        });
      }
    }
    return this.appIcon;
  }

  /**
   * Initialize automatic updates (production only)
   * Sets up background update checks using update-electron-app (macOS)
   * or electron-updater (Windows NSIS).
   */
  initialize(): void {
    logger.core.info('Initializing auto-update system', {
      nodeEnv: process.env.NODE_ENV,
      isPackaged: app.isPackaged,
      platform: process.platform,
      version: app.getVersion()
    });

    if (process.env.NODE_ENV === 'production' || app.isPackaged) {
      try {
        if (process.platform === 'win32') {
          this.initializeWindowsUpdates();
        } else if (process.platform === 'darwin') {
          const isBeta = this.isBetaVersion();

          if (isBeta) {
            logger.core.info('Using beta auto-update path (autoUpdater API)');
            this.initializeBetaUpdates();
          } else {
            logger.core.info('Using stable auto-update path (update-electron-app)', {
              arch: process.arch,
              feedUrl: `https://update.electronjs.org/${this.repo}/darwin-${process.arch}/${app.getVersion()}`
            });
            const { updateElectronApp } = require('update-electron-app');
            updateElectronApp({
              repo: this.repo,
              updateInterval: '1 hour',
              notifyUser: true,
              logger: {
                log: (...args: any[]) => logger.core.info('Auto-update:', ...args),
                error: (...args: any[]) => logger.core.error('Auto-update error:', ...args)
              }
            });
          }
        }

        this.autoUpdateInitialized = true;
        logger.core.info('Auto-update system initialized successfully', {
          repo: this.repo,
          version: app.getVersion(),
          platform: process.platform
        });
      } catch (error) {
        logger.core.error('Failed to initialize auto-update', {
          error: error instanceof Error ? error.message : error,
          stack: error instanceof Error ? error.stack : undefined
        });
      }
    } else {
      logger.core.info('Auto-update disabled in development mode', {
        reason: 'Not in production and not packaged',
        nodeEnv: process.env.NODE_ENV,
        isPackaged: app.isPackaged
      });
    }
  }

  /**
   * Initialize Windows updates using electron-updater (compatible with NSIS installer).
   * Reads latest.yml from GitHub Releases.
   */
  private initializeWindowsUpdates(): void {
    const { autoUpdater: electronUpdater } = require('electron-updater');

    logger.core.info('Configuring Windows auto-update via electron-updater', {
      version: app.getVersion(),
      repo: this.repo
    });

    electronUpdater.setFeedURL({
      provider: 'github',
      owner: 'levante-hub',
      repo: 'levante',
      releaseType: this.isBetaVersion() ? 'prerelease' : 'release'
    });

    electronUpdater.logger = {
      info: (...args: any[]) => logger.core.info('electron-updater:', ...args),
      warn: (...args: any[]) => logger.core.warn('electron-updater:', ...args),
      error: (...args: any[]) => logger.core.error('electron-updater:', ...args),
      debug: (...args: any[]) => logger.core.debug('electron-updater:', ...args)
    };

    electronUpdater.on('update-downloaded', (info: any) => {
      logger.core.info('Windows update downloaded', { version: info.version });

      dialog.showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: 'A new version has been downloaded',
        detail: `Version ${info.version} is ready to install. The application will restart to apply the update.`,
        buttons: ['Restart Now', 'Later'],
        icon: this.getAppIcon()
      }).then((result) => {
        if (result.response === 0) {
          electronUpdater.quitAndInstall();
        }
      });
    });

    electronUpdater.on('error', (error: Error) => {
      logger.core.error('Windows auto-update error', {
        error: error instanceof Error ? error.message : String(error)
      });
    });

    // Check for updates every hour
    const checkInterval = 60 * 60 * 1000;
    setInterval(() => {
      electronUpdater.checkForUpdatesAndNotify();
    }, checkInterval);

    // Initial check
    electronUpdater.checkForUpdatesAndNotify();
  }

  /**
   * Initialize macOS beta version updates using autoUpdater directly.
   * This allows us to include pre-releases in the update feed.
   */
  private initializeBetaUpdates(): void {
    const { platform } = process;
    const version = app.getVersion();

    // Construct feed URL with pre-release support
    // Format: https://update.electronjs.org/:owner/:repo/:platform-:arch/:version
    const feedUrl = `https://update.electronjs.org/levante-hub/levante/${platform}-${process.arch}/${version}`;

    logger.core.info('Configuring beta auto-update', {
      version,
      platform: `${platform}-${process.arch}`,
      feedUrl
    });

    try {
      autoUpdater.setFeedURL({
        url: feedUrl,
        serverType: 'default'
      });

      autoUpdater.on('update-available', () => {
        logger.core.info('Beta update available, downloading...');
      });

      autoUpdater.on('update-downloaded', (_event, _releaseNotes, releaseName) => {
        logger.core.info('Beta update downloaded', { releaseName });

        dialog.showMessageBox({
          type: 'info',
          title: 'Update Ready',
          message: 'A new beta version has been downloaded',
          detail: `Version ${releaseName} is ready to install. The application will restart to apply the update.`,
          buttons: ['Restart Now', 'Later'],
          icon: this.getAppIcon()
        }).then((result) => {
          if (result.response === 0) {
            autoUpdater.quitAndInstall();
          }
        });
      });

      autoUpdater.on('error', (error) => {
        logger.core.error('Beta auto-update error', {
          error: error instanceof Error ? error.message : String(error)
        });
      });

      // Check for updates every hour
      const checkInterval = 60 * 60 * 1000;
      setInterval(() => {
        autoUpdater.checkForUpdates();
      }, checkInterval);

      // Initial check
      autoUpdater.checkForUpdates();

    } catch (error) {
      logger.core.error('Failed to initialize beta auto-update', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get latest release version from GitHub
   * Includes pre-releases if current version is beta
   */
  private async getLatestRemoteVersion(): Promise<string | null> {
    try {
      const isBeta = this.isBetaVersion();
      const url = `https://api.github.com/repos/${this.repo}/releases`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Levante-App'
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const releases = await response.json();

      // Filter releases based on version type
      const validReleases = releases.filter((release: any) => {
        if (isBeta) {
          return true;
        } else {
          return !release.prerelease;
        }
      });

      if (validReleases.length > 0) {
        return validReleases[0].tag_name;
      }

      return null;
    } catch (error) {
      logger.core.error('Failed to fetch latest version from GitHub', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Manually check for updates.
   * Uses electron-updater on Windows, native autoUpdater on macOS.
   */
  async checkForUpdates(): Promise<void> {
    if (this.updateCheckInProgress) {
      logger.core.info('Update check already in progress');
      return;
    }

    // In development mode, show message
    if (process.env.NODE_ENV !== 'production' && !app.isPackaged) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Updates Not Available',
        message: 'Auto-updates are only available in production builds',
        detail: 'You are running a development build. To test updates, create a production build using:\npnpm package',
        buttons: ['OK'],
        icon: this.getAppIcon()
      });
      return;
    }

    this.updateCheckInProgress = true;
    logger.core.info('Manual update check initiated', { platform: process.platform });

    try {
      if (!this.autoUpdateInitialized) {
        logger.core.warn('Update system not initialized, attempting to initialize');
        this.initialize();
      }

      if (process.platform === 'win32') {
        await this.checkForUpdatesWindows();
      } else {
        await this.checkForUpdatesMacOS();
      }
    } catch (error) {
      logger.core.error('Error initiating update check', {
        error: error instanceof Error ? error.message : error
      });

      await dialog.showMessageBox({
        type: 'error',
        title: 'Update Check Failed',
        message: 'An error occurred while checking for updates',
        detail: error instanceof Error ? error.message : 'Unknown error',
        buttons: ['OK'],
        icon: this.getAppIcon()
      });

      this.updateCheckInProgress = false;
    }
  }

  private async checkForUpdatesWindows(): Promise<void> {
    const { autoUpdater: electronUpdater } = require('electron-updater');

    return new Promise<void>((resolve) => {
      const cleanup = () => {
        electronUpdater.removeListener('update-not-available', notAvailableHandler);
        electronUpdater.removeListener('update-available', availableHandler);
        electronUpdater.removeListener('error', errorHandler);
        this.updateCheckInProgress = false;
        resolve();
      };

      const notAvailableHandler = () => {
        const currentVersion = app.getVersion();
        dialog.showMessageBox({
          type: 'info',
          title: 'No Updates Available',
          message: 'You are running the latest version',
          detail: `Current version: ${currentVersion}`,
          buttons: ['OK'],
          icon: this.getAppIcon()
        }).finally(cleanup);
      };

      const availableHandler = (info: any) => {
        logger.core.info('Windows update available', { version: info.version });
        // electron-updater will handle download + notify automatically
        cleanup();
      };

      const errorHandler = (error: Error) => {
        logger.core.error('Error checking for Windows updates', { error: error.message });
        dialog.showMessageBox({
          type: 'error',
          title: 'Update Check Failed',
          message: 'An error occurred while checking for updates',
          detail: error.message,
          buttons: ['OK'],
          icon: this.getAppIcon()
        }).finally(cleanup);
      };

      electronUpdater.once('update-not-available', notAvailableHandler);
      electronUpdater.once('update-available', availableHandler);
      electronUpdater.once('error', errorHandler);

      electronUpdater.checkForUpdates();
    });
  }

  private async checkForUpdatesMacOS(): Promise<void> {
    const feedUrl = `https://update.electronjs.org/levante-hub/levante/darwin-${process.arch}/${app.getVersion()}`;
    logger.core.info('Triggering manual update check via autoUpdater', {
      arch: process.arch,
      feedUrl
    });

    const updateNotAvailableHandler = async () => {
      const latestVersion = await this.getLatestRemoteVersion();
      const currentVersion = app.getVersion();
      const isBeta = this.isBetaVersion();

      let isUpToDate = true;
      let message = 'You are running the latest version';
      let title = 'No Updates Available';

      if (latestVersion) {
        const comparison = this.compareVersions(currentVersion, latestVersion);

        if (comparison < 0) {
          isUpToDate = false;
          message = 'A newer version is available but could not be installed';
          title = 'Update Available';

          logger.core.warn('Update available but autoUpdater reported not available', {
            currentVersion,
            latestVersion,
            comparison
          });
        }
      }

      let detail = `Current version: ${currentVersion}`;
      if (latestVersion) {
        detail += `\nLatest version checked: ${latestVersion}`;
        if (isBeta) {
          detail += '\n\n(Beta channel: checking for pre-releases)';
        }

        if (!isUpToDate) {
          detail += '\n\nThe update system detected a newer version but could not download it automatically. ';
          detail += 'Please download the latest version manually from:\nhttps://github.com/levante-hub/levante/releases';
        }
      }

      dialog.showMessageBox({
        type: isUpToDate ? 'info' : 'warning',
        title,
        message,
        detail,
        buttons: ['OK'],
        icon: this.getAppIcon()
      }).finally(() => {
        this.updateCheckInProgress = false;
        cleanup();
      });
    };

    const errorHandler = (error: Error) => {
      logger.core.error('Error checking for updates', { error: error.message });
      dialog.showMessageBox({
        type: 'error',
        title: 'Update Check Failed',
        message: 'An error occurred while checking for updates',
        detail: error.message,
        buttons: ['OK'],
        icon: this.getAppIcon()
      }).finally(() => {
        this.updateCheckInProgress = false;
        cleanup();
      });
    };

    const updateDownloadedHandler = () => {
      this.updateCheckInProgress = false;
      cleanup();
    };

    const cleanup = () => {
      autoUpdater.removeListener('update-not-available', updateNotAvailableHandler);
      autoUpdater.removeListener('error', errorHandler);
      autoUpdater.removeListener('update-downloaded', updateDownloadedHandler);
    };

    autoUpdater.once('update-not-available', updateNotAvailableHandler);
    autoUpdater.once('error', errorHandler);
    autoUpdater.once('update-downloaded', updateDownloadedHandler);

    autoUpdater.checkForUpdates();
  }
}

export const updateService = new UpdateService();
