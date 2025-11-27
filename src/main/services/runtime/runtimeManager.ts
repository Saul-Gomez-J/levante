import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { RuntimeConfig, RuntimeInfo, RuntimeType } from '../../../types/runtime';
import { DEFAULT_NODE_VERSION, DEFAULT_PYTHON_VERSION, LEVANTE_DIR_NAME, RUNTIME_DIR_NAME, NODE_DIST_BASE_URL } from './constants';

const execAsync = promisify(exec);

export class RuntimeManager {
    private runtimesPath: string;
    private usagePath: string;

    constructor() {
        this.runtimesPath = path.join(app.getPath('home'), LEVANTE_DIR_NAME, RUNTIME_DIR_NAME);
        this.usagePath = path.join(this.runtimesPath, 'usage.json');
    }

    /**
   * Ensures that the requested runtime is available.
   * If source is 'system', it checks system path.
   * If source is 'shared' (or system check fails), it checks local installation or installs it.
   */
    async ensureRuntime(config: RuntimeConfig): Promise<string> {
        const { type, version, source = 'shared' } = config;

        // 1. If source is 'system' or not specified, try to find it on system
        // Note: We might want to be stricter if source is explicitly 'system'
        if (source === 'system') {
            const systemPath = await this.detectSystemRuntime(type, version);
            if (systemPath) {
                return systemPath; // Return directory containing bin/node or just the executable? 
                // Usually we want the prefix path (e.g. /usr/local), but detectSystemRuntime returns executable path.
                // Let's normalize to return the executable path for now, or the prefix.
                // The PRD examples imply returning the path to the executable or the prefix?
                // "Returns: ~/levante/runtimes/node/current/bin/node" -> executable path.
                // My detectSystemRuntime returns executable path.
            } else {
                throw new Error(`System runtime ${type} not found`);
            }
        }

        // 2. If source is 'shared' (or fallback), check if we have it installed
        // For now, we default to 'shared' behavior if system is not explicitly requested?
        // PRD says: "Fallback inteligente: Intenta sistema primero, luego instala compartido"
        // So if source is NOT 'system' (meaning it's 'shared' or undefined), we should STILL check system first?
        // "System vs Levante priority? System first (default)"

        // So:
        const systemPath = await this.detectSystemRuntime(type, version);
        if (systemPath) {
            // TODO: Check version compatibility if needed
            return systemPath;
        }

        // 3. If not on system, install it
        return this.installRuntime(type, version);
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
            const platform = process.platform;
            const arch = process.arch; // 'x64', 'arm64'
            const extension = platform === 'win32' ? 'zip' : 'tar.gz';
            const fileName = `node-v${version}-${platform}-${arch}.${extension}`;
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
            if (extension === 'tar.gz') {
                await execAsync(`tar -xzf "${downloadPath}" -C "${runtimeDir}" --strip-components=1`);
            } else {
                // Windows zip extraction (simplified)
                // In a real app we might use a library or powershell
                throw new Error('Windows extraction not yet implemented');
            }

            // Cleanup
            fs.unlinkSync(downloadPath);

            const binPath = process.platform === 'win32'
                ? path.join(runtimeDir, 'node.exe') // Check this assumption for windows zip
                : path.join(runtimeDir, 'bin', 'node');

            return binPath;
        } else {
            // Python installation via uv
            // 1. Install uv if not present
            const uvPath = path.join(this.runtimesPath, 'uv');
            const uvBin = path.join(uvPath, 'bin', 'uv');

            if (!fs.existsSync(uvBin)) {
                console.log('Installing uv...');
                fs.mkdirSync(uvPath, { recursive: true });
                // Download uv installer script or binary
                // For simplicity, we'll assume we can download the binary directly from GitHub releases
                // But uv recommends using their installer script.
                // Let's use the standalone installer approach: `curl -LsSf https://astral.sh/uv/install.sh | sh`
                // But we want to install it to a specific directory.
                // `curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="/custom/path" sh`

                const installScriptUrl = 'https://astral.sh/uv/install.sh';
                const installScriptPath = path.join(uvPath, 'install.sh');

                const response = await fetch(installScriptUrl);
                if (!response.ok) throw new Error('Failed to download uv installer');
                // @ts-ignore
                await pipeline(response.body, createWriteStream(installScriptPath));

                await execAsync(`chmod +x "${installScriptPath}"`);
                await execAsync(`"${installScriptPath}"`, {
                    env: {
                        ...process.env,
                        UV_INSTALL_DIR: uvPath,
                        INSTALLER_NO_MODIFY_PATH: '1'
                    }
                });

                fs.unlinkSync(installScriptPath);
            }

            // 2. Use uv to install python
            console.log(`Installing Python ${version} with uv...`);
            // uv python install 3.13 --dir <runtimeDir> ??
            // uv manages python versions globally or in project.
            // We want a standalone python.
            // `uv python install 3.13` installs to uv's managed directory.
            // We can let uv manage it and just return the path `uv python find 3.13`

            await execAsync(`"${uvBin}" python install ${version}`);

            // Get the path
            const { stdout } = await execAsync(`"${uvBin}" python find ${version}`);
            const pythonPath = stdout.trim();

            return pythonPath; // Return the python executable path
        }
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
