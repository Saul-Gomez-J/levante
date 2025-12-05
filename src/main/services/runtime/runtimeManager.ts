import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { RuntimeConfig, RuntimeInfo, RuntimeType } from '../../../types/runtime';
import { DEFAULT_NODE_VERSION, DEFAULT_PYTHON_VERSION, LEVANTE_DIR_NAME, RUNTIME_DIR_NAME, NODE_DIST_BASE_URL } from './constants';
import { analyticsService } from '../analytics/analyticsService';

const execAsync = promisify(exec);

export class RuntimeManager {
    private runtimesPath: string;
    private usagePath: string;

    constructor() {
        this.runtimesPath = path.join(app.getPath('home'), LEVANTE_DIR_NAME, RUNTIME_DIR_NAME);
        this.usagePath = path.join(this.runtimesPath, 'usage.json');
    }

    /**
     * Returns the base path where Levante runtimes are installed.
     */
    getRuntimesPath(): string {
        return this.runtimesPath;
    }

    /**
   * Ensures that the requested runtime is available.
   * Priority depends on developerMode and preferSystemRuntimes flags:
   *
   * Simple Mode (developerMode = false):
   * - Levante → System → Auto-install (silent)
   * - Prioritizes Levante for tracking and guaranteed compatibility
   *
   * Advanced Mode (developerMode = true):
   * - If preferSystemRuntimes: System → Levante → Prompt
   * - If !preferSystemRuntimes: Levante → System → Prompt
   *
   * If source is 'system', only checks system path (no installation).
   */
    async ensureRuntime(config: RuntimeConfig, preferSystemRuntimes = false, developerMode = false): Promise<string> {
        const { type, version, source = 'shared' } = config;

        // 1. If source is explicitly 'system', only look in system
        if (source === 'system') {
            const systemPath = await this.detectSystemRuntime(type, version);
            if (systemPath) {
                return systemPath;
            } else {
                throw new Error(`System runtime ${type} not found`);
            }
        }

        // 2. If source is 'shared' (default): Check preference based on mode

        if (!developerMode) {
            // SIMPLE MODE: Levante → System → Auto-install (silent)
            // Prioritizes Levante for tracking and guaranteed compatibility

            const levanteRuntime = this.findLevanteRuntime(type, version);
            if (levanteRuntime) {
                return levanteRuntime; // Use Levante runtime (trackeable)
            }

            try {
                return await this.installRuntime(type, version)
            } catch {
                const systemPath = await this.detectSystemRuntime(type, version);
                if (systemPath) {
                    return systemPath; // Fallback to system
                }
            }

            // Not found anywhere: install automatically WITHOUT prompting
            throw new Error("couldnt install the runtime");;

        } else {
            // ADVANCED MODE: Respects preferSystemRuntimes setting

            if (preferSystemRuntimes) {
                // User prefers System: System → Levante → Prompt
                const systemPath = await this.detectSystemRuntime(type, version);
                if (systemPath) {
                    return systemPath; // Use system (not tracked)
                }

                const levanteRuntime = this.findLevanteRuntime(type, version);
                if (levanteRuntime) {
                    return levanteRuntime; // Fallback to Levante
                }

                // Not found anywhere: throw error so UI can show confirmation dialog
                throw new Error('RUNTIME_NOT_FOUND');

            } else {
                // User prefers Levante: Check Levante first
                const levanteRuntime = this.findLevanteRuntime(type, version);
                if (levanteRuntime) {
                    return levanteRuntime; // Use Levante runtime (trackeable)
                }

                // Levante not found, check if exists in system
                const systemPath = await this.detectSystemRuntime(type, version);
                if (systemPath) {
                    // System exists but user prefers Levante
                    // Throw special error to prompt: "Download Levante runtime or use System?"
                    const error = new Error('RUNTIME_CHOICE_REQUIRED');
                    (error as any).systemPath = systemPath;
                    (error as any).runtimeType = type;
                    (error as any).runtimeVersion = version;
                    throw error;
                }

                // Not found anywhere: throw error so UI can show install dialog
                throw new Error('RUNTIME_NOT_FOUND');
            }
        }
    }

    /**
     * Finds an installed Levante runtime without triggering installation.
     */
    private findLevanteRuntime(type: RuntimeType, version: string): string | null {
        const runtimeDir = path.join(this.runtimesPath, type, version);

        if (!fs.existsSync(runtimeDir)) {
            return null;
        }

        if (type === 'node') {
            const binPath = process.platform === 'win32'
                ? path.join(runtimeDir, 'node.exe')
                : path.join(runtimeDir, 'bin', 'node');
            return fs.existsSync(binPath) ? binPath : null;
        } else {
            // Python (python-build-standalone layout)
            if (process.platform === 'win32') {
                const binPath = path.join(runtimeDir, 'python', 'python.exe');
                return fs.existsSync(binPath) ? binPath : null;
            } else {
                const binPath = path.join(runtimeDir, 'python', 'bin', 'python3');
                return fs.existsSync(binPath) ? binPath : null;
            }
        }
    }

    /**
   * Detects if a runtime is installed on the system.
   */
    async detectSystemRuntime(type: RuntimeType, version?: string): Promise<string | null> {
        try {
            const command = type === 'node' ? 'node' : (process.platform === 'win32' ? 'python' : 'python3');
            const versionFlag = type === 'node' ? '-v' : '--version';

            // Check if command exists and get version
            await execAsync(`${command} ${versionFlag}`);

            // Get path
            const whichCommand = process.platform === 'win32'
                ? `where ${command}`
                : `which ${command}`;

            const { stdout } = await execAsync(whichCommand);
            const systemPath = stdout.trim().split('\n')[0];

            if (systemPath) {
                return systemPath;
            }
        } catch (error) {
            // Not found or error
        }
        return null;
    }

    /**
     * Installs a runtime locally in the levante/runtimes directory.
     */
    async installRuntime(type: RuntimeType, version: string): Promise<string> {
        const runtimeDir = path.join(this.runtimesPath, type, version);

        // Check if already installed (Node only)
        if (type === 'node' && fs.existsSync(runtimeDir)) {
            const binCheck = process.platform === 'win32'
                ? path.join(runtimeDir, 'node.exe')
                : path.join(runtimeDir, 'bin', 'node');

            if (fs.existsSync(binCheck)) {
                return binCheck;
            }
        }

        // Ensure directory exists
        fs.mkdirSync(runtimeDir, { recursive: true });

        if (type === 'node') {
            const arch = process.arch; // 'x64', 'arm64'
            const isWindows = process.platform === 'win32';
            const extension = isWindows ? 'zip' : 'tar.gz';
            // Node.js uses 'win' not 'win32' in download URLs
            const platformName = isWindows ? 'win' : process.platform;
            const fileName = `node-v${version}-${platformName}-${arch}.${extension}`;
            const url = `${NODE_DIST_BASE_URL}/v${version}/${fileName}`;
            const downloadPath = path.join(runtimeDir, fileName);

            console.log(`Downloading Node.js from ${url}...`);

            // Download
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to download Node.js: ${response.statusText}`);
            if (!response.body) throw new Error('No response body');

            // @ts-ignore - fetch body is a ReadableStream (Node.js fetch vs web fetch types)
            await pipeline(response.body, createWriteStream(downloadPath));

            // Extract
            console.log(`Extracting Node.js to ${runtimeDir}...`);
            if (isWindows) {
                // Windows: Use PowerShell to extract zip
                const extractDir = path.join(runtimeDir, 'temp_extract');
                await execAsync(`powershell -Command "Expand-Archive -Path '${downloadPath}' -DestinationPath '${extractDir}' -Force"`);
                // Move contents from nested folder (node-vX.Y.Z-win-x64) to runtimeDir
                const nestedFolder = path.join(extractDir, `node-v${version}-${platformName}-${arch}`);
                await execAsync(`powershell -Command "Move-Item -Path '${nestedFolder}\\*' -Destination '${runtimeDir}' -Force"`);
                // Cleanup temp folder
                await execAsync(`powershell -Command "Remove-Item -Path '${extractDir}' -Recurse -Force"`);
            } else {
                await execAsync(`tar -xzf "${downloadPath}" -C "${runtimeDir}" --strip-components=1`);
            }

            // Cleanup
            fs.unlinkSync(downloadPath);

            const binPath = process.platform === 'win32'
                ? path.join(runtimeDir, 'node.exe') // Check this assumption for windows zip
                : path.join(runtimeDir, 'bin', 'node');

            // Track la instalación del runtime
            await analyticsService.trackRuntimeUsage(
                type,
                version,
                'shared',
                'installed'
            ).catch(() => { }); // Fire and forget

            return binPath;
        } else {
            // ============================
            // Python installation (standalone)
            // ============================
            const arch = process.arch; // 'x64', 'arm64'
            const platform = process.platform;

            const { url, archiveName } = this.getPythonDownloadInfo(version, platform, arch);
            const downloadPath = path.join(runtimeDir, archiveName);

            console.log(`Downloading Python from ${url}...`);

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to download Python: ${response.status} ${response.statusText}`);
            }
            if (!response.body) {
                throw new Error('No response body when downloading Python');
            }

            // Guardar el .tar.gz
            // @ts-ignore
            await pipeline(response.body, createWriteStream(downloadPath));

            console.log(`Extracting Python to ${runtimeDir}...`);

            // Los artefactos de python-build-standalone son .tar.gz en las tres plataformas
            // y contienen una carpeta raíz `python/`.
            await execAsync(`tar -xzf "${downloadPath}" -C "${runtimeDir}"`);

            // Limpieza
            fs.unlinkSync(downloadPath);

            // Ruta al ejecutable según plataforma
            const pythonBaseDir = path.join(runtimeDir, 'python');
            const pythonBin = platform === 'win32'
                ? path.join(pythonBaseDir, 'python.exe')
                : path.join(pythonBaseDir, 'bin', 'python3');

            if (!fs.existsSync(pythonBin)) {
                throw new Error(`Python binary not found at ${pythonBin}`);
            }

            // Track la instalación del runtime
            await analyticsService.trackRuntimeUsage(
                type,
                version,
                'shared',
                'installed'
            ).catch(() => { }); // Fire and forget

            return pythonBin;
        }
    }

    /**
     * Info de descarga de Python standalone (python-build-standalone).
     * Por simplicidad, soportamos solo 64-bit (x64 / arm64) y una versión concreta.
     */
    private getPythonDownloadInfo(
        version: string,
        platform: NodeJS.Platform,
        arch: NodeJS.Architecture
    ): { url: string; archiveName: string } {
        // De momento soportamos solo la rama 3.13.*
        if (!version.startsWith('3.13')) {
            console.warn(
                `[Levante] Solo se soporta instalación automática de Python 3.13.* por ahora. ` +
                `Has pedido "${version}", se usará un build standalone 3.13 igualmente.`
            );
        }

        // Ojo: estos nombres siguen el patrón de python-build-standalone para 3.13.
        // Si en el futuro cambian, solo habría que actualizar nombres/fecha aquí.
        // Usamos nombres con `+` para el archivo local, y los codificamos en la URL.

        if (platform === 'linux' && arch === 'x64') {
            const archiveName =
                'cpython-3.13.0+20241016-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz';
            const url =
                'https://github.com/indygreg/python-build-standalone/releases/download/20241016/' +
                encodeURIComponent(archiveName);
            return { url, archiveName };
        }

        if (platform === 'darwin' && arch === 'arm64') {
            const archiveName =
                'cpython-3.13.0+20241016-aarch64-apple-darwin-install_only_stripped.tar.gz';
            const url =
                'https://github.com/indygreg/python-build-standalone/releases/download/20241016/' +
                encodeURIComponent(archiveName);
            return { url, archiveName };
        }

        if (platform === 'win32' && arch === 'x64') {
            const archiveName =
                'cpython-3.13.0+20241016-x86_64-pc-windows-msvc-install_only_stripped.tar.gz';
            const url =
                'https://github.com/indygreg/python-build-standalone/releases/download/20241016/' +
                encodeURIComponent(archiveName);
            return { url, archiveName };
        }

        throw new Error(
            `Automatic Python installation not supported for platform=${platform} arch=${arch}`
        );
    }

    /**
     * Registers that a server is using a specific runtime.
     */
    async registerServerUsage(serverId: string, runtimeKey: string): Promise<void> {
        const usage = await this.loadUsage();

        if (!usage[runtimeKey]) {
            usage[runtimeKey] = [];
        }

        if (!usage[runtimeKey].includes(serverId)) {
            usage[runtimeKey].push(serverId);
            await this.saveUsage(usage);

            // Track el uso del runtime (solo primera vez)
            const [type, version] = runtimeKey.split('-');
            await analyticsService.trackRuntimeUsage(
                type as RuntimeType,
                version,
                'shared', // Solo trackeamos runtimes de Levante
                'used',
                serverId
            ).catch(() => { }); // Fire and forget
        }
    }

    /**
     * Returns a list of installed runtimes.
     */
    async getInstalledRuntimes(): Promise<RuntimeInfo[]> {
        const runtimes: RuntimeInfo[] = [];

        if (!fs.existsSync(this.runtimesPath)) {
            return [];
        }

        const usage = await this.loadUsage();

        const types = fs.readdirSync(this.runtimesPath);
        for (const type of types) {
            // Skip if not a directory or hidden
            if (type.startsWith('.') || type === 'usage.json' || type === 'uv') continue;

            const typePath = path.join(this.runtimesPath, type);
            if (!fs.statSync(typePath).isDirectory()) continue;

            const versions = fs.readdirSync(typePath);
            for (const version of versions) {
                if (version.startsWith('.')) continue;

                const versionPath = path.join(typePath, version);
                if (!fs.statSync(versionPath).isDirectory()) continue;

                const runtimeKey = `${type}-${version}`;
                const usedBy = usage[runtimeKey] || [];

                // Basic info
                runtimes.push({
                    type: type as RuntimeType,
                    version: version,
                    path: versionPath,
                    source: 'shared',
                    usedBy: usedBy,
                    size: 'Unknown' // TODO: Implement size calculation
                });
            }
        }

        return runtimes;
    }

    /**
     * Removes runtimes that are not being used by any server.
     */
    async cleanupUnusedRuntimes(): Promise<void> {
        if (!fs.existsSync(this.runtimesPath)) {
            return;
        }

        const usage = await this.loadUsage();

        const types = fs.readdirSync(this.runtimesPath);
        for (const type of types) {
            // Skip special directories
            if (type.startsWith('.') || type === 'usage.json' || type === 'uv') continue;

            const typePath = path.join(this.runtimesPath, type);
            if (!fs.statSync(typePath).isDirectory()) continue;

            const versions = fs.readdirSync(typePath);
            for (const version of versions) {
                if (version.startsWith('.')) continue;

                const versionPath = path.join(typePath, version);
                if (!fs.statSync(versionPath).isDirectory()) continue;

                const runtimeKey = `${type}-${version}`;
                const usedBy = usage[runtimeKey] || [];

                // If not used by any server, remove it
                if (usedBy.length === 0) {
                    console.log(`Removing unused runtime: ${runtimeKey} at ${versionPath}`);

                    // Remove directory recursively
                    try {
                        if (process.platform === 'win32') {
                            await execAsync(`rmdir /s /q "${versionPath}"`);
                        } else {
                            await execAsync(`rm -rf "${versionPath}"`);
                        }

                        // Remove from usage tracking
                        delete usage[runtimeKey];
                    } catch (error) {
                        console.error(`Failed to remove runtime ${runtimeKey}:`, error);
                    }
                }
            }
        }

        // Save updated usage
        await this.saveUsage(usage);
    }

    private async loadUsage(): Promise<Record<string, string[]>> {
        try {
            if (fs.existsSync(this.usagePath)) {
                const content = fs.readFileSync(this.usagePath, 'utf-8');
                return JSON.parse(content);
            }
        } catch (error) {
            console.error('Failed to load runtime usage:', error);
        }
        return {};
    }

    private async saveUsage(usage: Record<string, string[]>): Promise<void> {
        try {
            // Ensure runtimes directory exists
            if (!fs.existsSync(this.runtimesPath)) {
                fs.mkdirSync(this.runtimesPath, { recursive: true });
            }
            fs.writeFileSync(this.usagePath, JSON.stringify(usage, null, 2), 'utf-8');
        } catch (error) {
            console.error('Failed to save runtime usage:', error);
        }
    }
}
