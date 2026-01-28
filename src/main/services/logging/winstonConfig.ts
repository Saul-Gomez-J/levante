import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import type { LogRotationConfig } from '../../types/logger';
import { directoryService } from '../directoryService';
import path from 'path';
import { formatTimestampWithTimezone, getLogTimezone } from './timezoneFormat';

// Determinar si estamos en producción
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

// Formato desarrollo: legible con colores
export const developmentFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp(),
  winston.format.printf((info) => {
    const { timestamp, level, message, category, ...meta } = info;
    const formattedTime = formatTimestampWithTimezone(
      new Date(timestamp as string),
      getLogTimezone()
    );
    const categoryStr = category ? `[${String(category).toUpperCase()}]` : '';
    const metaStr = Object.keys(meta).length > 0 ? `\n${JSON.stringify(meta, null, 2)}` : '';
    return `${formattedTime} ${categoryStr} [${level.toUpperCase()}] ${message}${metaStr}`;
  })
);

// Formato producción: JSON estructurado
export const productionFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Formato desarrollo para archivos: legible sin colores ANSI
export const developmentFileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.printf((info) => {
    const { timestamp, level, message, category, ...meta } = info;
    const formattedTime = formatTimestampWithTimezone(
      new Date(timestamp as string),
      getLogTimezone()
    );
    const categoryStr = category ? `[${String(category).toUpperCase()}]` : '';
    const metaStr = Object.keys(meta).length > 0 ? `\n${JSON.stringify(meta, null, 2)}` : '';
    // Sin colores ANSI para archivos
    return `${formattedTime} ${categoryStr} [${level.toUpperCase()}] ${message}${metaStr}`;
  })
);

// Console transport
export function createConsoleTransport(): winston.transport {
  return new winston.transports.Console({
    format: isProduction() ? productionFormat : developmentFormat,
    stderrLevels: ['error'],
  });
}

// File transport con rotación
export function createFileTransport(
  filePath: string,
  rotationConfig: LogRotationConfig,
  errorOnly: boolean = false
): DailyRotateFile {
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : directoryService.getFilePath(filePath);

  const dirname = path.dirname(resolvedPath);
  const basename = path.basename(resolvedPath, path.extname(resolvedPath));

  return new DailyRotateFile({
    dirname,
    filename: errorOnly ? `${basename}-error-%DATE%.log` : `${basename}-%DATE%.log`,
    datePattern: rotationConfig.datePattern || 'YYYY-MM-DD',
    maxSize: rotationConfig.maxSize,
    maxFiles: errorOnly
      ? `${rotationConfig.maxAge * 3}d`  // Mantener errores más tiempo
      : rotationConfig.maxFiles.toString(),
    zippedArchive: rotationConfig.compress,
    format: isProduction() ? productionFormat : developmentFileFormat,
    level: errorOnly ? 'error' : undefined,
    auditFile: path.join(dirname, errorOnly ? '.winston-error-audit.json' : '.winston-audit.json'),
  });
}

// Crear transports para producción (all logs + errors only)
export function createProductionFileTransports(
  filePath: string,
  rotationConfig: LogRotationConfig
): winston.transport[] {
  return [
    createFileTransport(filePath, rotationConfig, false), // Todos los logs
    createFileTransport(filePath, rotationConfig, true),  // Solo errores
  ];
}
