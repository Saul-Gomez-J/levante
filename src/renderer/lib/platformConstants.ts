/**
 * Levante Platform base URL.
 * Injected at build time by vite.renderer.config.ts from ENV_DEFAULTS:
 *   - development:  http://localhost:3000
 *   - production:   https://platform.levanteapp.com
 */
export const LEVANTE_PLATFORM_URL: string = __LEVANTE_PLATFORM_URL__;
