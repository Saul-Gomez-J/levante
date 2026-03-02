import { ENV_DEFAULTS } from '../../shared/envDefaults';

/**
 * Levante Platform base URL.
 * Resolved at build time by Vite:
 *   - import.meta.env.DEV = true  → development (pnpm dev)
 *   - import.meta.env.DEV = false → production  (pnpm make / CI)
 */
export const LEVANTE_PLATFORM_URL: string = import.meta.env.DEV
  ? ENV_DEFAULTS.development.LEVANTE_PLATFORM_URL
  : ENV_DEFAULTS.production.LEVANTE_PLATFORM_URL;
