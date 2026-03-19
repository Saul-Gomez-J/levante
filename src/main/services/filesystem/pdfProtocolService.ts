/**
 * PDF Protocol Service
 *
 * Registers a custom `levante-fs://pdf?path=...` protocol handler
 * that streams PDF files from the filesystem with Range request support.
 *
 * Security: all paths are validated against the working directory
 * using fileSystemService.resolveAndValidatePath().
 */

import { protocol } from 'electron';
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileSystemService } from './fileSystemService';
import { getLogger } from '../logging';

const logger = getLogger();

export function registerPdfProtocol(): void {
  protocol.handle('levante-fs', async (request) => {
    try {
      const url = new URL(request.url);

      if (url.hostname !== 'pdf') {
        return new Response('Not found', { status: 404 });
      }

      const filePath = url.searchParams.get('path');
      if (!filePath) {
        return new Response('Missing path parameter', { status: 400 });
      }

      const decodedPath = decodeURIComponent(filePath);

      // Validate extension
      const ext = path.extname(decodedPath).slice(1).toLowerCase();
      if (ext !== 'pdf') {
        return new Response('Only PDF files are allowed', { status: 415 });
      }

      // Validate path against CWD boundary
      let resolvedPath: string;
      try {
        resolvedPath = fileSystemService.resolveAndValidatePath(decodedPath);
      } catch {
        return new Response('Access denied', { status: 403 });
      }

      // Get file stats
      let stats: ReturnType<typeof statSync>;
      try {
        stats = statSync(resolvedPath);
      } catch {
        return new Response('File not found', { status: 404 });
      }

      const fileSize = stats.size;
      const rangeHeader = request.headers.get('range');

      if (rangeHeader) {
        // Parse Range header
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (!match) {
          return new Response('Invalid range', {
            status: 416,
            headers: { 'Content-Range': `bytes */${fileSize}` },
          });
        }

        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize || start > end) {
          return new Response('Range not satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${fileSize}` },
          });
        }

        const chunkSize = end - start + 1;
        const stream = createReadStream(resolvedPath, { start, end });
        const webStream = Readable.toWeb(stream) as ReadableStream;

        return new Response(webStream, {
          status: 206,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Length': String(chunkSize),
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store',
          },
        });
      }

      // Full file response
      const stream = createReadStream(resolvedPath);
      const webStream = Readable.toWeb(stream) as ReadableStream;

      return new Response(webStream, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      logger.core.error('PDF protocol handler error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return new Response('Internal error', { status: 500 });
    }
  });
}
