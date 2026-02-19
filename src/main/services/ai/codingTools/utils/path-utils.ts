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
