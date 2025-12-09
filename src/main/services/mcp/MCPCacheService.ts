import path from 'path';
import fs from 'fs/promises';
import { app } from 'electron';
import { getLogger } from '../logging';

const logger = getLogger();

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  version: string;
}

/**
 * Service for caching MCP provider data
 */
export class MCPCacheService {
  private cacheDir: string;
  private memoryCache: Map<string, CacheEntry<unknown>> = new Map();

  constructor() {
    this.cacheDir = path.join(app.getPath('userData'), 'mcp-cache');
  }

  /**
   * Initialize cache directory
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      logger.mcp.debug('MCP cache directory initialized', { path: this.cacheDir });
    } catch (error) {
      logger.mcp.error('Failed to initialize MCP cache directory', {
        error: error instanceof Error ? error.message : error
      });
    }
  }

  /**
   * Get cached data for a provider
   */
  async getCache<T>(providerId: string): Promise<T | null> {
    // Check memory cache first
    const memCached = this.memoryCache.get(providerId) as CacheEntry<T> | undefined;
    if (memCached) {
      return memCached.data;
    }

    // Check file cache
    try {
      const cachePath = this.getCachePath(providerId);
      const content = await fs.readFile(cachePath, 'utf-8');
      const entry: CacheEntry<T> = JSON.parse(content);

      // Update memory cache
      this.memoryCache.set(providerId, entry);

      return entry.data;
    } catch {
      return null;
    }
  }

  /**
   * Set cache data for a provider
   */
  async setCache<T>(providerId: string, data: T, version: string = '1.0.0'): Promise<void> {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      version
    };

    // Update memory cache
    this.memoryCache.set(providerId, entry);

    // Write to file cache
    try {
      const cachePath = this.getCachePath(providerId);
      await fs.writeFile(cachePath, JSON.stringify(entry, null, 2), 'utf-8');
      logger.mcp.debug('Cache updated for provider', { providerId });
    } catch (error) {
      logger.mcp.error('Failed to write cache for provider', {
        providerId,
        error: error instanceof Error ? error.message : error
      });
    }
  }

  /**
   * Clear cache for a provider
   */
  async clearCache(providerId: string): Promise<void> {
    // Clear memory cache
    this.memoryCache.delete(providerId);

    // Clear file cache
    try {
      const cachePath = this.getCachePath(providerId);
      await fs.unlink(cachePath);
      logger.mcp.debug('Cache cleared for provider', { providerId });
    } catch {
      // File might not exist, ignore
    }
  }

  /**
   * Check if cache is valid based on max age
   */
  async isCacheValid(providerId: string, maxAgeMs: number): Promise<boolean> {
    // Check memory cache first
    const memCached = this.memoryCache.get(providerId);
    if (memCached) {
      return Date.now() - memCached.timestamp < maxAgeMs;
    }

    // Check file cache
    try {
      const cachePath = this.getCachePath(providerId);
      const content = await fs.readFile(cachePath, 'utf-8');
      const entry: CacheEntry<unknown> = JSON.parse(content);

      return Date.now() - entry.timestamp < maxAgeMs;
    } catch {
      return false;
    }
  }

  /**
   * Get cache timestamp for a provider
   */
  async getCacheTimestamp(providerId: string): Promise<number | null> {
    // Check memory cache first
    const memCached = this.memoryCache.get(providerId);
    if (memCached) {
      return memCached.timestamp;
    }

    // Check file cache
    try {
      const cachePath = this.getCachePath(providerId);
      const content = await fs.readFile(cachePath, 'utf-8');
      const entry: CacheEntry<unknown> = JSON.parse(content);

      return entry.timestamp;
    } catch {
      return null;
    }
  }

  /**
   * Clear all cache
   */
  async clearAllCache(): Promise<void> {
    // Clear memory cache
    this.memoryCache.clear();

    // Clear file cache
    try {
      const files = await fs.readdir(this.cacheDir);
      await Promise.all(
        files.map(file => fs.unlink(path.join(this.cacheDir, file)))
      );
      logger.mcp.debug('All MCP cache cleared');
    } catch (error) {
      logger.mcp.error('Failed to clear all MCP cache', {
        error: error instanceof Error ? error.message : error
      });
    }
  }

  private getCachePath(providerId: string): string {
    return path.join(this.cacheDir, `${providerId}.json`);
  }
}

// Singleton instance
export const mcpCacheService = new MCPCacheService();
