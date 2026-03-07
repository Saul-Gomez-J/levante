/**
 * FileSystemService
 *
 * Read-only filesystem access for sidebar file tree.
 * Security: all paths are validated against working directory using realpath + relative.
 */

import fs from 'node:fs/promises';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { getLogger } from '../logging';

const logger = getLogger();

export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  extension: string;
  modifiedAt: number;
  isHidden: boolean;
}

export interface FileContent {
  path: string;
  content: string;
  encoding: string;
  size: number;
  language: string;
  isBinary: boolean;
  isTruncated: boolean;
}

export interface ReadDirOptions {
  showHidden?: boolean;
  sortBy?: 'name' | 'type' | 'modified';
}

export interface ReadFileOptions {
  maxSize?: number;
  encoding?: BufferEncoding;
}

const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp',
  'mp3', 'mp4', 'wav', 'avi', 'mov',
  'zip', 'tar', 'gz', 'rar', '7z',
  'exe', 'dll', 'so', 'dylib',
  'woff', 'woff2', 'ttf', 'eot',
  'sqlite', 'db',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
]);

const IGNORED_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', 'out',
  '.next', '.nuxt', '__pycache__', '.venv', 'venv',
  'env', '.tox', 'coverage', '.cache', '.turbo',
]);

const IGNORED_FILES = new Set([
  '.DS_Store', 'Thumbs.db', 'desktop.ini',
]);

const LANGUAGE_MAP: Record<string, string> = {
  // JavaScript/TypeScript
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  mjs: 'javascript',
  cjs: 'javascript',

  // Python
  py: 'python',
  pyw: 'python',
  pyi: 'python',

  // Web
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',

  // Data
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',

  // Markdown
  md: 'markdown',
  mdx: 'markdown',

  // Shell/config
  env: 'shell',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',

  // Other
  sql: 'sql',
  graphql: 'graphql',
  rs: 'rust',
  go: 'go',
  java: 'java',
  swift: 'swift',
  kt: 'kotlin',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  dockerfile: 'dockerfile',
};

class FileSystemService {
  private workingDirectory: string | null = null;

  setWorkingDirectory(dir: string): void {
    const resolved = path.resolve(dir);

    if (!existsSync(resolved)) {
      throw new Error('Working directory does not exist');
    }

    const real = realpathSync(resolved);
    const stats = statSync(real);

    if (!stats.isDirectory()) {
      throw new Error('Working directory must be a directory');
    }

    this.workingDirectory = real;
    logger.core.info('FileSystemService: working directory set', { dir: real });
  }

  getWorkingDirectory(): string | null {
    return this.workingDirectory;
  }

  async readDirectory(dirPath: string, options?: ReadDirOptions): Promise<DirectoryEntry[]> {
    const resolvedPath = this.validatePath(dirPath);
    const showHidden = options?.showHidden ?? false;
    const sortBy = options?.sortBy ?? 'type';

    const dirents = await fs.readdir(resolvedPath, { withFileTypes: true });
    const entries: DirectoryEntry[] = [];

    for (const dirent of dirents) {
      const isHidden = dirent.name.startsWith('.');
      if (isHidden && !showHidden) continue;

      const fullPath = path.join(resolvedPath, dirent.name);

      let stats: Awaited<ReturnType<typeof fs.lstat>>;
      try {
        stats = await fs.lstat(fullPath);
      } catch {
        continue;
      }

      const type: DirectoryEntry['type'] = stats.isSymbolicLink()
        ? 'symlink'
        : dirent.isDirectory()
          ? 'directory'
          : 'file';

      if (type === 'directory' && IGNORED_DIRECTORIES.has(dirent.name)) continue;
      if (type === 'file' && IGNORED_FILES.has(dirent.name)) continue;

      const extension = type === 'directory' ? '' : path.extname(dirent.name).slice(1).toLowerCase();

      entries.push({
        name: dirent.name,
        path: fullPath,
        type,
        size: stats.size,
        extension,
        modifiedAt: stats.mtimeMs,
        isHidden,
      });
    }

    entries.sort((a, b) => {
      if (sortBy === 'type') {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      }

      if (sortBy === 'modified') {
        return b.modifiedAt - a.modifiedAt;
      }

      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return entries;
  }

  async readFile(filePath: string, options?: ReadFileOptions): Promise<FileContent> {
    const resolvedPath = this.validatePath(filePath);
    const maxSize = options?.maxSize ?? MAX_FILE_SIZE;
    const encoding = options?.encoding ?? 'utf-8';

    const extension = path.extname(resolvedPath).slice(1).toLowerCase();
    const basename = path.basename(resolvedPath).toLowerCase();
    const isBinary = this.isBinaryFile(extension, basename);

    const stats = await fs.stat(resolvedPath);

    if (isBinary) {
      return {
        path: resolvedPath,
        content: '',
        encoding,
        size: stats.size,
        language: this.detectLanguage(extension, basename),
        isBinary: true,
        isTruncated: false,
      };
    }

    const isTruncated = stats.size > maxSize;
    let content: string;

    if (isTruncated) {
      const fileHandle = await fs.open(resolvedPath, 'r');
      try {
        const buffer = Buffer.alloc(maxSize);
        const { bytesRead } = await fileHandle.read(buffer, 0, maxSize, 0);
        content = buffer.subarray(0, bytesRead).toString(encoding);
      } finally {
        await fileHandle.close();
      }
    } else {
      content = await fs.readFile(resolvedPath, { encoding });
    }

    return {
      path: resolvedPath,
      content,
      encoding,
      size: stats.size,
      language: this.detectLanguage(extension, basename),
      isBinary: false,
      isTruncated,
    };
  }

  private validatePath(requestedPath: string): string {
    if (!this.workingDirectory) {
      throw new Error('No working directory configured');
    }

    const candidate = realpathSync(path.resolve(requestedPath));
    const relative = path.relative(this.workingDirectory, candidate);

    const isInside =
      relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));

    if (!isInside) {
      throw new Error('Access denied: path outside working directory');
    }

    return candidate;
  }

  private detectLanguage(extension: string, basename: string): string {
    if (basename === 'dockerfile') return 'dockerfile';
    if (basename === '.gitignore' || basename === '.env' || basename.startsWith('.env.')) return 'shell';

    return LANGUAGE_MAP[extension] ?? 'plaintext';
  }

  private isBinaryFile(extension: string, basename: string): boolean {
    if (basename === 'dockerfile' || basename === '.gitignore' || basename.startsWith('.env')) {
      return false;
    }

    return BINARY_EXTENSIONS.has(extension);
  }
}

export const fileSystemService = new FileSystemService();
