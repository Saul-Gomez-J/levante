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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};

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
