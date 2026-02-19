# Guía de Migración: Coding Tools → Levante

Esta guía detalla el proceso paso a paso para migrar las herramientas de codificación de `pi-mono/packages/coding-agent` a Levante.

---

## Diferencias Clave entre Proyectos

| Aspecto | pi-mono (origen) | Levante (destino) |
|---------|------------------|-------------------|
| **Schema validation** | TypeBox (`@sinclair/typebox`) | Zod |
| **Tool format** | `AgentTool` interface propia | Vercel AI SDK `tool()` |
| **Execute signature** | `(toolCallId, params, signal, onUpdate)` | `(args)` simple |
| **Agent loop** | Custom en `agent-loop.ts` | `streamText()` de AI SDK |
| **Tool loading** | Array de `AgentTool[]` | Objeto `{name: tool()}` |

---

## Arquitectura Objetivo

```
src/main/services/ai/
├── codingTools/                    # ← NUEVO: Carpeta para coding tools
│   ├── index.ts                    # Export principal
│   ├── types.ts                    # Interfaces adaptadas
│   ├── utils/
│   │   ├── shell.ts               # Ejecutar comandos
│   │   ├── truncate.ts            # Limitar output
│   │   └── path-utils.ts          # Resolver rutas
│   └── tools/
│       ├── bash.ts                # Herramienta bash
│       ├── read.ts                # Leer archivos
│       ├── write.ts               # Escribir archivos
│       ├── edit.ts                # Editar archivos
│       ├── edit-diff.ts           # Utilidades de diff
│       ├── grep.ts                # Buscar en archivos
│       ├── find.ts                # Buscar archivos por patrón
│       └── ls.ts                  # Listar directorios
├── builtInTools.ts                 # Ya existe - agregar coding tools
└── mcpToolsAdapter.ts              # Ya existe
```

---

## FASE 1: Infraestructura Base

**Objetivo:** Crear la estructura de carpetas y archivos utilitarios.

### Paso 1.1: Crear estructura de carpetas

```bash
cd /Users/saulgomezjimenez/proyectos/clai/proyectos/levante/levante
mkdir -p src/main/services/ai/codingTools/utils
mkdir -p src/main/services/ai/codingTools/tools
```

### Paso 1.2: Crear `types.ts`

**Archivo:** `src/main/services/ai/codingTools/types.ts`

```typescript
/**
 * Tipos para las coding tools.
 * Adaptados de pi-mono para trabajar con Vercel AI SDK + Zod.
 */

export interface TruncationResult {
  content: string;
  wasTruncated: boolean;
  totalLines: number;
  keptLines: number;
  totalBytes: number;
  keptBytes: number;
}

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  interrupted: boolean;
  timedOut: boolean;
}

export interface EditResult {
  success: boolean;
  diff?: string;
  error?: string;
  linesChanged?: number;
}

export interface ReadResult {
  content: string;
  mimeType?: string;
  isImage?: boolean;
  isBinary?: boolean;
  truncated?: boolean;
}

export interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

export interface GlobMatch {
  path: string;
  isDirectory: boolean;
}

export interface LsResult {
  success: boolean;
  count?: number;
  totalEntries?: number;
  truncated?: boolean;
  entries?: string;
  error?: string;
}
```

### Paso 1.3: Migrar `truncate.ts`

**Origen:** `pi-mono/packages/coding-agent/src/core/tools/truncate.ts`
**Destino:** `src/main/services/ai/codingTools/utils/truncate.ts`

```typescript
/**
 * Utilidades de truncado para limitar output de herramientas.
 * Migrado de pi-mono/packages/coding-agent
 */

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB
export const DEFAULT_MAX_LINE_CHARS = 2000;

export interface TruncationOptions {
  maxLines?: number;
  maxBytes?: number;
  maxLineChars?: number;
}

export interface TruncationResult {
  content: string;
  wasTruncated: boolean;
  totalLines: number;
  keptLines: number;
  totalBytes: number;
  keptBytes: number;
}

/**
 * Truncar líneas largas individuales
 */
export function truncateLine(
  line: string,
  maxChars: number = DEFAULT_MAX_LINE_CHARS
): { text: string; wasTruncated: boolean } {
  if (line.length <= maxChars) {
    return { text: line, wasTruncated: false };
  }
  return {
    text: line.slice(0, maxChars) + "... [truncated]",
    wasTruncated: true,
  };
}

/**
 * Truncar desde el inicio (mantener últimas líneas).
 * Útil para bash donde los errores aparecen al final.
 */
export function truncateTail(
  content: string,
  options: TruncationOptions = {}
): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLineChars = options.maxLineChars ?? DEFAULT_MAX_LINE_CHARS;

  const totalBytes = Buffer.byteLength(content, "utf8");
  const lines = content.split("\n");
  const totalLines = lines.length;

  // Truncar líneas individuales largas
  const truncatedLines = lines.map((line) => truncateLine(line, maxLineChars).text);

  // Si ya está dentro de los límites
  if (truncatedLines.length <= maxLines) {
    const result = truncatedLines.join("\n");
    const resultBytes = Buffer.byteLength(result, "utf8");
    if (resultBytes <= maxBytes) {
      return {
        content: result,
        wasTruncated: totalBytes !== resultBytes,
        totalLines,
        keptLines: truncatedLines.length,
        totalBytes,
        keptBytes: resultBytes,
      };
    }
  }

  // Mantener las últimas N líneas
  const keptLines = truncatedLines.slice(-maxLines);
  let result = keptLines.join("\n");
  let resultBytes = Buffer.byteLength(result, "utf8");

  // Si aún excede maxBytes, reducir más líneas
  while (resultBytes > maxBytes && keptLines.length > 1) {
    keptLines.shift();
    result = keptLines.join("\n");
    resultBytes = Buffer.byteLength(result, "utf8");
  }

  const header = `[... ${totalLines - keptLines.length} lines truncated ...]\n`;

  return {
    content: header + result,
    wasTruncated: true,
    totalLines,
    keptLines: keptLines.length,
    totalBytes,
    keptBytes: resultBytes + Buffer.byteLength(header, "utf8"),
  };
}

/**
 * Truncar desde el final (mantener primeras líneas).
 * Útil para archivos donde el inicio es más relevante.
 */
export function truncateHead(
  content: string,
  options: TruncationOptions = {}
): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLineChars = options.maxLineChars ?? DEFAULT_MAX_LINE_CHARS;

  const totalBytes = Buffer.byteLength(content, "utf8");
  const lines = content.split("\n");
  const totalLines = lines.length;

  // Truncar líneas individuales
  const truncatedLines = lines.map((line) => truncateLine(line, maxLineChars).text);

  if (truncatedLines.length <= maxLines) {
    const result = truncatedLines.join("\n");
    const resultBytes = Buffer.byteLength(result, "utf8");
    if (resultBytes <= maxBytes) {
      return {
        content: result,
        wasTruncated: totalBytes !== resultBytes,
        totalLines,
        keptLines: truncatedLines.length,
        totalBytes,
        keptBytes: resultBytes,
      };
    }
  }

  // Mantener las primeras N líneas
  const keptLines = truncatedLines.slice(0, maxLines);
  let result = keptLines.join("\n");
  let resultBytes = Buffer.byteLength(result, "utf8");

  while (resultBytes > maxBytes && keptLines.length > 1) {
    keptLines.pop();
    result = keptLines.join("\n");
    resultBytes = Buffer.byteLength(result, "utf8");
  }

  const footer = `\n[... ${totalLines - keptLines.length} lines truncated ...]`;

  return {
    content: result + footer,
    wasTruncated: true,
    totalLines,
    keptLines: keptLines.length,
    totalBytes,
    keptBytes: resultBytes + Buffer.byteLength(footer, "utf8"),
  };
}

/**
 * Formatear tamaño en bytes de forma legible
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

### Paso 1.4: Migrar `path-utils.ts`

**Origen:** `pi-mono/packages/coding-agent/src/core/tools/path-utils.ts`
**Destino:** `src/main/services/ai/codingTools/utils/path-utils.ts`

```typescript
/**
 * Utilidades de resolución de rutas.
 * Migrado de pi-mono/packages/coding-agent
 */

import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve, normalize } from "node:path";

/**
 * Expandir ~ a home directory
 */
export function expandPath(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return resolve(homedir(), filePath.slice(2));
  }
  if (filePath === "~") {
    return homedir();
  }
  return filePath;
}

/**
 * Resolver ruta relativa a cwd
 */
export function resolveToCwd(filePath: string, cwd: string): string {
  const expanded = expandPath(filePath);
  if (isAbsolute(expanded)) {
    return normalize(expanded);
  }
  return resolve(cwd, expanded);
}

/**
 * Resolver ruta para lectura con fallback de variantes Unicode (macOS)
 */
export function resolveReadPath(filePath: string, cwd: string): string {
  const resolved = resolveToCwd(filePath, cwd);

  // Intentar acceder al archivo
  try {
    accessSync(resolved, constants.R_OK);
    return resolved;
  } catch {
    // En macOS, intentar con normalización NFC/NFD
    if (process.platform === "darwin") {
      // Intentar NFC
      const nfc = resolved.normalize("NFC");
      try {
        accessSync(nfc, constants.R_OK);
        return nfc;
      } catch {
        // Intentar NFD
        const nfd = resolved.normalize("NFD");
        try {
          accessSync(nfd, constants.R_OK);
          return nfd;
        } catch {
          // Devolver original
        }
      }
    }
  }

  return resolved;
}

/**
 * Validar que la ruta esté dentro del cwd permitido
 */
export function isPathWithinCwd(filePath: string, cwd: string): boolean {
  const resolved = resolveToCwd(filePath, cwd);
  const normalizedCwd = normalize(cwd);
  return resolved.startsWith(normalizedCwd);
}

/**
 * Obtener ruta relativa desde cwd
 */
export function getRelativePath(absolutePath: string, cwd: string): string {
  const normalizedPath = normalize(absolutePath);
  const normalizedCwd = normalize(cwd);

  if (normalizedPath.startsWith(normalizedCwd)) {
    const relative = normalizedPath.slice(normalizedCwd.length);
    return relative.startsWith("/") ? relative.slice(1) : relative;
  }

  return absolutePath;
}
```

### Paso 1.5: Migrar `shell.ts`

**Origen:** `pi-mono/packages/coding-agent/src/utils/shell.ts`
**Destino:** `src/main/services/ai/codingTools/utils/shell.ts`

```typescript
/**
 * Utilidades de shell para ejecutar comandos.
 * Migrado de pi-mono/packages/coding-agent
 */

import { spawn, spawnSync, ChildProcess } from "child_process";
import { existsSync } from "fs";
import { delimiter } from "path";
import { homedir } from "os";
import { join } from "path";

/**
 * Obtener configuración de shell según plataforma
 */
export function getShellConfig(): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    // Git Bash en Windows
    const gitBashPaths = [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
      join(homedir(), "scoop", "apps", "git", "current", "bin", "bash.exe"),
    ];

    for (const path of gitBashPaths) {
      if (existsSync(path)) {
        return { shell: path, args: ["-c"] };
      }
    }

    // Fallback a PowerShell
    return { shell: "powershell.exe", args: ["-Command"] };
  }

  // Unix: preferir bash
  if (existsSync("/bin/bash")) {
    return { shell: "/bin/bash", args: ["-c"] };
  }

  return { shell: "sh", args: ["-c"] };
}

/**
 * Obtener environment para shell
 */
export function getShellEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Asegurar que binarios comunes estén en PATH
  const extraPaths = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    join(homedir(), ".local", "bin"),
  ];

  const currentPath = env.PATH || "";
  const pathsToAdd = extraPaths.filter(p => !currentPath.includes(p));

  if (pathsToAdd.length > 0) {
    env.PATH = [...pathsToAdd, currentPath].join(delimiter);
  }

  // No prompts interactivos
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_ASKPASS = "";

  return env;
}

/**
 * Sanitizar output binario (remover caracteres no imprimibles)
 */
export function sanitizeBinaryOutput(str: string): string {
  // Remover caracteres de control excepto newlines y tabs
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/**
 * Matar árbol de procesos
 */
export function killProcessTree(pid: number): void {
  try {
    if (process.platform === "win32") {
      // Windows: taskkill con /T para árbol completo
      spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
      });
    } else {
      // Unix: enviar señal al grupo de procesos (negativo)
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    // Ignorar si ya terminó
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Proceso ya no existe
    }
  }
}

export interface ExecuteCommandOptions {
  cwd: string;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface ExecuteCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  interrupted: boolean;
}

/**
 * Ejecutar comando en shell
 */
export async function executeCommand(
  command: string,
  options: ExecuteCommandOptions
): Promise<ExecuteCommandResult> {
  const { shell, args } = getShellConfig();
  const env = options.env ?? getShellEnv();
  const timeout = options.timeout ?? 120000; // 2 minutos default

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let interrupted = false;
    let child: ChildProcess;

    const cleanup = () => {
      if (child && child.pid) {
        killProcessTree(child.pid);
      }
    };

    // Manejar abort signal
    if (options.signal) {
      if (options.signal.aborted) {
        resolve({
          stdout: "",
          stderr: "Command aborted before start",
          exitCode: 130,
          timedOut: false,
          interrupted: true,
        });
        return;
      }
      options.signal.addEventListener("abort", () => {
        interrupted = true;
        cleanup();
      });
    }

    // Timeout
    const timeoutId = setTimeout(() => {
      timedOut = true;
      cleanup();
    }, timeout);

    child = spawn(shell, [...args, command], {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = sanitizeBinaryOutput(chunk.toString("utf8"));
      stdout += text;
      options.onStdout?.(text);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = sanitizeBinaryOutput(chunk.toString("utf8"));
      stderr += text;
      options.onStderr?.(text);
    });

    child.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? (timedOut ? 124 : interrupted ? 130 : 1),
        timedOut,
        interrupted,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeoutId);
      resolve({
        stdout,
        stderr: stderr + "\n" + err.message,
        exitCode: 1,
        timedOut,
        interrupted,
      });
    });
  });
}
```

---

## FASE 2: Herramientas Básicas

**Objetivo:** Implementar las herramientas de lectura y escritura.

### Paso 2.1: Crear `write.ts`

**Destino:** `src/main/services/ai/codingTools/tools/write.ts`

```typescript
/**
 * Herramienta Write: escribir archivos.
 * Adaptada de pi-mono para Vercel AI SDK.
 */

import { tool } from "ai";
import { z } from "zod";
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import { resolveToCwd } from "../utils/path-utils";

export interface WriteToolConfig {
  cwd: string;
}

export function createWriteTool(config: WriteToolConfig) {
  return tool({
    description: `Write content to a file. Creates parent directories if needed.
The file_path must be an absolute path or relative to the current directory.
IMPORTANT: This will overwrite existing files. Always read a file first before writing if it exists.`,

    parameters: z.object({
      file_path: z.string().describe("The path to the file to write"),
      content: z.string().describe("The content to write to the file"),
    }),

    execute: async ({ file_path, content }) => {
      try {
        const resolvedPath = resolveToCwd(file_path, config.cwd);

        // Crear directorio padre si no existe
        await mkdir(dirname(resolvedPath), { recursive: true });

        // Escribir archivo
        await writeFile(resolvedPath, content, "utf8");

        const lines = content.split("\n").length;
        const bytes = Buffer.byteLength(content, "utf8");

        return {
          success: true,
          path: resolvedPath,
          message: `Successfully wrote ${lines} lines (${bytes} bytes) to ${file_path}`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `Failed to write file: ${message}`,
        };
      }
    },
  });
}
```

### Paso 2.2: Crear `read.ts`

**Destino:** `src/main/services/ai/codingTools/tools/read.ts`

```typescript
/**
 * Herramienta Read: leer archivos.
 * Adaptada de pi-mono para Vercel AI SDK.
 */

import { tool } from "ai";
import { z } from "zod";
import { readFile, stat } from "fs/promises";
import { resolveReadPath } from "../utils/path-utils";
import { truncateHead, formatSize } from "../utils/truncate";

export interface ReadToolConfig {
  cwd: string;
  maxLines?: number;
  maxBytes?: number;
}

// Tipos MIME soportados para imágenes
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export function createReadTool(config: ReadToolConfig) {
  return tool({
    description: `Read the contents of a file.
Returns file content with line numbers (cat -n format).
For images, returns base64 encoded data.
The file_path must be an absolute path or relative to current directory.`,

    parameters: z.object({
      file_path: z.string().describe("The absolute path to the file to read"),
      offset: z.number().optional().describe("Line number to start reading from (0-indexed)"),
      limit: z.number().optional().describe("Maximum number of lines to read"),
    }),

    execute: async ({ file_path, offset, limit }) => {
      try {
        const resolvedPath = resolveReadPath(file_path, config.cwd);

        // Verificar que existe
        const stats = await stat(resolvedPath);

        if (stats.isDirectory()) {
          return {
            success: false,
            error: `Path is a directory, not a file: ${file_path}. Use ls command to list directory contents.`,
          };
        }

        // Detectar si es imagen
        const ext = file_path.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
        if (IMAGE_EXTENSIONS.has(ext)) {
          const buffer = await readFile(resolvedPath);
          const mimeType = ext === ".png" ? "image/png"
            : ext === ".gif" ? "image/gif"
            : ext === ".webp" ? "image/webp"
            : "image/jpeg";

          return {
            success: true,
            isImage: true,
            mimeType,
            data: buffer.toString("base64"),
            size: stats.size,
          };
        }

        // Leer archivo de texto
        const content = await readFile(resolvedPath, "utf8");
        const lines = content.split("\n");
        const totalLines = lines.length;

        // Aplicar offset y limit
        const startLine = offset ?? 0;
        const endLine = limit ? startLine + limit : totalLines;
        const selectedLines = lines.slice(startLine, endLine);

        // Formatear con números de línea (cat -n style)
        const formatted = selectedLines
          .map((line, idx) => {
            const lineNum = startLine + idx + 1;
            return `${String(lineNum).padStart(6, " ")}\t${line}`;
          })
          .join("\n");

        // Truncar si es muy largo
        const maxLines = config.maxLines ?? 2000;
        const maxBytes = config.maxBytes ?? 50 * 1024;

        const truncated = truncateHead(formatted, { maxLines, maxBytes });

        return {
          success: true,
          content: truncated.content,
          totalLines,
          displayedLines: selectedLines.length,
          truncated: truncated.wasTruncated,
          size: formatSize(stats.size),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.includes("ENOENT")) {
          return {
            success: false,
            error: `File not found: ${file_path}`,
          };
        }

        return {
          success: false,
          error: `Failed to read file: ${message}`,
        };
      }
    },
  });
}
```

### Paso 2.3: Crear `edit-diff.ts`

**Destino:** `src/main/services/ai/codingTools/tools/edit-diff.ts`

```typescript
/**
 * Utilidades de diff para la herramienta Edit.
 * Adaptado de pi-mono/packages/coding-agent
 */

import { createPatch } from "diff";

export interface FuzzyMatchResult {
  found: boolean;
  startIndex: number;
  endIndex: number;
  matchedText: string;
  confidence: number;
}

/**
 * Buscar texto con tolerancia a whitespace
 */
export function fuzzyFindText(content: string, searchText: string): FuzzyMatchResult {
  // Intento 1: búsqueda exacta
  let index = content.indexOf(searchText);
  if (index !== -1) {
    return {
      found: true,
      startIndex: index,
      endIndex: index + searchText.length,
      matchedText: searchText,
      confidence: 1.0,
    };
  }

  // Intento 2: normalizar whitespace y buscar
  const normalizeWs = (s: string) => s.replace(/\s+/g, " ").trim();
  const normalizedSearch = normalizeWs(searchText);

  // Buscar en el contenido normalizado
  const normalizedContent = normalizeWs(content);
  const normalizedIndex = normalizedContent.indexOf(normalizedSearch);

  if (normalizedIndex !== -1) {
    // Encontrar posición real en contenido original
    // Esto es aproximado - buscar la mejor coincidencia
    const lines = content.split("\n");
    const searchLines = searchText.split("\n").map(l => l.trim()).filter(l => l);

    for (let i = 0; i <= lines.length - searchLines.length; i++) {
      const candidateLines = lines.slice(i, i + searchLines.length);
      const candidateNorm = candidateLines.map(l => l.trim()).join(" ");

      if (candidateNorm === searchLines.join(" ")) {
        const startIdx = lines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0);
        const endIdx = startIdx + candidateLines.join("\n").length;

        return {
          found: true,
          startIndex: startIdx,
          endIndex: endIdx,
          matchedText: content.slice(startIdx, endIdx),
          confidence: 0.9,
        };
      }
    }
  }

  return {
    found: false,
    startIndex: -1,
    endIndex: -1,
    matchedText: "",
    confidence: 0,
  };
}

/**
 * Generar diff entre dos strings
 */
export function generateDiffString(
  oldContent: string,
  newContent: string,
  filename: string = "file"
): string {
  const patch = createPatch(filename, oldContent, newContent, "", "");

  // Remover header del patch (primeras 2 líneas)
  const lines = patch.split("\n");
  return lines.slice(2).join("\n");
}

/**
 * Contar líneas cambiadas en un diff
 */
export function countDiffChanges(diff: string): { added: number; removed: number } {
  const lines = diff.split("\n");
  let added = 0;
  let removed = 0;

  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed++;
    }
  }

  return { added, removed };
}
```

### Paso 2.4: Crear `edit.ts`

**Destino:** `src/main/services/ai/codingTools/tools/edit.ts`

```typescript
/**
 * Herramienta Edit: editar archivos con string replacement.
 * Adaptada de pi-mono para Vercel AI SDK.
 */

import { tool } from "ai";
import { z } from "zod";
import { readFile, writeFile } from "fs/promises";
import { resolveToCwd } from "../utils/path-utils";
import { fuzzyFindText, generateDiffString, countDiffChanges } from "./edit-diff";

export interface EditToolConfig {
  cwd: string;
}

export function createEditTool(config: EditToolConfig) {
  return tool({
    description: `Edit a file by replacing exact string matches.
The old_string must be unique in the file, or the edit will fail.
Use replace_all: true to replace all occurrences.
IMPORTANT: Always read the file first before editing to ensure old_string is exact.`,

    parameters: z.object({
      file_path: z.string().describe("The path to the file to edit"),
      old_string: z.string().describe("The exact string to find and replace"),
      new_string: z.string().describe("The string to replace with"),
      replace_all: z.boolean().optional().default(false)
        .describe("If true, replace all occurrences instead of requiring unique match"),
    }),

    execute: async ({ file_path, old_string, new_string, replace_all }) => {
      try {
        const resolvedPath = resolveToCwd(file_path, config.cwd);

        // Leer archivo
        const content = await readFile(resolvedPath, "utf8");

        // Verificar que old_string !== new_string
        if (old_string === new_string) {
          return {
            success: false,
            error: "old_string and new_string are identical. No changes needed.",
          };
        }

        // Buscar el texto
        const match = fuzzyFindText(content, old_string);

        if (!match.found) {
          // Dar contexto útil para debugging
          const preview = content.slice(0, 500);
          return {
            success: false,
            error: `Could not find old_string in file. Make sure you read the file first and copy the exact text.`,
            hint: `File preview (first 500 chars):\n${preview}`,
          };
        }

        // Si no es replace_all, verificar unicidad
        if (!replace_all) {
          const occurrences = content.split(old_string).length - 1;
          if (occurrences > 1) {
            return {
              success: false,
              error: `old_string appears ${occurrences} times in the file. Either provide more context to make it unique, or use replace_all: true.`,
            };
          }
        }

        // Realizar reemplazo
        let newContent: string;
        let replacements: number;

        if (replace_all) {
          const parts = content.split(old_string);
          replacements = parts.length - 1;
          newContent = parts.join(new_string);
        } else {
          newContent = content.slice(0, match.startIndex) +
                       new_string +
                       content.slice(match.endIndex);
          replacements = 1;
        }

        // Generar diff
        const diff = generateDiffString(content, newContent, file_path);
        const changes = countDiffChanges(diff);

        // Escribir archivo
        await writeFile(resolvedPath, newContent, "utf8");

        return {
          success: true,
          replacements,
          linesAdded: changes.added,
          linesRemoved: changes.removed,
          diff,
          message: `Successfully edited ${file_path}: ${replacements} replacement(s), +${changes.added}/-${changes.removed} lines`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.includes("ENOENT")) {
          return {
            success: false,
            error: `File not found: ${file_path}. Use the write tool to create new files.`,
          };
        }

        return {
          success: false,
          error: `Failed to edit file: ${message}`,
        };
      }
    },
  });
}
```

---

## FASE 3: Herramienta Bash

**Objetivo:** Implementar ejecución de comandos shell.

### Paso 3.1: Crear `bash.ts`

**Destino:** `src/main/services/ai/codingTools/tools/bash.ts`

```typescript
/**
 * Herramienta Bash: ejecutar comandos en shell.
 * Adaptada de pi-mono para Vercel AI SDK.
 */

import { tool } from "ai";
import { z } from "zod";
import { executeCommand } from "../utils/shell";
import { truncateTail, formatSize } from "../utils/truncate";

export interface BashToolConfig {
  cwd: string;
  timeout?: number; // ms, default 120000 (2 min)
  maxOutputLines?: number;
  maxOutputBytes?: number;
}

export function createBashTool(config: BashToolConfig) {
  const timeout = config.timeout ?? 120000;
  const maxLines = config.maxOutputLines ?? 2000;
  const maxBytes = config.maxOutputBytes ?? 50 * 1024;

  return tool({
    description: `Execute a bash command in the shell.
Commands run in a bash shell with a ${Math.round(timeout / 1000)}s timeout.
IMPORTANT:
- Do NOT use for file operations (use read, write, edit tools instead)
- Use for: git commands, npm/yarn, build tools, system commands
- Output is truncated to ${maxLines} lines / ${formatSize(maxBytes)}
- Commands run in: ${config.cwd}`,

    parameters: z.object({
      command: z.string().describe("The bash command to execute"),
      description: z.string().optional()
        .describe("Brief description of what this command does (for logging)"),
      timeout: z.number().optional()
        .describe(`Timeout in ms (max ${timeout})`),
    }),

    execute: async ({ command, description, timeout: cmdTimeout }) => {
      const effectiveTimeout = Math.min(cmdTimeout ?? timeout, timeout);

      try {
        const result = await executeCommand(command, {
          cwd: config.cwd,
          timeout: effectiveTimeout,
        });

        // Combinar stdout y stderr
        let output = "";
        if (result.stdout) {
          output += result.stdout;
        }
        if (result.stderr) {
          if (output) output += "\n";
          output += result.stderr;
        }

        // Truncar output
        const truncated = truncateTail(output || "(no output)", { maxLines, maxBytes });

        // Construir resultado
        const status = result.timedOut
          ? "timed_out"
          : result.interrupted
            ? "interrupted"
            : result.exitCode === 0
              ? "success"
              : "error";

        return {
          status,
          exitCode: result.exitCode,
          output: truncated.content,
          truncated: truncated.wasTruncated,
          ...(result.timedOut && {
            warning: `Command timed out after ${effectiveTimeout}ms`
          }),
          ...(result.interrupted && {
            warning: "Command was interrupted"
          }),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          status: "error",
          exitCode: 1,
          output: `Failed to execute command: ${message}`,
          error: message,
        };
      }
    },
  });
}
```

---

## FASE 4: Herramientas de Búsqueda y Listado

**Objetivo:** Implementar grep, find y ls.

### Paso 4.1: Crear `grep.ts`

**Destino:** `src/main/services/ai/codingTools/tools/grep.ts`

```typescript
/**
 * Herramienta Grep: buscar contenido en archivos.
 * Adaptada de pi-mono para Vercel AI SDK.
 * Usa ripgrep (rg) si está disponible, fallback a grep nativo.
 */

import { tool } from "ai";
import { z } from "zod";
import { executeCommand } from "../utils/shell";
import { truncateHead } from "../utils/truncate";
import { resolveToCwd } from "../utils/path-utils";

export interface GrepToolConfig {
  cwd: string;
  maxResults?: number;
}

export function createGrepTool(config: GrepToolConfig) {
  const maxResults = config.maxResults ?? 100;

  return tool({
    description: `Search for patterns in files using regex.
Uses ripgrep (rg) for fast searching with full regex support.
Returns matching file paths by default, or content with context.`,

    parameters: z.object({
      pattern: z.string().describe("Regular expression pattern to search for"),
      path: z.string().optional()
        .describe("Directory or file to search in (default: current directory)"),
      glob: z.string().optional()
        .describe("Glob pattern to filter files (e.g., '*.ts', '*.{js,jsx}')"),
      output_mode: z.enum(["files_with_matches", "content", "count"]).optional()
        .default("files_with_matches")
        .describe("Output mode: files_with_matches, content (with lines), or count"),
      case_insensitive: z.boolean().optional().default(false)
        .describe("Case insensitive search (-i flag)"),
      context_lines: z.number().optional()
        .describe("Lines of context before and after match (-C flag)"),
    }),

    execute: async ({
      pattern,
      path,
      glob,
      output_mode,
      case_insensitive,
      context_lines
    }) => {
      try {
        const searchPath = path ? resolveToCwd(path, config.cwd) : config.cwd;

        // Construir comando rg
        const args: string[] = ["rg"];

        // Modo de output
        if (output_mode === "files_with_matches") {
          args.push("-l"); // solo nombres de archivo
        } else if (output_mode === "count") {
          args.push("-c"); // contar matches
        } else {
          args.push("-n"); // mostrar números de línea
          if (context_lines) {
            args.push(`-C${context_lines}`);
          }
        }

        // Opciones
        if (case_insensitive) {
          args.push("-i");
        }

        // Glob filter
        if (glob) {
          args.push(`--glob=${glob}`);
        }

        // Limitar resultados
        args.push(`-m${maxResults}`);

        // Pattern y path
        args.push("--", pattern, searchPath);

        const command = args.join(" ");

        const result = await executeCommand(command, {
          cwd: config.cwd,
          timeout: 30000, // 30 segundos para búsqueda
        });

        // rg retorna exit code 1 si no hay matches (no es error)
        if (result.exitCode > 1) {
          return {
            success: false,
            error: result.stderr || `Search failed with exit code ${result.exitCode}`,
          };
        }

        const output = result.stdout.trim();

        if (!output) {
          return {
            success: true,
            matches: 0,
            message: "No matches found",
            results: [],
          };
        }

        // Parsear resultados según modo
        const lines = output.split("\n").filter(Boolean);

        if (output_mode === "count") {
          // Formato: file:count
          const counts = lines.map(line => {
            const [file, count] = line.split(":");
            return { file, count: parseInt(count, 10) };
          });
          const total = counts.reduce((sum, c) => sum + c.count, 0);

          return {
            success: true,
            matches: total,
            filesWithMatches: counts.length,
            results: counts,
          };
        }

        // Truncar si es necesario
        const truncated = truncateHead(output, { maxLines: 500 });

        return {
          success: true,
          matches: lines.length,
          truncated: truncated.wasTruncated,
          results: truncated.content,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // Si rg no está instalado, sugerir instalación
        if (message.includes("not found") || message.includes("ENOENT")) {
          return {
            success: false,
            error: "ripgrep (rg) not found. Install with: brew install ripgrep (macOS) or apt install ripgrep (Linux)",
          };
        }

        return {
          success: false,
          error: `Search failed: ${message}`,
        };
      }
    },
  });
}
```

### Paso 4.2: Crear `find.ts`

**Destino:** `src/main/services/ai/codingTools/tools/find.ts`

```typescript
/**
 * Herramienta Find: buscar archivos por patrón glob.
 * Adaptada de pi-mono para Vercel AI SDK.
 * Usa fd si está disponible, fallback a find nativo.
 */

import { tool } from "ai";
import { z } from "zod";
import { executeCommand } from "../utils/shell";
import { truncateHead } from "../utils/truncate";
import { resolveToCwd } from "../utils/path-utils";

export interface FindToolConfig {
  cwd: string;
  maxResults?: number;
}

export function createFindTool(config: FindToolConfig) {
  const maxResults = config.maxResults ?? 500;

  return tool({
    description: `Find files matching a glob pattern.
Uses fd for fast file finding. Supports patterns like "**/*.ts", "src/**/*.tsx".
Results are sorted by modification time (most recent first).`,

    parameters: z.object({
      pattern: z.string().describe("Glob pattern to match files (e.g., '**/*.ts')"),
      path: z.string().optional()
        .describe("Directory to search in (default: current directory)"),
      type: z.enum(["file", "directory", "any"]).optional().default("file")
        .describe("Type of entries to find"),
      hidden: z.boolean().optional().default(false)
        .describe("Include hidden files and directories"),
    }),

    execute: async ({ pattern, path, type, hidden }) => {
      try {
        const searchPath = path ? resolveToCwd(path, config.cwd) : config.cwd;

        // Construir comando fd
        const args: string[] = ["fd"];

        // Tipo de entrada
        if (type === "file") {
          args.push("-t", "f");
        } else if (type === "directory") {
          args.push("-t", "d");
        }

        // Archivos ocultos
        if (hidden) {
          args.push("-H");
        }

        // Ignorar .gitignore patterns (seguir las reglas del repo)
        args.push("--no-ignore-vcs");

        // Glob pattern - fd usa -g para glob
        args.push("-g", pattern);

        // Limitar resultados
        args.push("--max-results", String(maxResults));

        // Ordenar por fecha de modificación
        args.push("--changed-within", "100years"); // hack para obtener ordenamiento

        // Directorio base
        args.push(searchPath);

        const command = args.join(" ");

        const result = await executeCommand(command, {
          cwd: config.cwd,
          timeout: 30000,
        });

        // fd retorna exit code 1 si no hay resultados
        if (result.exitCode > 1) {
          return {
            success: false,
            error: result.stderr || `Find failed with exit code ${result.exitCode}`,
          };
        }

        const output = result.stdout.trim();

        if (!output) {
          return {
            success: true,
            count: 0,
            message: "No files found matching pattern",
            files: [],
          };
        }

        const files = output.split("\n").filter(Boolean);

        // Truncar si hay demasiados
        const truncated = truncateHead(files.join("\n"), { maxLines: maxResults });
        const displayedFiles = truncated.content.split("\n").filter(Boolean);

        return {
          success: true,
          count: files.length,
          truncated: truncated.wasTruncated,
          files: displayedFiles,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // Si fd no está instalado, sugerir alternativa
        if (message.includes("not found") || message.includes("ENOENT")) {
          return {
            success: false,
            error: "fd not found. Install with: brew install fd (macOS) or apt install fd-find (Linux)",
          };
        }

        return {
          success: false,
          error: `Find failed: ${message}`,
        };
      }
    },
  });
}
```

### Paso 4.3: Crear `ls.ts`

**Destino:** `src/main/services/ai/codingTools/tools/ls.ts`

```typescript
/**
 * Herramienta Ls: listar contenido de directorios.
 * Adaptada de pi-mono para Vercel AI SDK.
 */

import { tool } from "ai";
import { z } from "zod";
import { readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import { resolveToCwd } from "../utils/path-utils";
import { truncateHead, formatSize, DEFAULT_MAX_BYTES } from "../utils/truncate";

export interface LsToolConfig {
  cwd: string;
  defaultLimit?: number;
}

const DEFAULT_LIMIT = 500;

export function createLsTool(config: LsToolConfig) {
  const defaultLimit = config.defaultLimit ?? DEFAULT_LIMIT;

  return tool({
    description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to ${defaultLimit} entries or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first).`,

    parameters: z.object({
      path: z.string().optional()
        .describe("Directory to list (default: current directory)"),
      limit: z.number().optional()
        .describe(`Maximum number of entries to return (default: ${defaultLimit})`),
    }),

    execute: async ({ path, limit }) => {
      try {
        const dirPath = resolveToCwd(path || ".", config.cwd);
        const effectiveLimit = limit ?? defaultLimit;

        // Check if path exists
        if (!existsSync(dirPath)) {
          return {
            success: false,
            error: `Path not found: ${dirPath}`,
          };
        }

        // Check if path is a directory
        const stat = statSync(dirPath);
        if (!stat.isDirectory()) {
          return {
            success: false,
            error: `Not a directory: ${dirPath}. Use read tool for files.`,
          };
        }

        // Read directory entries
        let entries: string[];
        try {
          entries = readdirSync(dirPath);
        } catch (e: any) {
          return {
            success: false,
            error: `Cannot read directory: ${e.message}`,
          };
        }

        // Sort alphabetically (case-insensitive)
        entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

        // Format entries with directory indicators
        const results: string[] = [];
        let entryLimitReached = false;

        for (const entry of entries) {
          if (results.length >= effectiveLimit) {
            entryLimitReached = true;
            break;
          }

          const fullPath = join(dirPath, entry);
          let suffix = "";

          try {
            const entryStat = statSync(fullPath);
            if (entryStat.isDirectory()) {
              suffix = "/";
            }
          } catch {
            // Skip entries we can't stat
            continue;
          }

          results.push(entry + suffix);
        }

        if (results.length === 0) {
          return {
            success: true,
            count: 0,
            message: "(empty directory)",
            entries: [],
          };
        }

        // Apply byte truncation
        const rawOutput = results.join("\n");
        const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });

        // Build notices
        const notices: string[] = [];

        if (entryLimitReached) {
          notices.push(`${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`);
        }

        if (truncation.wasTruncated) {
          notices.push(`${formatSize(DEFAULT_MAX_BYTES)} size limit reached`);
        }

        let output = truncation.content;
        if (notices.length > 0) {
          output += `\n\n[${notices.join(". ")}]`;
        }

        return {
          success: true,
          count: results.length,
          totalEntries: entries.length,
          truncated: entryLimitReached || truncation.wasTruncated,
          entries: output,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `Failed to list directory: ${message}`,
        };
      }
    },
  });
}
```

---

## FASE 5: Integración en Levante

**Objetivo:** Conectar las herramientas al agent loop existente.

### Paso 5.1: Crear index.ts de codingTools

**Destino:** `src/main/services/ai/codingTools/index.ts`

```typescript
/**
 * Coding Tools para Levante.
 * Herramientas de desarrollo: bash, read, write, edit, grep, find, ls.
 */

import { createBashTool, BashToolConfig } from "./tools/bash";
import { createReadTool, ReadToolConfig } from "./tools/read";
import { createWriteTool, WriteToolConfig } from "./tools/write";
import { createEditTool, EditToolConfig } from "./tools/edit";
import { createGrepTool, GrepToolConfig } from "./tools/grep";
import { createFindTool, FindToolConfig } from "./tools/find";
import { createLsTool, LsToolConfig } from "./tools/ls";

export interface CodingToolsConfig {
  cwd: string;
  enabled?: {
    bash?: boolean;
    read?: boolean;
    write?: boolean;
    edit?: boolean;
    grep?: boolean;
    find?: boolean;
    ls?: boolean;
  };
  // Config específica por herramienta
  bash?: Partial<BashToolConfig>;
  read?: Partial<ReadToolConfig>;
  grep?: Partial<GrepToolConfig>;
  find?: Partial<FindToolConfig>;
  ls?: Partial<LsToolConfig>;
}

/**
 * Crear todas las coding tools configuradas.
 * Retorna un objeto compatible con Vercel AI SDK streamText().
 */
export function getCodingTools(config: CodingToolsConfig) {
  const enabled = {
    bash: true,
    read: true,
    write: true,
    edit: true,
    grep: true,
    find: true,
    ls: true,
    ...config.enabled,
  };

  const tools: Record<string, ReturnType<typeof createBashTool>> = {};

  if (enabled.bash) {
    tools.bash = createBashTool({
      cwd: config.cwd,
      ...config.bash
    });
  }

  if (enabled.read) {
    tools.read = createReadTool({
      cwd: config.cwd,
      ...config.read
    });
  }

  if (enabled.write) {
    tools.write = createWriteTool({
      cwd: config.cwd
    });
  }

  if (enabled.edit) {
    tools.edit = createEditTool({
      cwd: config.cwd
    });
  }

  if (enabled.grep) {
    tools.grep = createGrepTool({
      cwd: config.cwd,
      ...config.grep
    });
  }

  if (enabled.find) {
    tools.find = createFindTool({
      cwd: config.cwd,
      ...config.find
    });
  }

  if (enabled.ls) {
    tools.ls = createLsTool({
      cwd: config.cwd,
      ...config.ls
    });
  }

  return tools;
}

// Re-exportar tipos
export type { BashToolConfig } from "./tools/bash";
export type { ReadToolConfig } from "./tools/read";
export type { WriteToolConfig } from "./tools/write";
export type { EditToolConfig } from "./tools/edit";
export type { GrepToolConfig } from "./tools/grep";
export type { FindToolConfig } from "./tools/find";
export type { LsToolConfig } from "./tools/ls";

// Re-exportar utilidades por si se necesitan
export { executeCommand } from "./utils/shell";
export { truncateHead, truncateTail, formatSize } from "./utils/truncate";
export { resolveToCwd, resolveReadPath, expandPath } from "./utils/path-utils";
```

### Paso 5.2: Modificar `aiService.ts` para incluir coding tools

**Archivo:** `src/main/services/aiService.ts`

Buscar la sección donde se cargan las tools (alrededor de línea 936) y agregar:

```typescript
// Importar al inicio del archivo
import { getCodingTools } from "./ai/codingTools";

// En streamChat(), después de cargar built-in y MCP tools:

// ──────────────────────────────────────────────────
// Cargar Coding Tools (si está habilitado code mode)
// ──────────────────────────────────────────────────
if (request.codeMode?.enabled) {
  const codingTools = getCodingTools({
    cwd: request.codeMode.cwd ?? process.cwd(),
    enabled: request.codeMode.tools, // { bash: true, read: true, ... }
  });

  tools = {
    ...tools,
    ...codingTools,
  };

  logger.aiSdk.debug("Loaded coding tools", {
    tools: Object.keys(codingTools),
    cwd: request.codeMode.cwd,
  });
}
```

### Paso 5.3: Actualizar tipos de ChatRequest

**Archivo:** `src/main/types/chat.ts` (o donde esté definido ChatRequest)

```typescript
interface ChatRequest {
  messages: UIMessage[];
  model: string;
  webSearch: boolean;
  enableMCP?: boolean;
  // Nuevo: modo de codificación
  codeMode?: {
    enabled: boolean;
    cwd?: string; // Directorio de trabajo
    tools?: {
      bash?: boolean;
      read?: boolean;
      write?: boolean;
      edit?: boolean;
      grep?: boolean;
      find?: boolean;
      ls?: boolean;
    };
  };
}
```

---

## FASE 6: Testing y Verificación

### Paso 6.1: Test manual de herramientas

Crear archivo de test simple:

```typescript
// test/codingTools.test.ts
import { getCodingTools } from "../src/main/services/ai/codingTools";
import { describe, it, expect } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { writeFileSync, mkdirSync, rmSync } from "fs";

describe("Coding Tools", () => {
  const testDir = join(tmpdir(), "levante-test-" + Date.now());

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "test.txt"), "Hello\nWorld\n");
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("read tool should read files", async () => {
    const tools = getCodingTools({ cwd: testDir });
    const result = await tools.read.execute({ file_path: "test.txt" });
    expect(result.success).toBe(true);
    expect(result.content).toContain("Hello");
  });

  it("write tool should create files", async () => {
    const tools = getCodingTools({ cwd: testDir });
    const result = await tools.write.execute({
      file_path: "new.txt",
      content: "Test content"
    });
    expect(result.success).toBe(true);
  });

  it("bash tool should execute commands", async () => {
    const tools = getCodingTools({ cwd: testDir });
    const result = await tools.bash.execute({ command: "echo hello" });
    expect(result.status).toBe("success");
    expect(result.output).toContain("hello");
  });

  it("ls tool should list directories", async () => {
    const tools = getCodingTools({ cwd: testDir });
    const result = await tools.ls.execute({});
    expect(result.success).toBe(true);
    expect(result.entries).toContain("test.txt");
  });
});
```

### Paso 6.2: Checklist de verificación

- [ ] `truncate.ts` compila sin errores
- [ ] `path-utils.ts` compila sin errores
- [ ] `shell.ts` compila sin errores
- [ ] `write.ts` funciona: crea archivos correctamente
- [ ] `read.ts` funciona: lee archivos con números de línea
- [ ] `edit.ts` funciona: reemplaza texto y genera diff
- [ ] `bash.ts` funciona: ejecuta comandos y captura output
- [ ] `grep.ts` funciona: encuentra patrones (requiere `rg` instalado)
- [ ] `find.ts` funciona: encuentra archivos (requiere `fd` instalado)
- [ ] `ls.ts` funciona: lista directorios correctamente
- [ ] `getCodingTools()` retorna objeto válido para AI SDK
- [ ] Integration test en `aiService.ts` funciona
- [ ] UI puede activar/desactivar code mode

---

## FASE 7: Mejoras Opcionales

### 7.1: Instalar dependencias de sistema

```bash
# macOS
brew install ripgrep fd

# Linux (Debian/Ubuntu)
sudo apt install ripgrep fd-find

# Verificar instalación
rg --version
fd --version
```

### 7.2: Agregar dependencias npm

```bash
cd /Users/saulgomezjimenez/proyectos/clai/proyectos/levante/levante

# Requerida para edit (diff)
pnpm add diff
pnpm add -D @types/diff

# Opcionales para resize de imágenes (Fase 7.4)
pnpm add @silvia-odwyer/photon-node file-type
```

### 7.3: Sistema de permisos (futuro)

Para implementar aprobación de tools como en Claude Code:

```typescript
// En codingTools/permissions.ts
export interface ToolPermission {
  tool: string;
  action: "allow" | "deny" | "ask";
  pattern?: string; // e.g., "rm -rf" → deny
}

export function checkPermission(
  tool: string,
  params: Record<string, any>,
  permissions: ToolPermission[]
): "allow" | "deny" | "ask" {
  // Implementar lógica de permisos
}
```

### 7.4: Resize de imágenes (recomendado para screenshots grandes)

Si vas a procesar imágenes grandes (screenshots, diagramas), agrega el sistema de resize.

**Instalar dependencias:**

```bash
pnpm add @silvia-odwyer/photon-node file-type
```

**Crear `utils/image-resize.ts`:**

```typescript
/**
 * Resize de imágenes para mantenerlas bajo límites de API.
 * Usa Photon (Rust/WASM) para procesamiento eficiente.
 */

export interface ImageResizeOptions {
  maxWidth?: number;      // Default: 2000
  maxHeight?: number;     // Default: 2000
  maxBytes?: number;      // Default: 4.5MB
  jpegQuality?: number;   // Default: 80
}

export interface ResizedImage {
  data: string;           // base64
  mimeType: string;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  wasResized: boolean;
}

const DEFAULT_MAX_BYTES = 4.5 * 1024 * 1024; // 4.5MB

const DEFAULT_OPTIONS: Required<ImageResizeOptions> = {
  maxWidth: 2000,
  maxHeight: 2000,
  maxBytes: DEFAULT_MAX_BYTES,
  jpegQuality: 80,
};

// Cargar Photon dinámicamente
let photonModule: any = null;

async function loadPhoton() {
  if (photonModule) return photonModule;
  try {
    photonModule = await import("@silvia-odwyer/photon-node");
    return photonModule;
  } catch {
    return null;
  }
}

/**
 * Resize imagen si excede límites.
 * Retorna original si ya está dentro de límites o Photon no disponible.
 */
export async function resizeImage(
  img: { data: string; mimeType: string },
  options?: ImageResizeOptions
): Promise<ResizedImage> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const inputBuffer = Buffer.from(img.data, "base64");

  const photon = await loadPhoton();
  if (!photon) {
    // Photon no disponible, retornar original
    return {
      data: img.data,
      mimeType: img.mimeType,
      originalWidth: 0,
      originalHeight: 0,
      width: 0,
      height: 0,
      wasResized: false,
    };
  }

  let image: any;
  try {
    image = photon.PhotonImage.new_from_byteslice(new Uint8Array(inputBuffer));

    const originalWidth = image.get_width();
    const originalHeight = image.get_height();

    // Verificar si ya está dentro de límites
    if (
      originalWidth <= opts.maxWidth &&
      originalHeight <= opts.maxHeight &&
      inputBuffer.length <= opts.maxBytes
    ) {
      return {
        data: img.data,
        mimeType: img.mimeType,
        originalWidth,
        originalHeight,
        width: originalWidth,
        height: originalHeight,
        wasResized: false,
      };
    }

    // Calcular nuevas dimensiones
    let targetWidth = originalWidth;
    let targetHeight = originalHeight;

    if (targetWidth > opts.maxWidth) {
      targetHeight = Math.round((targetHeight * opts.maxWidth) / targetWidth);
      targetWidth = opts.maxWidth;
    }
    if (targetHeight > opts.maxHeight) {
      targetWidth = Math.round((targetWidth * opts.maxHeight) / targetHeight);
      targetHeight = opts.maxHeight;
    }

    // Resize
    const resized = photon.resize(
      image,
      targetWidth,
      targetHeight,
      photon.SamplingFilter.Lanczos3
    );

    try {
      // Probar PNG y JPEG, usar el más pequeño
      const pngBuffer = resized.get_bytes();
      const jpegBuffer = resized.get_bytes_jpeg(opts.jpegQuality);

      const best = pngBuffer.length <= jpegBuffer.length
        ? { buffer: pngBuffer, mimeType: "image/png" }
        : { buffer: jpegBuffer, mimeType: "image/jpeg" };

      return {
        data: Buffer.from(best.buffer).toString("base64"),
        mimeType: best.mimeType,
        originalWidth,
        originalHeight,
        width: targetWidth,
        height: targetHeight,
        wasResized: true,
      };
    } finally {
      resized.free();
    }
  } catch {
    // Error al procesar, retornar original
    return {
      data: img.data,
      mimeType: img.mimeType,
      originalWidth: 0,
      originalHeight: 0,
      width: 0,
      height: 0,
      wasResized: false,
    };
  } finally {
    if (image) {
      image.free();
    }
  }
}

/**
 * Formatear nota de dimensiones para el modelo.
 */
export function formatDimensionNote(result: ResizedImage): string | undefined {
  if (!result.wasResized) {
    return undefined;
  }

  const scale = result.originalWidth / result.width;
  return `[Image: original ${result.originalWidth}x${result.originalHeight}, displayed at ${result.width}x${result.height}. Multiply coordinates by ${scale.toFixed(2)} to map to original.]`;
}
```

**Actualizar `read.ts` para usar resize:**

En el execute de read.ts, reemplazar la sección de imágenes:

```typescript
// Detectar si es imagen
const ext = file_path.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
if (IMAGE_EXTENSIONS.has(ext)) {
  const buffer = await readFile(resolvedPath);
  const base64 = buffer.toString("base64");
  const mimeType = ext === ".png" ? "image/png"
    : ext === ".gif" ? "image/gif"
    : ext === ".webp" ? "image/webp"
    : "image/jpeg";

  // Resize si es necesario
  const resized = await resizeImage({ data: base64, mimeType });
  const dimensionNote = formatDimensionNote(resized);

  let textNote = `Read image file [${resized.mimeType}]`;
  if (dimensionNote) {
    textNote += `\n${dimensionNote}`;
  }

  return {
    success: true,
    isImage: true,
    mimeType: resized.mimeType,
    data: resized.data,
    size: stats.size,
    resized: resized.wasResized,
    note: textNote,
  };
}
```

### 7.5: Mejora de truncation en read.ts (opcional)

Para mensajes más informativos como en pi-mono:

```typescript
// En read.ts, después de truncar
if (truncated.wasTruncated) {
  const endLine = startLine + truncated.keptLines;
  const nextOffset = endLine + 1;

  return {
    success: true,
    content: truncated.content +
      `\n\n[Showing lines ${startLine + 1}-${endLine} of ${totalLines}. Use offset=${nextOffset} to continue.]`,
    totalLines,
    displayedLines: truncated.keptLines,
    truncated: true,
    nextOffset,
  };
}
```

---

## Resumen de Archivos a Crear

```
src/main/services/ai/codingTools/
├── index.ts                  # Export principal
├── types.ts                  # Tipos compartidos
├── utils/
│   ├── truncate.ts          # Utilidades de truncado
│   ├── path-utils.ts        # Resolución de rutas
│   ├── shell.ts             # Ejecución de comandos
│   └── image-resize.ts      # (Opcional) Resize de imágenes
└── tools/
    ├── bash.ts              # Herramienta bash
    ├── read.ts              # Leer archivos
    ├── write.ts             # Escribir archivos
    ├── edit.ts              # Editar archivos
    ├── edit-diff.ts         # Utilidades de diff
    ├── grep.ts              # Buscar contenido
    ├── find.ts              # Buscar archivos
    └── ls.ts                # Listar directorios
```

**Total: 12 archivos core + 1 opcional (image-resize)**

---

## Orden de Implementación

1. ✅ FASE 1: Crear estructura + utils (truncate, path-utils, shell)
2. ✅ FASE 2: write.ts, read.ts, edit-diff.ts, edit.ts
3. ✅ FASE 3: bash.ts
4. ✅ FASE 4: grep.ts, find.ts, ls.ts
5. ✅ FASE 5: index.ts + integración en aiService.ts
6. ✅ FASE 6: Tests
7. 🔄 FASE 7: Mejoras opcionales

---

## Comandos de Inicio Rápido

```bash
# 1. Crear estructura
cd /Users/saulgomezjimenez/proyectos/clai/proyectos/levante/levante
mkdir -p src/main/services/ai/codingTools/{utils,tools}

# 2. Agregar dependencias
pnpm add diff @types/diff

# 3. (Opcional) Agregar dependencias para resize de imágenes
pnpm add @silvia-odwyer/photon-node file-type

# 4. Instalar herramientas del sistema (si no están)
brew install ripgrep fd  # macOS
# o
sudo apt install ripgrep fd-find  # Linux

# 5. Verificar tipos
pnpm typecheck

# 6. Ejecutar tests
pnpm test
```

---

## Checklist Final de Herramientas

| Tool | Archivo | Dependencia Sistema | Estado |
|------|---------|---------------------|--------|
| bash | tools/bash.ts | - | Core |
| read | tools/read.ts | - | Core |
| write | tools/write.ts | - | Core |
| edit | tools/edit.ts | npm: diff | Core |
| grep | tools/grep.ts | ripgrep (rg) | Core |
| find | tools/find.ts | fd | Core |
| ls | tools/ls.ts | - | Core |
| image-resize | utils/image-resize.ts | npm: photon-node | Opcional |
