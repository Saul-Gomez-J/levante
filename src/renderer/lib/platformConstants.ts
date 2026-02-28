/**
 * Levante Platform base URL.
 * Injected at build time by vite.renderer.config.ts:
 *   - development:  http://localhost:3000  (or LEVANTE_PLATFORM_URL env var)
 *   - production:   https://platform.levanteapp.com  (or LEVANTE_PLATFORM_URL env var)
 */
export const LEVANTE_PLATFORM_URL: string = __LEVANTE_PLATFORM_URL__;
