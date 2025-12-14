import { getLogger } from '../services/logging';

const logger = getLogger();

/**
 * Private IP ranges to block for SSRF prevention
 *
 * Security: Blocks access to:
 * - Private networks (RFC 1918)
 * - Localhost/loopback
 * - Link-local addresses
 * - Cloud metadata endpoints (AWS, GCP, Azure)
 * - Docker internal networks
 *
 * References:
 * - OWASP SSRF Prevention Cheat Sheet
 * - CWE-918: Server-Side Request Forgery (SSRF)
 */
const PRIVATE_IP_RANGES = [
  // IPv4 Private ranges (RFC 1918)
  /^10\./,                        // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./,  // 172.16.0.0/12
  /^192\.168\./,                  // 192.168.0.0/16

  // IPv4 Localhost
  /^127\./,                       // 127.0.0.0/8 (loopback)
  /^0\.0\.0\.0$/,                 // 0.0.0.0

  // IPv4 Link-local
  /^169\.254\./,                  // 169.254.0.0/16

  // IPv6 patterns
  /^::1$/,                        // IPv6 loopback
  /^fe80:/i,                      // IPv6 link-local
  /^fc00:/i,                      // IPv6 unique local
  /^fd00:/i,                      // IPv6 unique local

  // Localhost aliases
  /^localhost$/i,
];

/**
 * Common cloud metadata endpoints to block
 */
const METADATA_ENDPOINTS = [
  '169.254.169.254',  // AWS, Azure, GCP metadata
  'metadata.google.internal',
  'metadata',
];

/**
 * Allowed protocols for URL validation
 */
const ALLOWED_PROTOCOLS = ['http:', 'https:'] as const;

/**
 * Configuration for local endpoint validation
 */
interface LocalEndpointConfig {
  allowLocalhost?: boolean;
  allowPrivateNetworks?: boolean;
  allowedPorts?: number[];
  maxPort?: number;
}

/**
 * Validates if a hostname is a private/internal IP address
 *
 * @param hostname - Hostname to validate
 * @returns true if hostname is private/internal, false otherwise
 */
function isPrivateIP(hostname: string): boolean {
  // Check against private IP patterns
  for (const pattern of PRIVATE_IP_RANGES) {
    if (pattern.test(hostname)) {
      return true;
    }
  }

  // Check against metadata endpoints
  if (METADATA_ENDPOINTS.includes(hostname.toLowerCase())) {
    return true;
  }

  return false;
}

/**
 * Validates a URL for SSRF protection
 *
 * Security checks:
 * - Protocol allowlist (HTTP/HTTPS only)
 * - Private IP range blocking (with optional exceptions)
 * - Cloud metadata endpoint blocking
 * - Port range validation
 *
 * @param url - URL string to validate
 * @param config - Optional configuration for local endpoint exceptions
 *   - allowLocalhost: Allow localhost (127.0.0.1, ::1, localhost)
 *   - allowPrivateNetworks: Allow private network IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
 *   - allowedPorts: Specific ports to allow
 *   - maxPort: Maximum port number allowed
 * @returns Validation result with success status and error message
 */
export function validateUrl(
  url: string,
  config?: LocalEndpointConfig
): { valid: boolean; error?: string; parsedUrl?: URL } {
  try {
    const parsedUrl = new URL(url);

    // 1. Validate protocol
    if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol as any)) {
      return {
        valid: false,
        error: `Protocol "${parsedUrl.protocol}" is not allowed. Only HTTP and HTTPS are permitted.`
      };
    }

    // 2. Check for private IPs with granular exceptions
    const hostname = parsedUrl.hostname.toLowerCase();

    // Check if it's localhost
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

    // Check if it's a private network IP (but not localhost)
    const isPrivateNetwork = !isLocalhost && isPrivateIP(hostname);

    if (isLocalhost) {
      if (!config?.allowLocalhost) {
        return {
          valid: false,
          error: `Access to localhost is not allowed: ${hostname}`
        };
      }
      logger.core.debug('Allowing localhost endpoint', { hostname });
    } else if (isPrivateNetwork) {
      if (!config?.allowPrivateNetworks) {
        return {
          valid: false,
          error: `Access to private IP addresses and internal networks is not allowed: ${hostname}`
        };
      }
      logger.core.debug('Allowing private network endpoint', { hostname });
    }

    // 3. Validate port if specified
    if (parsedUrl.port) {
      const port = parseInt(parsedUrl.port, 10);

      if (config?.allowedPorts && !config.allowedPorts.includes(port)) {
        return {
          valid: false,
          error: `Port ${port} is not in the allowed list: ${config.allowedPorts.join(', ')}`
        };
      }

      if (config?.maxPort && port > config.maxPort) {
        return {
          valid: false,
          error: `Port ${port} exceeds maximum allowed port ${config.maxPort}`
        };
      }
    }

    return { valid: true, parsedUrl };

  } catch (error) {
    return {
      valid: false,
      error: 'Invalid URL format'
    };
  }
}

/**
 * Normalizes a user-provided endpoint URL
 * Adds http:// protocol if missing (common for local endpoints)
 *
 * @param endpoint - User-provided endpoint string
 * @returns Normalized URL string with protocol
 */
export function normalizeEndpoint(endpoint: string): string {
  // Already has protocol
  if (endpoint.match(/^https?:\/\//i)) {
    return endpoint;
  }

  // Add http:// by default for local endpoints
  return `http://${endpoint}`;
}

/**
 * Validates a user-configured endpoint URL (Local providers, Gateway, etc.)
 *
 * Permissive validation for endpoints explicitly configured by the user:
 * - Only validates protocol (http/https) and URL format
 * - No IP address restrictions (allows localhost, private IPs, public IPs, metadata endpoints)
 * - No port restrictions
 *
 * Rationale: This is an open-source desktop app where users have full control.
 * Since endpoints are manually configured (not from external sources), SSRF
 * protection is unnecessary and overly restrictive.
 *
 * @param endpoint - Endpoint URL to validate
 * @returns Validation result with success status and error message
 */
export function validateLocalEndpoint(
  endpoint: string
): { valid: boolean; error?: string; parsedUrl?: URL } {
  try {
    const parsedUrl = new URL(endpoint);

    // Only validate protocol - allow http and https
    if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol as any)) {
      return {
        valid: false,
        error: `Protocol "${parsedUrl.protocol}" is not allowed. Only HTTP and HTTPS are permitted.`
      };
    }

    return { valid: true, parsedUrl };

  } catch (error) {
    return {
      valid: false,
      error: 'Invalid URL format'
    };
  }
}

/**
 * Validates a public API endpoint URL
 *
 * Blocks all private IPs including localhost
 *
 * @param url - URL to validate
 * @returns Validation result with success status and error message
 */
export function validatePublicUrl(
  url: string
): { valid: boolean; error?: string; parsedUrl?: URL } {
  return validateUrl(url, {
    allowLocalhost: false
  });
}

/**
 * Logs a blocked URL attempt for security auditing
 *
 * @param url - Blocked URL
 * @param reason - Reason for blocking
 * @param context - Where the URL came from
 */
export function logBlockedUrl(url: string, reason: string, context: string): void {
  logger.core.warn('Blocked potentially malicious URL', {
    url: url.substring(0, 100), // Log first 100 chars only
    reason,
    context,
    timestamp: new Date().toISOString()
  });
}

/**
 * Adds timeout to fetch requests for SSRF mitigation
 *
 * Prevents indefinite hanging on malicious endpoints
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @param timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns Fetch promise with timeout
 */
export async function safeFetch(
  url: string,
  options?: RequestInit,
  timeoutMs: number = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}
