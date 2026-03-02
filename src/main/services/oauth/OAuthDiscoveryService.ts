import { getLogger } from '../logging';
import { OAUTH_REDIRECT_URI } from './constants';
import type {
    ProtectedResourceMetadata,
    AuthorizationServerMetadata,
    WWWAuthenticateParams,
    CachedMetadata,
    DiscoveryResult,
    OAuthClientRegistrationRequest,
    OAuthClientRegistrationResponse,
    OAuthClientCredentials,
    ClientRegistrationOptions,
} from './types';
import { OAuthDiscoveryError, ClientRegistrationError } from './types';

/**
 * OAuthDiscoveryService
 *
 * Implementa discovery automático de OAuth 2.1 según:
 * - RFC 9728: OAuth 2.0 Protected Resource Metadata
 * - RFC 8414: OAuth 2.0 Authorization Server Metadata
 *
 * Features:
 * - Discovery de authorization servers desde protected resources
 * - Fetching de metadata de authorization servers
 * - Parsing de WWW-Authenticate headers
 * - Cache de metadata con TTL
 * - Validación completa según RFCs
 */
export class OAuthDiscoveryService {
    private logger = getLogger();
    private metadataCache = new Map<string, CachedMetadata<AuthorizationServerMetadata>>();
    private resourceCache = new Map<string, CachedMetadata<ProtectedResourceMetadata>>();

    private readonly DEFAULT_CACHE_TTL = 60 * 60 * 1000; // 1 hora
    private readonly PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';
    private readonly AUTH_SERVER_PATH = '/.well-known/oauth-authorization-server';

    /**
     * Descubre authorization servers desde un protected resource (MCP server)
     * Implementa RFC 9728
     */
    async discoverAuthServer(resourceUrl: string): Promise<ProtectedResourceMetadata> {
        try {
            this.logger.mcp.info('Discovering authorization servers', {
                resourceUrl,
            });

            // Check cache first
            const cached = this.getFromCache(this.resourceCache, resourceUrl);
            if (cached) {
                this.logger.mcp.debug('Using cached protected resource metadata', {
                    resourceUrl,
                });
                return cached;
            }

            const metadataUrls = this.buildProtectedResourceMetadataUrls(resourceUrl);
            this.logger.mcp.debug('Fetching protected resource metadata (candidates)', {
                resourceUrl,
                metadataUrls,
            });

            let lastError: OAuthDiscoveryError | null = null;

            for (const metadataUrl of metadataUrls) {
                try {
                    this.logger.mcp.debug('Attempting protected resource metadata fetch', {
                        metadataUrl,
                    });

                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 15000);

                    let response: Response;
                    try {
                        response = await fetch(metadataUrl, {
                            method: 'GET',
                            headers: {
                                Accept: 'application/json',
                            },
                            signal: controller.signal,
                        });
                    } finally {
                        clearTimeout(timeoutId);
                    }

                    if (!response.ok) {
                        const errorCode =
                            response.status === 404 || response.status === 410
                                ? 'METADATA_NOT_SUPPORTED'
                                : 'METADATA_FETCH_FAILED';

                        const error = new OAuthDiscoveryError(
                            `Failed to fetch protected resource metadata: ${response.status} ${response.statusText}`,
                            errorCode,
                            {
                                status: response.status,
                                statusText: response.statusText,
                                url: metadataUrl,
                            }
                        );

                        lastError = error;

                        if (errorCode === 'METADATA_NOT_SUPPORTED') {
                            this.logger.mcp.warn('Protected resource metadata endpoint not supported', {
                                metadataUrl,
                                status: response.status,
                            });
                            // Try next candidate
                            continue;
                        }

                        this.logger.mcp.error('Protected resource metadata fetch failed', {
                            metadataUrl,
                            status: response.status,
                        });
                        // Try next candidate as well
                        continue;
                    }

                    const metadata = (await response.json()) as ProtectedResourceMetadata;

                    // Validar metadata
                    this.validateProtectedResourceMetadata(metadata, resourceUrl);

                    // Cache metadata
                    this.saveToCache(this.resourceCache, resourceUrl, metadata);

                    this.logger.mcp.info('Authorization servers discovered', {
                        resourceUrl,
                        authorizationServers: metadata.authorization_servers,
                        metadataUrl,
                    });

                    return metadata;
                } catch (error) {
                    if (error instanceof OAuthDiscoveryError) {
                        lastError = error;
                    } else {
                        lastError = new OAuthDiscoveryError(
                            `Failed to fetch protected resource metadata: ${error instanceof Error ? error.message : String(error)}`,
                            'NETWORK_ERROR',
                            { error, url: metadataUrl }
                        );
                    }

                    this.logger.mcp.warn('Protected resource metadata fetch attempt failed', {
                        metadataUrl,
                        error: error instanceof Error ? error.message : error,
                    });
                    // Try next candidate
                }
            }

            if (lastError) {
                throw lastError;
            }

            throw new OAuthDiscoveryError(
                'Failed to fetch protected resource metadata',
                'METADATA_FETCH_FAILED',
                { resourceUrl, metadataUrls }
            );
        } catch (error) {
            if (error instanceof OAuthDiscoveryError) {
                throw error;
            }

            this.logger.mcp.error('Failed to discover authorization servers', {
                resourceUrl,
                error: error instanceof Error ? error.message : error,
            });

            throw new OAuthDiscoveryError(
                'Failed to discover authorization servers',
                'NETWORK_ERROR',
                { error, resourceUrl }
            );
        }
    }

    /**
     * Obtiene metadata completo de un authorization server
     * Implementa RFC 8414 con fallback para paths
     */
    async fetchServerMetadata(
        authServerUrl: string
    ): Promise<AuthorizationServerMetadata> {
        try {
            this.logger.oauth.info('Fetching authorization server metadata', {
                authServerUrl,
            });

            // Check cache first
            const cached = this.getFromCache(this.metadataCache, authServerUrl);
            if (cached) {
                this.logger.oauth.debug('Using cached authorization server metadata', {
                    authServerUrl,
                });
                return cached;
            }

            // Construir URLs candidatas (RFC 8414 con fallback)
            const metadataUrls = this.buildAuthServerMetadataUrls(authServerUrl);

            this.logger.oauth.info('Fetching authorization server metadata (candidates)', {
                authServerUrl,
                metadataUrls,
            });

            let lastError: OAuthDiscoveryError | null = null;

            for (const metadataUrl of metadataUrls) {
                try {
                    this.logger.oauth.info('Attempting authorization server metadata fetch', {
                        metadataUrl,
                    });

                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 15000);

                    let response: Response;
                    try {
                        response = await fetch(metadataUrl, {
                            method: 'GET',
                            headers: {
                                Accept: 'application/json',
                            },
                            signal: controller.signal,
                        });
                    } finally {
                        clearTimeout(timeoutId);
                    }

                    if (!response.ok) {
                        const errorCode =
                            response.status === 404 || response.status === 410
                                ? 'METADATA_NOT_SUPPORTED'
                                : 'METADATA_FETCH_FAILED';

                        lastError = new OAuthDiscoveryError(
                            `Failed to fetch authorization server metadata: ${response.status} ${response.statusText}`,
                            errorCode,
                            {
                                status: response.status,
                                statusText: response.statusText,
                                url: metadataUrl,
                            }
                        );

                        this.logger.oauth.debug('Authorization server metadata fetch failed, trying next', {
                            metadataUrl,
                            status: response.status,
                        });
                        continue;
                    }

                    const metadata = (await response.json()) as AuthorizationServerMetadata;

                    // Validar metadata
                    this.validateAuthServerMetadata(metadata, authServerUrl);

                    // Cache metadata
                    this.saveToCache(this.metadataCache, authServerUrl, metadata);

                    this.logger.oauth.info('Authorization server metadata fetched', {
                        authServerUrl,
                        metadataUrl,
                        authorizationEndpoint: metadata.authorization_endpoint,
                        tokenEndpoint: metadata.token_endpoint,
                        hasRegistrationEndpoint: !!metadata.registration_endpoint,
                    });

                    return metadata;
                } catch (error) {
                    if (error instanceof OAuthDiscoveryError) {
                        lastError = error;
                    } else {
                        lastError = new OAuthDiscoveryError(
                            `Failed to fetch authorization server metadata: ${error instanceof Error ? error.message : String(error)}`,
                            'NETWORK_ERROR',
                            { error, url: metadataUrl }
                        );
                    }

                    this.logger.oauth.warn('Authorization server metadata fetch attempt failed', {
                        metadataUrl,
                        error: error instanceof Error ? error.message : error,
                    });
                }
            }

            // Si llegamos aquí, ninguna URL funcionó
            if (lastError) {
                throw lastError;
            }

            throw new OAuthDiscoveryError(
                'Failed to fetch authorization server metadata from all candidates',
                'METADATA_FETCH_FAILED',
                { authServerUrl, metadataUrls }
            );
        } catch (error) {
            if (error instanceof OAuthDiscoveryError) {
                throw error;
            }

            this.logger.oauth.error('Failed to fetch authorization server metadata', {
                authServerUrl,
                error: error instanceof Error ? error.message : error,
            });

            throw new OAuthDiscoveryError(
                'Failed to fetch authorization server metadata',
                'NETWORK_ERROR',
                { error, authServerUrl }
            );
        }
    }

    /**
     * Parsea WWW-Authenticate header
     * Formato: Bearer realm="mcp", resource_metadata="https://..."
     */
    parseWWWAuthenticate(header: string): WWWAuthenticateParams {
        try {
            // DEBUG: Log raw header
            this.logger.oauth.debug('🔍 Parsing WWW-Authenticate header (RAW)', {
                headerLength: header.length,
                rawHeader: header
            });

            const result: WWWAuthenticateParams = {};

            // Extraer scheme (e.g., "Bearer")
            const schemeMatch = header.match(/^(\w+)\s+/);
            if (schemeMatch) {
                result.scheme = schemeMatch[1];
                this.logger.oauth.debug('Scheme extracted', { scheme: result.scheme });
            }

            // Extraer parámetros
            // Formato: key="value" o key=value
            const paramRegex = /(\w+)=(?:"([^"]*)"|([^\s,]*))/g;
            let match;
            const extractedParams: Record<string, string> = {};

            while ((match = paramRegex.exec(header)) !== null) {
                const key = match[1];
                const value = match[2] || match[3]; // Quoted o unquoted

                // DEBUG: Log cada parámetro extraído
                extractedParams[key] = value;

                switch (key) {
                    case 'realm':
                        result.realm = value;
                        break;
                    case 'as_uri':
                        result.as_uri = value;
                        break;
                    case 'resource_metadata':
                        result.resource_metadata = value;
                        break;
                    case 'error':
                        result.error = value;
                        break;
                    case 'error_description':
                        result.error_description = value;
                        break;
                    case 'scope':
                        result.scope = value;
                        break;
                }
            }

            // DEBUG: Log all extracted params
            this.logger.oauth.debug('🔍 All parameters extracted from WWW-Authenticate', {
                extractedParams,
                paramCount: Object.keys(extractedParams).length
            });

            this.logger.oauth.debug('WWW-Authenticate header parsed (FINAL RESULT)', {
                scheme: result.scheme,
                realm: result.realm,
                as_uri: result.as_uri,
                resource_metadata: result.resource_metadata,
                hasResourceMetadata: !!result.resource_metadata,
                hasAsUri: !!result.as_uri,
                hasError: !!result.error,
            });

            return result;
        } catch (error) {
            this.logger.oauth.error('Failed to parse WWW-Authenticate header', {
                error: error instanceof Error ? error.message : error,
            });

            throw new OAuthDiscoveryError(
                'Failed to parse WWW-Authenticate header',
                'PARSE_ERROR',
                { error, header }
            );
        }
    }

    /**
     * Discovery completo desde un MCP server con 401 response
     * 1. Parse WWW-Authenticate header (si existe)
     * 2. Discover protected resource metadata
     * 3. Fetch authorization server metadata
     */
    async discoverFromUnauthorized(
        resourceUrl: string,
        wwwAuthenticateHeader?: string
    ): Promise<DiscoveryResult> {
        try {
            this.logger.mcp.info('Starting discovery from unauthorized response', {
                resourceUrl,
                hasWWWAuthenticate: !!wwwAuthenticateHeader,
            });

            // 1. Parse WWW-Authenticate header si existe
            let asUri: string | undefined;
            let resourceMetadataHint: string | undefined;
            if (wwwAuthenticateHeader) {
                this.logger.mcp.debug('🔍 About to parse WWW-Authenticate header', {
                    headerLength: wwwAuthenticateHeader.length,
                    headerPreview: wwwAuthenticateHeader.substring(0, 200)
                });

                const parsed = this.parseWWWAuthenticate(wwwAuthenticateHeader);
                asUri = parsed.as_uri;
                resourceMetadataHint = parsed.resource_metadata;

                this.logger.mcp.debug('🔍 WWW-Authenticate parsing completed', {
                    asUri,
                    hasAsUri: !!asUri,
                    resourceMetadata: parsed.resource_metadata,
                    hasResourceMetadata: !!parsed.resource_metadata,
                    scheme: parsed.scheme,
                    realm: parsed.realm,
                    allParsedKeys: Object.keys(parsed)
                });
            }

            // 2. Determinar authorization server URL
            let authServerUrl: string | undefined;

            if (asUri) {
                // Si tenemos as_uri en WWW-Authenticate, usarlo directamente
                // NO necesitamos hacer discovery adicional (RFC 6750)
                authServerUrl = asUri;
                this.logger.mcp.info('Using as_uri from WWW-Authenticate header', {
                    authServerUrl,
                    note: 'Skipping .well-known/oauth-protected-resource discovery',
                });
            }

            // 2b. Si hay resource_metadata en el header, úsalo para descubrir el issuer
            if (!authServerUrl && resourceMetadataHint) {
                this.logger.mcp.info('Using resource_metadata from WWW-Authenticate header', {
                    resourceMetadataUrl: resourceMetadataHint,
                });

                try {
                    const metadata = await this.fetchProtectedResourceMetadata(
                        resourceMetadataHint,
                        resourceUrl
                    );

                    authServerUrl = metadata.authorization_servers?.[0];

                    this.logger.mcp.info('Authorization server discovered from resource_metadata', {
                        authServerUrl,
                    });
                } catch (metadataError) {
                    this.logger.mcp.warn('Failed to use resource_metadata hint, continuing discovery', {
                        resourceMetadataUrl: resourceMetadataHint,
                        error: metadataError instanceof Error ? metadataError.message : metadataError,
                    });
                }
            }

            // 2c. Fallback: Intentar discovery desde protected resource metadata (RFC 9728)
            if (!authServerUrl) {
                this.logger.mcp.info('No as_uri/resource_metadata, attempting RFC 9728 discovery');

                try {
                    const protectedResource = await this.discoverAuthServer(resourceUrl);
                    authServerUrl = protectedResource.authorization_servers[0];

                    this.logger.mcp.info('Authorization server discovered from protected resource', {
                        authServerUrl,
                    });
                } catch (discoveryError) {
                    this.logger.mcp.warn('Protected resource discovery failed, will try origin auth-server', {
                        resourceUrl,
                        error: discoveryError instanceof Error ? discoveryError.message : discoveryError,
                    });
                }
            }

            // 2d. Fallback final: intentar auth-server well-known en el origin
            if (!authServerUrl) {
                const origin = new URL(resourceUrl).origin;
                this.logger.mcp.info('Falling back to authorization server well-known at origin', {
                    resourceUrl,
                    origin,
                });

                authServerUrl = origin;
            }

            if (!authServerUrl) {
                throw new OAuthDiscoveryError(
                    'No authorization server found (no hints and no fallback available)',
                    'INVALID_METADATA',
                    { resourceUrl }
                );
            }

            // 3. Fetch authorization server metadata
            const metadata = await this.fetchServerMetadata(authServerUrl);

            this.logger.mcp.info('Discovery completed', {
                resourceUrl,
                authorizationServer: authServerUrl,
                fromCache: false,
            });

            return {
                authorizationServer: authServerUrl,
                metadata,
                fromCache: false,
            };
        } catch (error) {
            this.logger.mcp.error('Discovery from unauthorized failed', {
                resourceUrl,
                error: error instanceof Error ? error.message : error,
            });

            throw error;
        }
    }

    /**
     * Limpia metadata expirado del cache
     */
    cleanExpiredCache(): number {
        const now = Date.now();
        let cleanedCount = 0;

        // Limpiar metadata cache
        for (const [key, cached] of this.metadataCache.entries()) {
            if (now >= cached.expiresAt) {
                this.metadataCache.delete(key);
                cleanedCount++;
            }
        }

        // Limpiar resource cache
        for (const [key, cached] of this.resourceCache.entries()) {
            if (now >= cached.expiresAt) {
                this.resourceCache.delete(key);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            this.logger.oauth.debug('Expired metadata cache cleaned', {
                count: cleanedCount,
            });
        }

        return cleanedCount;
    }

    /**
     * Limpia todo el cache (útil para testing)
     */
    clearCache(): void {
        const totalCount =
            this.metadataCache.size + this.resourceCache.size;

        this.metadataCache.clear();
        this.resourceCache.clear();

        this.logger.oauth.debug('All metadata cache cleared', {
            count: totalCount,
        });
    }

    /**
     * Obtiene estadísticas del cache
     */
    getCacheStats() {
        return {
            metadataCount: this.metadataCache.size,
            resourceCount: this.resourceCache.size,
            total: this.metadataCache.size + this.resourceCache.size,
        };
    }

    // ========== Private Methods ==========

    /**
     * Construye las URLs posibles para metadata de protected resource,
     * probando primero la variante path-aware y luego la raíz.
     */
    private buildProtectedResourceMetadataUrls(resourceUrl: string): string[] {
        const parsed = new URL(resourceUrl);
        const origin = parsed.origin;
        const normalizedPath = parsed.pathname.replace(/\/$/, '');
        const urls: string[] = [];

        if (normalizedPath && normalizedPath !== '/') {
            urls.push(`${origin}${this.PROTECTED_RESOURCE_PATH}${normalizedPath}`);
        }

        urls.push(`${origin}${this.PROTECTED_RESOURCE_PATH}`);
        return urls;
    }

    /**
     * Construye las URLs posibles para metadata de authorization server.
     * Según RFC 8414, debe preservar el path del authorization server.
     *
     * Orden de prioridad:
     * 1. Path preservado + /.well-known/oauth-authorization-server (RFC 8414 correcto)
     * 2. Origin + /.well-known/oauth-authorization-server (fallback)
     */
    private buildAuthServerMetadataUrls(authServerUrl: string): string[] {
        const parsed = new URL(authServerUrl);
        const origin = parsed.origin;
        const normalizedPath = parsed.pathname.replace(/\/$/, '');
        const urls: string[] = [];

        // 1. RFC 8414: Preservar path + well-known
        if (normalizedPath && normalizedPath !== '/') {
            urls.push(`${origin}${normalizedPath}${this.AUTH_SERVER_PATH}`);
        }

        // 2. Fallback: Origin + well-known (comportamiento actual)
        urls.push(`${origin}${this.AUTH_SERVER_PATH}`);

        return urls;
    }

    /**
     * Fetch de metadata de protected resource desde una URL específica (hint).
     */
    private async fetchProtectedResourceMetadata(
        metadataUrl: string,
        resourceUrl: string
    ): Promise<ProtectedResourceMetadata> {
        this.logger.mcp.debug('Fetching protected resource metadata (hint)', {
            metadataUrl,
            resourceUrl,
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        let response: Response;
        try {
            response = await fetch(metadataUrl, {
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeoutId);
        }

        if (!response.ok) {
            throw new OAuthDiscoveryError(
                `Failed to fetch protected resource metadata from hint: ${response.status} ${response.statusText}`,
                response.status === 404 || response.status === 410
                    ? 'METADATA_NOT_SUPPORTED'
                    : 'METADATA_FETCH_FAILED',
                {
                    status: response.status,
                    statusText: response.statusText,
                    url: metadataUrl,
                }
            );
        }

        const metadata = (await response.json()) as ProtectedResourceMetadata;
        this.validateProtectedResourceMetadata(metadata, resourceUrl);
        return metadata;
    }

    /**
     * Valida metadata de protected resource (RFC 9728)
     */
    private validateProtectedResourceMetadata(
        metadata: ProtectedResourceMetadata,
        resourceUrl: string
    ): void {
        // Verificar campo obligatorio: resource
        if (!metadata.resource) {
            throw new OAuthDiscoveryError(
                'Protected resource metadata missing "resource" field',
                'INVALID_METADATA',
                { metadata }
            );
        }

        // Verificar campo obligatorio: authorization_servers
        if (
            !metadata.authorization_servers ||
            !Array.isArray(metadata.authorization_servers) ||
            metadata.authorization_servers.length === 0
        ) {
            throw new OAuthDiscoveryError(
                'Protected resource metadata missing or invalid "authorization_servers"',
                'INVALID_METADATA',
                { metadata }
            );
        }

        // RFC 9728 Section 7.6: Validar que resource URI coincida con el origin
        const resourceUri = new URL(metadata.resource);
        const actualUri = new URL(resourceUrl);

        if (resourceUri.origin !== actualUri.origin) {
            throw new OAuthDiscoveryError(
                'Resource URI in metadata does not match actual resource origin',
                'VALIDATION_FAILED',
                {
                    metadataResource: metadata.resource,
                    actualResource: resourceUrl,
                }
            );
        }

        this.logger.mcp.debug('Protected resource metadata validated', {
            resource: metadata.resource,
            authServerCount: metadata.authorization_servers.length,
        });
    }

    /**
     * Valida metadata de authorization server (RFC 8414)
     */
    private validateAuthServerMetadata(
        metadata: AuthorizationServerMetadata,
        authServerUrl: string
    ): void {
        // Campos obligatorios según RFC 8414
        const requiredFields = [
            'issuer',
            'authorization_endpoint',
            'token_endpoint',
            'response_types_supported',
        ] as const;

        for (const field of requiredFields) {
            if (!metadata[field]) {
                throw new OAuthDiscoveryError(
                    `Authorization server metadata missing required field: ${field}`,
                    'INVALID_METADATA',
                    { metadata, missingField: field }
                );
            }
        }

        // Validar que el issuer coincida con el auth server URL
        // RFC 8414 Section 3: issuer debe ser el mismo que la URL del AS
        const issuerUrl = new URL(metadata.issuer);
        const asUrl = new URL(authServerUrl);

        if (issuerUrl.origin !== asUrl.origin) {
            this.logger.oauth.warn('Issuer origin does not match auth server origin', {
                issuer: metadata.issuer,
                authServerUrl,
            });
            // No lanzar error, solo advertencia (algunos servers pueden tener discrepancias)
        }

        // Validar PKCE support (OAuth 2.1 requirement)
        if (!metadata.code_challenge_methods_supported) {
            throw new OAuthDiscoveryError(
                'Authorization server does not advertise PKCE support',
                'PKCE_NOT_SUPPORTED',
                { metadata }
            );
        }

        if (!metadata.code_challenge_methods_supported.includes('S256')) {
            throw new OAuthDiscoveryError(
                'Authorization server does not support PKCE with S256',
                'PKCE_NOT_SUPPORTED',
                {
                    metadata,
                    supportedMethods: metadata.code_challenge_methods_supported,
                }
            );
        }

        // Validar HTTPS para endpoints (excepto localhost)
        const endpoints = [
            metadata.authorization_endpoint,
            metadata.token_endpoint,
            metadata.revocation_endpoint,
            metadata.registration_endpoint,
        ].filter(Boolean) as string[];

        for (const endpoint of endpoints) {
            this.validateEndpointUrl(endpoint);
        }

        this.logger.oauth.debug('Authorization server metadata validated', {
            issuer: metadata.issuer,
            supportsPKCE: true,
            hasRegistrationEndpoint: !!metadata.registration_endpoint,
            hasRevocationEndpoint: !!metadata.revocation_endpoint,
        });
    }

    /**
     * Valida que un endpoint use HTTPS (excepto localhost)
     */
    private validateEndpointUrl(url: string): void {
        const parsed = new URL(url);

        // Permitir http solo para localhost/127.0.0.1
        if (parsed.protocol === 'http:') {
            const isLocalhost =
                parsed.hostname === 'localhost' ||
                parsed.hostname === '127.0.0.1' ||
                parsed.hostname === '[::1]';

            if (!isLocalhost) {
                this.logger.oauth.warn('Endpoint using HTTP instead of HTTPS', {
                    url,
                    hostname: parsed.hostname,
                });
                // No lanzar error, solo advertencia (algunos servers de desarrollo pueden usar HTTP)
            }
        }
    }

    /**
     * Obtiene valor del cache si existe y no está expirado
     */
    private getFromCache<T>(
        cache: Map<string, CachedMetadata<T>>,
        key: string
    ): T | null {
        const cached = cache.get(key);

        if (!cached) {
            return null;
        }

        // Verificar expiración
        if (Date.now() >= cached.expiresAt) {
            cache.delete(key);
            return null;
        }

        return cached.data;
    }

    /**
     * Guarda valor en cache con TTL
     */
    private saveToCache<T>(
        cache: Map<string, CachedMetadata<T>>,
        key: string,
        data: T,
        ttl: number = this.DEFAULT_CACHE_TTL
    ): void {
        const now = Date.now();

        cache.set(key, {
            data,
            cachedAt: now,
            expiresAt: now + ttl,
        });

        // Auto-cleanup después del TTL
        setTimeout(() => {
            cache.delete(key);
        }, ttl);
    }

    /**
     * RFC 7591: Dynamic Client Registration
     *
     * Registers Levante as an OAuth client with the Authorization Server
     *
     * @param registrationEndpoint - The registration endpoint from AS metadata
     * @param authServerId - The Authorization Server identifier
     * @returns Client credentials (clientId and optional clientSecret)
     * @throws ClientRegistrationError if registration fails
     */
    async registerClient(
        registrationEndpoint: string,
        authServerId: string,
        options?: ClientRegistrationOptions
    ): Promise<OAuthClientCredentials> {
        this.logger.mcp.info('Attempting Dynamic Client Registration', {
            registrationEndpoint,
            authServerId,
            redirectUris: options?.redirectUris,
            preferConfidential: options?.preferConfidential ?? false,
            requestedAuthMethod: options?.tokenEndpointAuthMethod ?? 'none',
        });

        // Validate HTTPS (except localhost)
        const url = new URL(registrationEndpoint);
        if (
            url.protocol === 'http:' &&
            !['127.0.0.1', 'localhost'].includes(url.hostname)
        ) {
            throw new ClientRegistrationError(
                'Registration endpoint must use HTTPS',
                'invalid_endpoint'
            );
        }

        // Determinar método de autenticación
        const authMethod = options?.preferConfidential
            ? (options.tokenEndpointAuthMethod ?? 'client_secret_post')
            : 'none';

        // Prepare registration request (RFC 7591)
        const registrationRequest: OAuthClientRegistrationRequest = {
            client_name: 'Levante',
            client_uri: 'https://github.com/levante-hub/levante',
            // Required by some AS (Supabase) to allow loopback redirect URIs
            application_type: 'native',

            // Siempre usar el redirect_uri fijo
            // Si se proporciona options.redirectUris, debe contener el URI fijo
            redirect_uris: options?.redirectUris || [OAUTH_REDIRECT_URI],

            // Grant types for Authorization Code Flow with PKCE
            grant_types: ['authorization_code', 'refresh_token'],

            // Response type for Authorization Code Flow
            response_types: ['code'],

            // Public client (no client secret needed for PKCE)
            token_endpoint_auth_method: authMethod,
        };

        // Validar que si se proporcionan redirectUris, incluyan el fijo
        if (options?.redirectUris && !options.redirectUris.includes(OAUTH_REDIRECT_URI)) {
            this.logger.mcp.warn('Provided redirectUris do not include fixed URI, adding it', {
                provided: options.redirectUris,
                fixedUri: OAUTH_REDIRECT_URI,
            });
            registrationRequest.redirect_uris = [OAUTH_REDIRECT_URI, ...options.redirectUris];
        }

        this.logger.mcp.debug('Registration request prepared', {
            authMethod,
            redirectUris: registrationRequest.redirect_uris,
            usingFixedPort: registrationRequest.redirect_uris.includes(OAUTH_REDIRECT_URI),
        });

        try {
            // POST to registration endpoint
            const response = await fetch(registrationEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify(registrationRequest),
            });

            if (!response.ok) {
                // Parse error response (and keep raw for debugging)
                let errorData: any = {};
                let rawBody = '';
                try {
                    rawBody = await response.text();
                    errorData = rawBody ? JSON.parse(rawBody) : {};
                } catch {
                    // Leave errorData as empty object; rawBody already captured
                }

                this.logger.mcp.error('Client registration failed', {
                    status: response.status,
                    error: errorData.error,
                    description: errorData.error_description,
                    rawBody,
                });

                throw new ClientRegistrationError(
                    errorData.error_description ||
                    errorData.message ||
                    rawBody ||
                    `Registration failed: ${errorData.error || response.status}`,
                    errorData.error || 'registration_failed',
                    response.status
                );
            }

            // Parse successful response
            const data: OAuthClientRegistrationResponse =
                (await response.json()) as OAuthClientRegistrationResponse;

            // Validate required fields
            if (!data.client_id) {
                throw new ClientRegistrationError(
                    'Registration response missing client_id',
                    'invalid_response'
                );
            }

            this.logger.mcp.info('Dynamic Client Registration successful', {
                clientId: data.client_id,
                hasClientSecret: !!data.client_secret,
                authServerId,
            });

            // Determinar el auth method efectivo basado en si recibimos client_secret
            const effectiveAuthMethod = data.client_secret
                ? (options?.tokenEndpointAuthMethod ?? 'client_secret_post')
                : 'none';

            // Build credentials object
            const credentials: OAuthClientCredentials = {
                clientId: data.client_id,
                clientSecret: data.client_secret, // Will be encrypted when saved
                registeredAt: Date.now(),
                authServerId,
                tokenEndpointAuthMethod: effectiveAuthMethod,
                registrationMetadata: {
                    client_secret_expires_at: data.client_secret_expires_at,
                    registration_access_token: data.registration_access_token,
                    registration_client_uri: data.registration_client_uri,
                },
            };

            this.logger.mcp.debug('Client credentials built', {
                clientId: data.client_id,
                hasSecret: !!data.client_secret,
                authMethod: effectiveAuthMethod,
            });

            return credentials;
        } catch (error) {
            if (error instanceof ClientRegistrationError) {
                throw error;
            }

            // Network or parsing error
            this.logger.mcp.error('Client registration error', {
                error: error instanceof Error ? error.message : error,
                registrationEndpoint,
            });

            throw new ClientRegistrationError(
                `Failed to register client: ${error instanceof Error ? error.message : 'Unknown error'
                }`,
                'network_error'
            );
        }
    }

    /**
     * Helper: Check if Authorization Server supports Dynamic Client Registration
     *
     * @param metadata - Authorization Server metadata
     * @returns true if registration_endpoint is present
     */
    supportsClientRegistration(metadata: AuthorizationServerMetadata): boolean {
        return !!metadata.registration_endpoint;
    }
}
