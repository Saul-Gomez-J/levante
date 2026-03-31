import { tool } from 'ai';
import { z } from 'zod';
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { resolveReadPath } from '../utils/path-utils';

export interface PresentFilesToolConfig {
  cwd: string;
}

const fileEntrySchema = z.object({
  path: z.string().describe('Absolute path or path relative to the current cowork directory'),
  description: z.string().optional().describe('Short description shown in the UI'),
});

export function createPresentFilesTool(config: PresentFilesToolConfig) {
  return tool({
    description: `Present one or more files to the user with an interactive card in chat.
Use this after creating, generating, or packaging a file that the user should inspect or act on.
Paths may be absolute or relative to the current cowork directory: ${config.cwd}`,

    inputSchema: z.object({
      files: z.array(fileEntrySchema).min(1).max(20),
    }),

    execute: async ({ files }) => {
      const results = await Promise.all(
        files.map(async (file) => {
          const resolvedPath = resolveReadPath(file.path, config.cwd);
          const extension = extname(resolvedPath).toLowerCase();

          try {
            const fileStat = await stat(resolvedPath);

            if (!fileStat.isFile()) {
              return {
                path: resolvedPath,
                name: basename(resolvedPath),
                description: file.description,
                size: 0,
                extension,
                isSkillPackage: extension === '.zip' || extension === '.skill',
                exists: false,
                error: 'Path is not a file',
              };
            }

            return {
              path: resolvedPath,
              name: basename(resolvedPath),
              description: file.description,
              size: fileStat.size,
              extension,
              isSkillPackage: extension === '.zip' || extension === '.skill',
              exists: true,
            };
          } catch (error) {
            return {
              path: resolvedPath,
              name: basename(resolvedPath),
              description: file.description,
              size: 0,
              extension,
              isSkillPackage: extension === '.zip' || extension === '.skill',
              exists: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
      );

      return {
        success: true,
        files: results,
      };
    },
  });
}
