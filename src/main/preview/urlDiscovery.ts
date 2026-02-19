import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../services/logging';
import type {
  DiscoveredPreviewService,
  DiscoverySource,
  PreviewDiscoveryOptions,
  PreviewDiscoveryResult,
} from '../../types/preview';

const logger = getLogger();

// Configuration constants
const PROBE_TIMEOUT_MS = 500;
const MAX_CONCURRENT_PROBES = 5;
const DISCOVERY_DEADLINE_MS = 1800;

// Common ports for local development servers
const COMMON_PORTS = [
  3000, // Create React App, Express, Next.js
  3001, // Alternative React
  4173, // Vite preview
  4200, // Angular
  5000, // Flask, many Python frameworks
  5173, // Vite dev
  5174, // Vite alternative
  8000, // Django, Python HTTP server
  8080, // Common alternative
  8081, // Alternative
  8888, // Jupyter
];

interface PortCandidate {
  port: number;
  source: DiscoverySource;
}

/**
 * Get common ports for local development
 */
export function getCommonPorts(): number[] {
  return [...COMMON_PORTS];
}

/**
 * Read ports from .env files in the given directory
 */
function readPortsFromEnvFiles(cwd: string): PortCandidate[] {
  const candidates: PortCandidate[] = [];
  const envFiles = ['.env', '.env.local', '.env.development'];

  for (const envFile of envFiles) {
    try {
      const filePath = path.join(cwd, envFile);
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        // Match PORT=3000 or similar patterns
        const match = line.match(/^(?:VITE_)?PORT\s*=\s*(\d+)/i);
        if (match) {
          const port = parseInt(match[1], 10);
          if (port > 0 && port < 65536) {
            candidates.push({ port, source: 'env' });
          }
        }
      }
    } catch {
      // Ignore read errors for env files
    }
  }

  return candidates;
}

/**
 * Read ports from package.json scripts
 */
function readPortsFromPackageScripts(cwd: string): PortCandidate[] {
  const candidates: PortCandidate[] = [];

  try {
    const packagePath = path.join(cwd, 'package.json');
    if (!fs.existsSync(packagePath)) return candidates;

    const content = fs.readFileSync(packagePath, 'utf-8');
    const pkg = JSON.parse(content);

    if (!pkg.scripts) return candidates;

    const scriptValues = Object.values(pkg.scripts) as string[];

    for (const script of scriptValues) {
      // Match --port 3000, -p 3000, PORT=3000
      const patterns = [
        /--port[=\s]+(\d+)/gi,
        /-p[=\s]+(\d+)/gi,
        /PORT=(\d+)/gi,
        /:(\d{4,5})(?:\s|$|")/g, // Match :3000 pattern
      ];

      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(script)) !== null) {
          const port = parseInt(match[1], 10);
          if (port > 0 && port < 65536) {
            candidates.push({ port, source: 'package-script' });
          }
        }
      }
    }
  } catch {
    // Ignore parse errors
  }

  return candidates;
}

/**
 * Merge and deduplicate port candidates
 */
function mergeCandidatePorts(...candidateLists: PortCandidate[][]): Map<number, DiscoverySource[]> {
  const portMap = new Map<number, DiscoverySource[]>();

  for (const candidates of candidateLists) {
    for (const candidate of candidates) {
      const existing = portMap.get(candidate.port) || [];
      if (!existing.includes(candidate.source)) {
        existing.push(candidate.source);
      }
      portMap.set(candidate.port, existing);
    }
  }

  return portMap;
}

/**
 * Generate a unique ID for a service
 */
function generateServiceId(host: string, port: number): string {
  return `${host}:${port}`;
}

/**
 * Probe a single service to check if it's online
 */
async function probeService(
  host: string,
  port: number,
  sources: DiscoverySource[]
): Promise<DiscoveredPreviewService | null> {
  const url = `http://${host}:${port}`;
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseTimeMs = Date.now() - startTime;

    // Calculate score
    let score = 0;
    if (sources.includes('env')) score += 50;
    if (sources.includes('package-script')) score += 40;
    if (sources.includes('common-port')) score += 20;

    // Extract fingerprint info
    let title: string | undefined;
    let poweredBy: string | undefined;
    let frameworkGuess: string | undefined;

    const contentType = response.headers.get('content-type') || '';
    poweredBy = response.headers.get('x-powered-by') || undefined;

    // Check if it's HTML
    if (contentType.includes('text/html')) {
      score += 10;

      try {
        const text = await response.text();

        // Extract title
        const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) {
          title = titleMatch[1].trim();
        }

        // Framework detection heuristics
        if (text.includes('__NEXT_DATA__') || text.includes('_next/')) {
          frameworkGuess = 'Next.js';
          score += 5;
        } else if (text.includes('__NUXT__') || text.includes('/_nuxt/')) {
          frameworkGuess = 'Nuxt';
          score += 5;
        } else if (text.includes('ng-version') || text.includes('/main.') && text.includes('angular')) {
          frameworkGuess = 'Angular';
          score += 5;
        } else if (text.includes('data-reactroot') || text.includes('__REACT')) {
          frameworkGuess = 'React';
          score += 5;
        } else if (text.includes('@vite') || text.includes('vite/')) {
          frameworkGuess = 'Vite';
          score += 5;
        }
      } catch {
        // Ignore body read errors
      }
    }

    // x-powered-by detection
    if (poweredBy) {
      if (poweredBy.toLowerCase().includes('express')) {
        frameworkGuess = frameworkGuess || 'Express';
        score += 5;
      } else if (poweredBy.toLowerCase().includes('next')) {
        frameworkGuess = frameworkGuess || 'Next.js';
        score += 5;
      }
    }

    return {
      id: generateServiceId(host, port),
      url,
      host,
      port,
      scope: 'loopback',
      status: 'online',
      source: sources,
      score,
      title,
      poweredBy,
      frameworkGuess,
      lastCheckedAt: Date.now(),
      responseTimeMs,
    };
  } catch {
    // Service not responding
    return null;
  }
}

/**
 * Deduplicate services (prefer localhost over 127.0.0.1 for same port)
 */
function dedupeServices(services: DiscoveredPreviewService[]): DiscoveredPreviewService[] {
  const byPort = new Map<number, DiscoveredPreviewService>();

  for (const service of services) {
    const existing = byPort.get(service.port);
    if (!existing) {
      byPort.set(service.port, service);
    } else {
      // Prefer localhost over 127.0.0.1
      if (service.host === 'localhost' && existing.host === '127.0.0.1') {
        byPort.set(service.port, service);
      } else if (service.score > existing.score) {
        // Or prefer higher score
        byPort.set(service.port, service);
      }
    }
  }

  return Array.from(byPort.values());
}

/**
 * Run probes with limited concurrency
 */
async function runProbesWithConcurrency(
  portMap: Map<number, DiscoverySource[]>,
  deadlineMs: number
): Promise<DiscoveredPreviewService[]> {
  const startTime = Date.now();
  const results: DiscoveredPreviewService[] = [];
  const entries = Array.from(portMap.entries());

  // Process in batches
  for (let i = 0; i < entries.length; i += MAX_CONCURRENT_PROBES) {
    // Check deadline
    if (Date.now() - startTime > deadlineMs) {
      logger.core.debug('Discovery deadline reached, returning partial results');
      break;
    }

    const batch = entries.slice(i, i + MAX_CONCURRENT_PROBES);
    const probes = batch.flatMap(([port, sources]) => [
      probeService('localhost', port, sources),
      probeService('127.0.0.1', port, sources),
    ]);

    const batchResults = await Promise.all(probes);

    for (const result of batchResults) {
      if (result) {
        results.push(result);
      }
    }
  }

  return results;
}

/**
 * Discover preview URLs for local development servers
 */
export async function discoverPreviewUrls(
  cwd: string | null,
  options?: PreviewDiscoveryOptions
): Promise<PreviewDiscoveryResult> {
  const startTime = Date.now();

  try {
    logger.core.debug('Starting preview URL discovery', { cwd, options });

    // Collect port candidates
    const envPorts = cwd ? readPortsFromEnvFiles(cwd) : [];
    const scriptPorts = cwd ? readPortsFromPackageScripts(cwd) : [];
    const commonPortCandidates: PortCandidate[] = COMMON_PORTS.map((port) => ({
      port,
      source: 'common-port' as DiscoverySource,
    }));

    // Merge candidates
    const portMap = mergeCandidatePorts(envPorts, scriptPorts, commonPortCandidates);

    logger.core.debug('Candidate ports collected', {
      envPorts: envPorts.length,
      scriptPorts: scriptPorts.length,
      totalUnique: portMap.size,
    });

    // Run probes
    const rawServices = await runProbesWithConcurrency(portMap, DISCOVERY_DEADLINE_MS);

    // Deduplicate
    const services = dedupeServices(rawServices);

    // Sort by score (desc), then port (asc)
    services.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.port - b.port;
    });

    // Filter to online only (unless includeOffline requested)
    const filteredServices = options?.includeOffline
      ? services
      : services.filter((s) => s.status === 'online');

    // Determine recommended URL
    const recommendedUrl = filteredServices.length > 0 ? filteredServices[0].url : null;

    const durationMs = Date.now() - startTime;

    logger.core.info('Preview URL discovery complete', {
      cwd,
      servicesFound: filteredServices.length,
      recommendedUrl,
      durationMs,
    });

    return {
      success: true,
      cwd,
      services: filteredServices,
      recommendedUrl,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    logger.core.error('Preview URL discovery failed', {
      error: error instanceof Error ? error.message : String(error),
      durationMs,
    });

    return {
      success: false,
      cwd,
      services: [],
      recommendedUrl: null,
      error: error instanceof Error ? error.message : 'Discovery failed',
      durationMs,
    };
  }
}
