export type DiscoverySource = 'env' | 'package-script' | 'common-port' | 'saved-preference';

export interface DiscoveredPreviewService {
  id: string;
  url: string;
  host: string;
  port: number;
  scope: 'loopback' | 'lan';
  status: 'online' | 'offline';
  source: DiscoverySource[];
  score: number;
  title?: string;
  poweredBy?: string;
  frameworkGuess?: string;
  lastCheckedAt: number;
  responseTimeMs?: number;
}

export interface PreviewDiscoveryResult {
  success: boolean;
  cwd: string | null;
  services: DiscoveredPreviewService[];
  recommendedUrl: string | null;
  error?: string;
  durationMs: number;
}

export interface PreviewDiscoveryOptions {
  forceRefresh?: boolean;
  includeOffline?: boolean;
}
