# Fase 4: HTTP Client con Auto-Refresh - Plan de Implementación Detallado

## Información del Documento

- **Versión**: 1.0
- **Fecha**: 2025-12-21
- **Estado**: Plan de implementación
- **Fase**: 4 de 6
- **Autor**: Arquitectura Levante
- **Prerequisitos**: Fases 1, 2 y 3 completadas

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Objetivos de la Fase 4](#objetivos-de-la-fase-4)
3. [Arquitectura Propuesta](#arquitectura-propuesta)
4. [Plan de Implementación Paso a Paso](#plan-de-implementación-paso-a-paso)
5. [Código Detallado de Implementación](#código-detallado-de-implementación)
6. [Testing](#testing)
7. [Consideraciones de Seguridad](#consideraciones-de-seguridad)
8. [Checklist de Implementación](#checklist-de-implementación)
9. [Troubleshooting](#troubleshooting)

---

## Resumen Ejecutivo

La Fase 4 implementa el **HTTP Client con Auto-Refresh**, integrando el sistema OAuth (Fases 1-3) con los transportes MCP existentes de Levante. Esta fase convierte el OAuth de un sistema standalone a uno completamente funcional que protege las comunicaciones HTTP con servidores MCP.

### ¿Qué se implementa en esta fase?

```
┌─────────────────────────────────────────────────────────────┐
│                    FASE 4: HTTP CLIENT                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐        ┌─────────────────────┐        │
│  │ OAuthHttpClient  │───────▶│  Auto-Refresh       │        │
│  │                  │        │  Logic              │        │
│  └──────────────────┘        └─────────────────────┘        │
│           │                                                   │
│           ▼                                                   │
│  ┌──────────────────────────────────────────────┐           │
│  │  Integration con MCP Transports              │           │
│  │  - StreamableHTTPClientTransport             │           │
│  │  - SSEClientTransport                        │           │
│  └──────────────────────────────────────────────┘           │
│           │                                                   │
│           ▼                                                   │
│  ┌──────────────────────────────────────────────┐           │
│  │  401 Handling + Retry                        │           │
│  └──────────────────────────────────────────────┘           │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Componentes Nuevos

1. **OAuthHttpClient** - Cliente HTTP con auto-refresh de tokens
2. **Modificación de transports.ts** - Integración OAuth en transportes MCP
3. **OAuthService** - Servicio orquestador de alto nivel

### Duración Estimada

- **Implementación**: 3-4 días
- **Testing**: 1-2 días
- **Total**: 5-6 días

---

## Objetivos de la Fase 4

### Objetivos Principales

1. ✅ **Interceptor HTTP**: Añadir `Authorization: Bearer <token>` a todas las requests
2. ✅ **Auto-Refresh**: Detectar tokens expirados y refrescarlos automáticamente
3. ✅ **401 Handling**: Manejar `401 Unauthorized` con retry automático
4. ✅ **Integración MCP**: Conectar OAuth con transportes HTTP/SSE existentes
5. ✅ **Error Recovery**: Manejo robusto de errores y re-autorización

### Objetivos Secundarios

- 📊 Logging detallado de operaciones OAuth
- 🔒 Validación de seguridad en cada request
- ⚡ Performance: minimizar latencia del auto-refresh
- 🧪 Cobertura de tests >80%

---

## Arquitectura Propuesta

### Diagrama de Componentes

```
┌────────────────────────────────────────────────────────────────┐
│                        Main Process                             │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              OAuthService (New)                          │  │
│  │  - authorize(serverId)                                   │  │
│  │  - ensureValidToken(serverId)                            │  │
│  │  - disconnect(serverId)                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           │                                     │
│         ┌─────────────────┼─────────────────┐                  │
│         ▼                 ▼                 ▼                   │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ TokenStore  │  │ FlowManager  │  │ Discovery    │          │
│  │ (Phase 1)   │  │ (Phase 2)    │  │ (Phase 3)    │          │
│  └─────────────┘  └──────────────┘  └──────────────┘          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │            OAuthHttpClient (New)                         │  │
│  │  - ensureValidToken(serverId)                            │  │
│  │  - handleUnauthorized(serverId, response)                │  │
│  │  - getAuthHeaders(serverId)                              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │          MCP Transports (Modified)                       │  │
│  │  - createTransport(config)                               │  │
│  │  - createOAuthTransport(config) ← NEW                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           │                                     │
└───────────────────────────┼─────────────────────────────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │  MCP Servers  │
                    │  (HTTP/SSE)   │
                    └───────────────┘
```

### Flujo de Request HTTP con OAuth

```mermaid
sequenceDiagram
    participant T as Transport
    participant OH as OAuthHttpClient
    participant TS as TokenStore
    participant FM as FlowManager
    participant AS as Auth Server
    participant MCP as MCP Server

    T->>OH: getAuthHeaders(serverId)
    OH->>TS: getTokens(serverId)
    TS-->>OH: tokens

    alt Token válido
        OH-->>T: { Authorization: "Bearer ..." }
        T->>MCP: Request con token
        MCP-->>T: 200 OK
    else Token expirado
        OH->>FM: refreshAccessToken()
        FM->>AS: POST /token (refresh_token)
        AS-->>FM: new tokens
        FM->>TS: saveTokens()
        OH-->>T: { Authorization: "Bearer ..." }
        T->>MCP: Request con nuevo token
        MCP-->>T: 200 OK
    else Token inválido (401)
        T->>MCP: Request con token
        MCP-->>T: 401 Unauthorized
        T->>OH: handleUnauthorized()
        OH->>FM: refreshAccessToken()
        FM->>AS: POST /token
        AS-->>FM: new tokens
        FM->>TS: saveTokens()
        OH-->>T: retry: true
        T->>MCP: Retry request
        MCP-->>T: 200 OK
    end
```

---

## Plan de Implementación Paso a Paso

### Paso 1: Crear OAuthHttpClient

**Archivo**: `src/main/services/oauth/OAuthHttpClient.ts`

**Responsabilidades**:
- Obtener tokens válidos para un servidor
- Detectar expiración y refrescar automáticamente
- Manejar respuestas 401
- Proveer headers de autenticación

**Duración**: 1 día

---

### Paso 2: Crear OAuthService (Orquestador)

**Archivo**: `src/main/services/oauth/OAuthService.ts`

**Responsabilidades**:
- Coordinar discovery, autorización y token management
- API de alto nivel para MCP services
- Manejo de errores y logging centralizado

**Duración**: 1 día

---

### Paso 3: Modificar MCP Transports

**Archivos**:
- `src/main/services/mcp/transports.ts`
- `src/main/services/mcp/mcpUseService.ts`
- `src/main/services/mcp/mcpLegacyService.ts`

**Cambios**:
- Detectar configuración OAuth
- Crear transportes con headers OAuth
- Manejar re-autorización en caso de fallo

**Duración**: 1 día

---

### Paso 4: Actualizar Types

**Archivo**: `src/main/services/oauth/types.ts`

**Cambios**:
- Añadir tipos para OAuthHttpClient
- Tipos de configuración OAuth en MCP

**Duración**: 2 horas

---

### Paso 5: Exports y Index

**Archivo**: `src/main/services/oauth/index.ts`

**Cambios**:
- Exportar nuevos servicios
- Re-exportar tipos

**Duración**: 1 hora

---

### Paso 6: Testing

**Archivos**:
- `src/main/services/oauth/__tests__/OAuthHttpClient.test.ts`
- `src/main/services/oauth/__tests__/OAuthService.test.ts`
- `src/main/services/oauth/__tests__/oauth-transport-integration.test.ts`

**Duración**: 1-2 días

---

### Paso 7: Documentación

**Archivos**:
- `docs/plans/fase_4_oauth.md` (este archivo)
- Actualizar `docs/plans/resumen_fases_123.md` → `resumen_fases_1234.md`

**Duración**: 3 horas

---

## Código Detallado de Implementación

### Paso 1: OAuthHttpClient.ts

**Ubicación**: `src/main/services/oauth/OAuthHttpClient.ts`

```typescript
/**
 * OAuthHttpClient - HTTP client con auto-refresh de tokens OAuth
 *
 * Responsabilidades:
 * - Obtener tokens válidos para requests HTTP
 * - Auto-refresh de tokens expirados
 * - Manejo de 401 Unauthorized
 * - Proveer headers de autenticación
 */

import { OAuthTokenStore } from './OAuthTokenStore';
import { OAuthFlowManager } from './OAuthFlowManager';
import { OAuthDiscoveryService } from './OAuthDiscoveryService';
import { PreferencesService } from '../preferences/PreferencesService';
import { getLogger } from '../logging';
import type {
  OAuthTokens,
  OAuthServerConfig,
  OAuthHttpClientError,
} from './types';

const logger = getLogger();

export class OAuthHttpClient {
  private tokenStore: OAuthTokenStore;
  private flowManager: OAuthFlowManager;
  private discoveryService: OAuthDiscoveryService;
  private preferencesService: PreferencesService;

  constructor(preferencesService: PreferencesService) {
    this.preferencesService = preferencesService;
    this.tokenStore = new OAuthTokenStore(preferencesService);
    this.flowManager = new OAuthFlowManager();
    this.discoveryService = new OAuthDiscoveryService();
  }

  /**
   * Ensure valid token exists for serverId
   * Refreshes automatically if expired
   *
   * @throws OAuthHttpClientError if no tokens or refresh fails
   */
  async ensureValidToken(serverId: string): Promise<OAuthTokens> {
    logger.core.debug('Ensuring valid token', { serverId });

    // 1. Get current tokens
    let tokens = await this.tokenStore.getTokens(serverId);

    if (!tokens) {
      throw this.createError(
        'NO_TOKENS',
        'No OAuth tokens found. Please authorize first.',
        { serverId }
      );
    }

    // 2. Check expiration
    if (this.tokenStore.isTokenExpired(tokens)) {
      logger.core.info('Access token expired, refreshing', { serverId });
      tokens = await this.refreshToken(serverId, tokens);
    }

    return tokens;
  }

  /**
   * Get authorization headers for HTTP request
   */
  async getAuthHeaders(serverId: string): Promise<Record<string, string>> {
    const tokens = await this.ensureValidToken(serverId);

    return {
      Authorization: `${tokens.tokenType} ${tokens.accessToken}`,
    };
  }

  /**
   * Handle 401 Unauthorized response
   * Attempts token refresh and returns retry decision
   *
   * @returns true if request should be retried, false otherwise
   */
  async handleUnauthorized(
    serverId: string,
    response: Response
  ): Promise<boolean> {
    logger.core.warn('Received 401 Unauthorized', {
      serverId,
      status: response.status,
    });

    // Parse WWW-Authenticate header for diagnostics
    const wwwAuth = response.headers.get('WWW-Authenticate');
    if (wwwAuth) {
      const parsed = this.discoveryService.parseWWWAuthenticate(wwwAuth);
      logger.core.debug('WWW-Authenticate header', {
        serverId,
        parsed,
      });
    }

    try {
      // Get current tokens
      const tokens = await this.tokenStore.getTokens(serverId);

      if (!tokens?.refreshToken) {
        logger.core.error('No refresh token available', { serverId });
        return false;
      }

      // Attempt refresh
      await this.refreshToken(serverId, tokens);

      logger.core.info('Token refreshed after 401, retry possible', {
        serverId,
      });

      return true; // Retry the request
    } catch (error) {
      logger.core.error('Failed to handle 401', {
        serverId,
        error: error instanceof Error ? error.message : error,
      });

      return false; // Cannot retry
    }
  }

  /**
   * Refresh access token using refresh token
   *
   * @private
   */
  private async refreshToken(
    serverId: string,
    oldTokens: OAuthTokens
  ): Promise<OAuthTokens> {
    if (!oldTokens.refreshToken) {
      throw this.createError(
        'NO_REFRESH_TOKEN',
        'No refresh token available. Re-authorization required.',
        { serverId }
      );
    }

    try {
      // 1. Get OAuth config from preferences
      const oauthConfig = await this.getOAuthConfig(serverId);

      // 2. Get auth server metadata
      const metadata = await this.discoveryService.fetchServerMetadata(
        oauthConfig.authServerId
      );

      logger.core.debug('Refreshing token', {
        serverId,
        tokenEndpoint: metadata.token_endpoint,
      });

      // 3. Refresh tokens
      const newTokens = await this.flowManager.refreshAccessToken({
        tokenEndpoint: metadata.token_endpoint,
        refreshToken: oldTokens.refreshToken,
        clientId: oauthConfig.clientId,
        clientSecret: oauthConfig.clientSecret,
      });

      // 4. Save new tokens
      await this.tokenStore.saveTokens(serverId, newTokens);

      logger.core.info('Successfully refreshed access token', {
        serverId,
        expiresAt: new Date(newTokens.expiresAt).toISOString(),
      });

      return newTokens;
    } catch (error) {
      logger.core.error('Failed to refresh token', {
        serverId,
        error: error instanceof Error ? error.message : error,
      });

      // Delete invalid tokens
      await this.tokenStore.deleteTokens(serverId);

      throw this.createError(
        'REFRESH_FAILED',
        'Token refresh failed. Re-authorization required.',
        {
          serverId,
          originalError: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Get OAuth configuration for server
   *
   * @private
   */
  private async getOAuthConfig(serverId: string): Promise<OAuthServerConfig> {
    const config = await this.preferencesService.get(
      `mcpServers.${serverId}.oauth`
    );

    if (!config) {
      throw this.createError(
        'NO_OAUTH_CONFIG',
        'OAuth configuration not found for server',
        { serverId }
      );
    }

    return config as OAuthServerConfig;
  }

  /**
   * Create typed error
   *
   * @private
   */
  private createError(
    code: OAuthHttpClientError['code'],
    message: string,
    details?: Record<string, unknown>
  ): OAuthHttpClientError {
    const error = new Error(message) as OAuthHttpClientError;
    error.code = code;
    error.details = details;
    return error;
  }
}
```

---

### Paso 2: OAuthService.ts

**Ubicación**: `src/main/services/oauth/OAuthService.ts`

```typescript
/**
 * OAuthService - High-level OAuth orchestrator
 *
 * Provides unified API for:
 * - Discovery and authorization
 * - Token management
 * - Connection lifecycle
 */

import { OAuthDiscoveryService } from './OAuthDiscoveryService';
import { OAuthFlowManager } from './OAuthFlowManager';
import { OAuthTokenStore } from './OAuthTokenStore';
import { OAuthHttpClient } from './OAuthHttpClient';
import { PreferencesService } from '../preferences/PreferencesService';
import { getLogger } from '../logging';
import type {
  OAuthTokens,
  AuthorizationServerMetadata,
  OAuthServiceError,
} from './types';

const logger = getLogger();

export interface AuthorizeParams {
  serverId: string;
  mcpServerUrl: string;
  scopes?: string[];
  clientId?: string;  // Optional: from Dynamic Registration in Phase 5
}

export interface AuthorizeResult {
  success: boolean;
  tokens?: OAuthTokens;
  metadata?: AuthorizationServerMetadata;
  error?: string;
}

export interface DisconnectParams {
  serverId: string;
  revokeTokens?: boolean;  // Phase 6: Token revocation
}

export class OAuthService {
  private discoveryService: OAuthDiscoveryService;
  private flowManager: OAuthFlowManager;
  private tokenStore: OAuthTokenStore;
  private httpClient: OAuthHttpClient;
  private preferencesService: PreferencesService;

  constructor(preferencesService: PreferencesService) {
    this.preferencesService = preferencesService;
    this.discoveryService = new OAuthDiscoveryService();
    this.flowManager = new OAuthFlowManager();
    this.tokenStore = new OAuthTokenStore(preferencesService);
    this.httpClient = new OAuthHttpClient(preferencesService);
  }

  /**
   * Complete OAuth authorization flow for MCP server
   *
   * Steps:
   * 1. Discovery: Find authorization server
   * 2. Authorization: Open browser, get code
   * 3. Token exchange: Get access/refresh tokens
   * 4. Save: Store tokens and config
   */
  async authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
    const { serverId, mcpServerUrl, scopes, clientId } = params;

    logger.core.info('Starting OAuth authorization', {
      serverId,
      mcpServerUrl,
    });

    try {
      // 1. Discovery
      logger.core.debug('Step 1: Discovering authorization server', {
        serverId,
      });

      const { authorizationServer, metadata } =
        await this.discoveryService.discoverFromUnauthorized(mcpServerUrl);

      logger.core.info('Authorization server discovered', {
        serverId,
        authServer: authorizationServer,
        hasRegistration: !!metadata.registration_endpoint,
      });

      // 2. Validate client ID
      if (!clientId) {
        // Phase 5: Dynamic Client Registration
        // For now, require manual client ID
        throw this.createError(
          'NO_CLIENT_ID',
          'Client ID required. Dynamic registration not yet implemented.',
          { serverId }
        );
      }

      // 3. Authorization flow
      logger.core.debug('Step 2: Starting authorization flow', {
        serverId,
      });

      const { code, verifier } = await this.flowManager.authorize({
        serverId,
        authorizationEndpoint: metadata.authorization_endpoint,
        clientId,
        scopes: scopes || metadata.scopes_supported || ['mcp:read', 'mcp:write'],
        resource: mcpServerUrl,
      });

      logger.core.info('Authorization code received', {
        serverId,
      });

      // 4. Token exchange
      logger.core.debug('Step 3: Exchanging code for tokens', {
        serverId,
      });

      const tokens = await this.flowManager.exchangeCodeForTokens({
        tokenEndpoint: metadata.token_endpoint,
        code,
        redirectUri: `http://127.0.0.1/callback`, // From loopback server
        clientId,
        codeVerifier: verifier,
      });

      logger.core.info('Tokens received', {
        serverId,
        expiresAt: new Date(tokens.expiresAt).toISOString(),
      });

      // 5. Save tokens
      logger.core.debug('Step 4: Saving tokens and config', {
        serverId,
      });

      await this.tokenStore.saveTokens(serverId, tokens);

      // 6. Save OAuth config
      await this.preferencesService.set(`mcpServers.${serverId}.oauth`, {
        enabled: true,
        authServerId: authorizationServer,
        clientId,
        scopes: tokens.scope?.split(' ') || scopes,
      });

      logger.core.info('OAuth authorization completed successfully', {
        serverId,
      });

      return {
        success: true,
        tokens,
        metadata,
      };
    } catch (error) {
      logger.core.error('OAuth authorization failed', {
        serverId,
        error: error instanceof Error ? error.message : error,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Ensure valid token exists for server
   * Used by transports before making requests
   */
  async ensureValidToken(serverId: string): Promise<OAuthTokens> {
    return this.httpClient.ensureValidToken(serverId);
  }

  /**
   * Get authentication headers for HTTP request
   */
  async getAuthHeaders(serverId: string): Promise<Record<string, string>> {
    return this.httpClient.getAuthHeaders(serverId);
  }

  /**
   * Handle 401 Unauthorized response
   */
  async handleUnauthorized(
    serverId: string,
    response: Response
  ): Promise<boolean> {
    return this.httpClient.handleUnauthorized(serverId, response);
  }

  /**
   * Disconnect server and optionally revoke tokens
   */
  async disconnect(params: DisconnectParams): Promise<void> {
    const { serverId, revokeTokens = false } = params;

    logger.core.info('Disconnecting OAuth server', {
      serverId,
      revokeTokens,
    });

    // Phase 6: Token revocation
    if (revokeTokens) {
      logger.core.warn('Token revocation not yet implemented (Phase 6)', {
        serverId,
      });
    }

    // Delete tokens
    await this.tokenStore.deleteTokens(serverId);

    // Remove OAuth config
    await this.preferencesService.set(`mcpServers.${serverId}.oauth`, undefined);

    logger.core.info('Server disconnected', { serverId });
  }

  /**
   * Check if server has valid OAuth configuration
   */
  async hasValidConfig(serverId: string): Promise<boolean> {
    const config = await this.preferencesService.get(
      `mcpServers.${serverId}.oauth`
    );

    return !!(config && config.enabled && config.clientId);
  }

  /**
   * Check if server has valid tokens
   */
  async hasValidTokens(serverId: string): Promise<boolean> {
    const tokens = await this.tokenStore.getTokens(serverId);

    if (!tokens) return false;

    // Check if expired
    return !this.tokenStore.isTokenExpired(tokens);
  }

  /**
   * Create typed error
   *
   * @private
   */
  private createError(
    code: OAuthServiceError['code'],
    message: string,
    details?: Record<string, unknown>
  ): OAuthServiceError {
    const error = new Error(message) as OAuthServiceError;
    error.code = code;
    error.details = details;
    return error;
  }
}
```

---

### Paso 3: Modificar transports.ts

**Ubicación**: `src/main/services/mcp/transports.ts`

**Cambios a realizar**:

```typescript
// ANTES (archivo original sin OAuth)

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamablehttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { MCPServerConfig } from '../../types/mcp';

export async function createTransport(config: MCPServerConfig) {
  const transportType = config.transport;
  const baseUrl = config.baseUrl;

  const client = new Client(
    { name: 'Levante-MCP-Client', version: '1.0.0' },
    { capabilities: { sampling: {}, roots: { listChanged: true } } }
  );

  let transport;

  switch (transportType) {
    case 'http':
    case 'streamable-http':
      transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
        requestInit: { headers: config.headers || {} },
      });
      break;

    case 'sse':
      transport = new SSEClientTransport(new URL(baseUrl), {
        requestInit: { headers: config.headers || {} },
      });
      break;

    default:
      throw new Error(`Unsupported transport: ${transportType}`);
  }

  return { client, transport };
}
```

```typescript
// DESPUÉS (con soporte OAuth)

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamablehttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { OAuthService } from '../oauth/OAuthService';
import { PreferencesService } from '../preferences/PreferencesService';
import { getLogger } from '../logging';
import type { MCPServerConfig } from '../../types/mcp';

const logger = getLogger();

/**
 * Create MCP transport with optional OAuth support
 */
export async function createTransport(config: MCPServerConfig) {
  const transportType = config.transport;
  const baseUrl = config.baseUrl;

  logger.mcp.debug('Creating transport', {
    serverId: config.id,
    transport: transportType,
    oauth: config.oauth?.enabled || false,
  });

  // Check if OAuth is enabled
  if (config.oauth?.enabled && isHttpTransport(transportType)) {
    logger.mcp.info('Creating OAuth-enabled transport', {
      serverId: config.id,
    });
    return createOAuthTransport(config, transportType, baseUrl);
  }

  // Standard transport (no OAuth)
  return createStandardTransport(config, transportType, baseUrl);
}

/**
 * Create standard transport without OAuth
 *
 * @private
 */
async function createStandardTransport(
  config: MCPServerConfig,
  transportType: string,
  baseUrl: string
) {
  const client = new Client(
    { name: 'Levante-MCP-Client', version: '1.0.0' },
    { capabilities: { sampling: {}, roots: { listChanged: true } } }
  );

  let transport;

  switch (transportType) {
    case 'http':
    case 'streamable-http':
      transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
        requestInit: { headers: config.headers || {} },
      });
      break;

    case 'sse':
      transport = new SSEClientTransport(new URL(baseUrl), {
        requestInit: { headers: config.headers || {} },
      });
      break;

    case 'stdio':
      // STDIO doesn't use HTTP, no OAuth support
      throw new Error('STDIO transport should not reach createTransport');

    default:
      throw new Error(`Unsupported transport: ${transportType}`);
  }

  return { client, transport };
}

/**
 * Create OAuth-enabled transport
 *
 * @private
 */
async function createOAuthTransport(
  config: MCPServerConfig,
  transportType: string,
  baseUrl: string
) {
  const preferencesService = new PreferencesService();
  await preferencesService.initialize();

  const oauthService = new OAuthService(preferencesService);

  try {
    // 1. Ensure valid token
    logger.mcp.debug('Ensuring valid OAuth token', {
      serverId: config.id,
    });

    const tokens = await oauthService.ensureValidToken(config.id);

    logger.mcp.debug('Valid token obtained', {
      serverId: config.id,
      expiresAt: new Date(tokens.expiresAt).toISOString(),
    });

    // 2. Create headers with Authorization
    const headers = {
      ...config.headers,
      Authorization: `${tokens.tokenType} ${tokens.accessToken}`,
    };

    logger.mcp.debug('Authorization header added', {
      serverId: config.id,
      tokenType: tokens.tokenType,
      tokenPreview: tokens.accessToken.substring(0, 8) + '...',
    });

    // 3. Create client
    const client = new Client(
      { name: 'Levante-MCP-Client', version: '1.0.0' },
      { capabilities: { sampling: {}, roots: { listChanged: true } } }
    );

    // 4. Create transport with OAuth headers
    let transport;

    switch (transportType) {
      case 'http':
      case 'streamable-http':
        transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
          requestInit: { headers },
        });
        break;

      case 'sse':
        transport = new SSEClientTransport(new URL(baseUrl), {
          requestInit: { headers },
        });
        break;

      default:
        throw new Error(`Unsupported OAuth transport: ${transportType}`);
    }

    logger.mcp.info('OAuth transport created successfully', {
      serverId: config.id,
      transport: transportType,
    });

    return { client, transport };
  } catch (error) {
    logger.mcp.error('Failed to create OAuth transport', {
      serverId: config.id,
      error: error instanceof Error ? error.message : error,
    });

    throw new Error(
      `OAuth transport creation failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Check if transport type supports OAuth
 *
 * @private
 */
function isHttpTransport(transport: string): boolean {
  return ['http', 'sse', 'streamable-http'].includes(transport);
}
```

---

### Paso 4: Actualizar types.ts

**Ubicación**: `src/main/services/oauth/types.ts`

**Añadir los siguientes tipos**:

```typescript
// ... tipos existentes de Phases 1-3 ...

/**
 * OAuth server configuration stored in preferences
 */
export interface OAuthServerConfig {
  enabled: boolean;
  authServerId: string;
  clientId: string;
  clientSecret?: string;  // For confidential clients
  scopes: string[];
  redirectUri?: string;
}

/**
 * OAuthHttpClient error
 */
export interface OAuthHttpClientError extends Error {
  code:
    | 'NO_TOKENS'
    | 'NO_REFRESH_TOKEN'
    | 'REFRESH_FAILED'
    | 'NO_OAUTH_CONFIG'
    | 'NETWORK_ERROR'
    | 'UNAUTHORIZED';
  details?: Record<string, unknown>;
}

/**
 * OAuthService error
 */
export interface OAuthServiceError extends Error {
  code:
    | 'DISCOVERY_FAILED'
    | 'AUTHORIZATION_FAILED'
    | 'TOKEN_EXCHANGE_FAILED'
    | 'NO_CLIENT_ID'
    | 'SAVE_FAILED';
  details?: Record<string, unknown>;
}
```

---

### Paso 5: Actualizar index.ts

**Ubicación**: `src/main/services/oauth/index.ts`

```typescript
// Token Store (Phase 1)
export { OAuthTokenStore } from './OAuthTokenStore';

// OAuth Flow (Phase 2)
export { OAuthFlowManager } from './OAuthFlowManager';
export { OAuthRedirectServer } from './OAuthRedirectServer';
export { OAuthStateManager } from './OAuthStateManager';

// Discovery (Phase 3)
export { OAuthDiscoveryService } from './OAuthDiscoveryService';

// HTTP Client & Service (Phase 4) - NEW
export { OAuthHttpClient } from './OAuthHttpClient';
export { OAuthService } from './OAuthService';

// Types
export * from './types';
```

---

### Paso 6: Actualizar MCPServerConfig Type

**Ubicación**: `src/types/mcp.ts`

**Añadir campo oauth a MCPServerConfig**:

```typescript
export interface MCPServerConfig {
  id: string;
  name: string;
  description?: string;
  transport: 'stdio' | 'http' | 'sse' | 'streamable-http';

  // Transport-specific fields
  baseUrl?: string;      // For HTTP transports
  command?: string;      // For stdio
  args?: string[];       // For stdio
  headers?: Record<string, string>;  // For HTTP transports

  // OAuth configuration (NEW in Phase 4)
  oauth?: {
    enabled: boolean;
    authServerId?: string;
    clientId?: string;
    scopes?: string[];
  };
}
```

---

## Testing

### Test 1: OAuthHttpClient.test.ts

**Ubicación**: `src/main/services/oauth/__tests__/OAuthHttpClient.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OAuthHttpClient } from '../OAuthHttpClient';
import { OAuthTokenStore } from '../OAuthTokenStore';
import { OAuthFlowManager } from '../OAuthFlowManager';
import { PreferencesService } from '../../preferences/PreferencesService';
import type { OAuthTokens } from '../types';

// Mock dependencies
vi.mock('../OAuthTokenStore');
vi.mock('../OAuthFlowManager');
vi.mock('../../preferences/PreferencesService');

describe('OAuthHttpClient', () => {
  let httpClient: OAuthHttpClient;
  let mockPrefs: PreferencesService;
  let mockTokenStore: OAuthTokenStore;
  let mockFlowManager: OAuthFlowManager;

  beforeEach(() => {
    mockPrefs = new PreferencesService();
    httpClient = new OAuthHttpClient(mockPrefs);

    // Access private properties for testing
    mockTokenStore = (httpClient as any).tokenStore;
    mockFlowManager = (httpClient as any).flowManager;
  });

  describe('ensureValidToken', () => {
    it('should return valid token if not expired', async () => {
      const validTokens: OAuthTokens = {
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000, // 1 hour from now
        tokenType: 'Bearer',
      };

      vi.spyOn(mockTokenStore, 'getTokens').mockResolvedValue(validTokens);
      vi.spyOn(mockTokenStore, 'isTokenExpired').mockReturnValue(false);

      const result = await httpClient.ensureValidToken('server-1');

      expect(result).toEqual(validTokens);
      expect(mockTokenStore.getTokens).toHaveBeenCalledWith('server-1');
      expect(mockFlowManager.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('should refresh expired token', async () => {
      const expiredTokens: OAuthTokens = {
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() - 1000, // Expired
        tokenType: 'Bearer',
      };

      const newTokens: OAuthTokens = {
        accessToken: 'new-token',
        refreshToken: 'new-refresh-token',
        expiresAt: Date.now() + 3600000,
        tokenType: 'Bearer',
      };

      vi.spyOn(mockTokenStore, 'getTokens').mockResolvedValue(expiredTokens);
      vi.spyOn(mockTokenStore, 'isTokenExpired').mockReturnValue(true);
      vi.spyOn(mockFlowManager, 'refreshAccessToken').mockResolvedValue(newTokens);
      vi.spyOn(mockTokenStore, 'saveTokens').mockResolvedValue();

      // Mock getOAuthConfig
      vi.spyOn(mockPrefs, 'get').mockResolvedValue({
        authServerId: 'https://auth.example.com',
        clientId: 'test-client',
      });

      const result = await httpClient.ensureValidToken('server-1');

      expect(result).toEqual(newTokens);
      expect(mockFlowManager.refreshAccessToken).toHaveBeenCalled();
      expect(mockTokenStore.saveTokens).toHaveBeenCalledWith('server-1', newTokens);
    });

    it('should throw error if no tokens found', async () => {
      vi.spyOn(mockTokenStore, 'getTokens').mockResolvedValue(null);

      await expect(httpClient.ensureValidToken('server-1')).rejects.toThrow(
        'No OAuth tokens found'
      );
    });

    it('should throw error if no refresh token available', async () => {
      const tokensWithoutRefresh: OAuthTokens = {
        accessToken: 'expired-token',
        expiresAt: Date.now() - 1000,
        tokenType: 'Bearer',
      };

      vi.spyOn(mockTokenStore, 'getTokens').mockResolvedValue(tokensWithoutRefresh);
      vi.spyOn(mockTokenStore, 'isTokenExpired').mockReturnValue(true);

      await expect(httpClient.ensureValidToken('server-1')).rejects.toThrow(
        'No refresh token available'
      );
    });
  });

  describe('getAuthHeaders', () => {
    it('should return authorization header', async () => {
      const tokens: OAuthTokens = {
        accessToken: 'test-token-123',
        expiresAt: Date.now() + 3600000,
        tokenType: 'Bearer',
      };

      vi.spyOn(mockTokenStore, 'getTokens').mockResolvedValue(tokens);
      vi.spyOn(mockTokenStore, 'isTokenExpired').mockReturnValue(false);

      const headers = await httpClient.getAuthHeaders('server-1');

      expect(headers).toEqual({
        Authorization: 'Bearer test-token-123',
      });
    });
  });

  describe('handleUnauthorized', () => {
    it('should refresh token and return true on 401', async () => {
      const tokens: OAuthTokens = {
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000,
        tokenType: 'Bearer',
      };

      const newTokens: OAuthTokens = {
        accessToken: 'new-token',
        refreshToken: 'new-refresh-token',
        expiresAt: Date.now() + 3600000,
        tokenType: 'Bearer',
      };

      const response = new Response(null, {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Bearer error="invalid_token"',
        },
      });

      vi.spyOn(mockTokenStore, 'getTokens').mockResolvedValue(tokens);
      vi.spyOn(mockFlowManager, 'refreshAccessToken').mockResolvedValue(newTokens);
      vi.spyOn(mockTokenStore, 'saveTokens').mockResolvedValue();
      vi.spyOn(mockPrefs, 'get').mockResolvedValue({
        authServerId: 'https://auth.example.com',
        clientId: 'test-client',
      });

      const canRetry = await httpClient.handleUnauthorized('server-1', response);

      expect(canRetry).toBe(true);
      expect(mockFlowManager.refreshAccessToken).toHaveBeenCalled();
    });

    it('should return false if no refresh token', async () => {
      const tokens: OAuthTokens = {
        accessToken: 'old-token',
        expiresAt: Date.now() + 3600000,
        tokenType: 'Bearer',
      };

      const response = new Response(null, { status: 401 });

      vi.spyOn(mockTokenStore, 'getTokens').mockResolvedValue(tokens);

      const canRetry = await httpClient.handleUnauthorized('server-1', response);

      expect(canRetry).toBe(false);
    });
  });
});
```

---

### Test 2: OAuthService.test.ts

**Ubicación**: `src/main/services/oauth/__tests__/OAuthService.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OAuthService } from '../OAuthService';
import { PreferencesService } from '../../preferences/PreferencesService';
import type { OAuthTokens } from '../types';

vi.mock('../../preferences/PreferencesService');

describe('OAuthService', () => {
  let service: OAuthService;
  let mockPrefs: PreferencesService;

  beforeEach(() => {
    mockPrefs = new PreferencesService();
    service = new OAuthService(mockPrefs);
  });

  describe('authorize', () => {
    it('should complete full authorization flow', async () => {
      // Mock discovery
      vi.spyOn((service as any).discoveryService, 'discoverFromUnauthorized')
        .mockResolvedValue({
          authorizationServer: 'https://auth.example.com',
          metadata: {
            authorization_endpoint: 'https://auth.example.com/authorize',
            token_endpoint: 'https://auth.example.com/token',
            response_types_supported: ['code'],
            code_challenge_methods_supported: ['S256'],
          },
        });

      // Mock authorization flow
      vi.spyOn((service as any).flowManager, 'authorize').mockResolvedValue({
        code: 'auth-code-123',
        verifier: 'verifier-123',
      });

      // Mock token exchange
      const tokens: OAuthTokens = {
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-123',
        expiresAt: Date.now() + 3600000,
        tokenType: 'Bearer',
      };

      vi.spyOn((service as any).flowManager, 'exchangeCodeForTokens')
        .mockResolvedValue(tokens);

      // Mock save
      vi.spyOn((service as any).tokenStore, 'saveTokens').mockResolvedValue();
      vi.spyOn(mockPrefs, 'set').mockResolvedValue();

      const result = await service.authorize({
        serverId: 'test-server',
        mcpServerUrl: 'https://mcp.example.com',
        clientId: 'test-client',
        scopes: ['mcp:read', 'mcp:write'],
      });

      expect(result.success).toBe(true);
      expect(result.tokens).toEqual(tokens);
    });

    it('should return error if no client ID', async () => {
      const result = await service.authorize({
        serverId: 'test-server',
        mcpServerUrl: 'https://mcp.example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Client ID required');
    });
  });

  describe('hasValidConfig', () => {
    it('should return true if config is valid', async () => {
      vi.spyOn(mockPrefs, 'get').mockResolvedValue({
        enabled: true,
        clientId: 'test-client',
      });

      const result = await service.hasValidConfig('test-server');

      expect(result).toBe(true);
    });

    it('should return false if config is missing', async () => {
      vi.spyOn(mockPrefs, 'get').mockResolvedValue(null);

      const result = await service.hasValidConfig('test-server');

      expect(result).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should delete tokens and config', async () => {
      vi.spyOn((service as any).tokenStore, 'deleteTokens').mockResolvedValue();
      vi.spyOn(mockPrefs, 'set').mockResolvedValue();

      await service.disconnect({ serverId: 'test-server' });

      expect((service as any).tokenStore.deleteTokens).toHaveBeenCalledWith('test-server');
      expect(mockPrefs.set).toHaveBeenCalledWith(
        'mcpServers.test-server.oauth',
        undefined
      );
    });
  });
});
```

---

### Test 3: Transport Integration Test

**Ubicación**: `src/main/services/oauth/__tests__/oauth-transport-integration.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTransport } from '../../mcp/transports';
import { OAuthService } from '../OAuthService';
import type { MCPServerConfig } from '../../../types/mcp';
import type { OAuthTokens } from '../types';

vi.mock('../OAuthService');

describe('OAuth Transport Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create standard transport for non-OAuth server', async () => {
    const config: MCPServerConfig = {
      id: 'test-server',
      name: 'Test Server',
      transport: 'http',
      baseUrl: 'https://mcp.example.com',
      headers: {
        'X-Custom': 'value',
      },
    };

    const { client, transport } = await createTransport(config);

    expect(client).toBeDefined();
    expect(transport).toBeDefined();
  });

  it('should create OAuth transport for OAuth-enabled server', async () => {
    const config: MCPServerConfig = {
      id: 'oauth-server',
      name: 'OAuth Server',
      transport: 'http',
      baseUrl: 'https://mcp.example.com',
      oauth: {
        enabled: true,
        clientId: 'test-client',
      },
    };

    const tokens: OAuthTokens = {
      accessToken: 'test-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600000,
      tokenType: 'Bearer',
    };

    // Mock OAuthService
    vi.spyOn(OAuthService.prototype, 'ensureValidToken').mockResolvedValue(tokens);

    const { client, transport } = await createTransport(config);

    expect(client).toBeDefined();
    expect(transport).toBeDefined();
    expect(OAuthService.prototype.ensureValidToken).toHaveBeenCalledWith('oauth-server');
  });

  it('should throw error if OAuth token retrieval fails', async () => {
    const config: MCPServerConfig = {
      id: 'oauth-server',
      name: 'OAuth Server',
      transport: 'http',
      baseUrl: 'https://mcp.example.com',
      oauth: {
        enabled: true,
        clientId: 'test-client',
      },
    };

    vi.spyOn(OAuthService.prototype, 'ensureValidToken').mockRejectedValue(
      new Error('No tokens found')
    );

    await expect(createTransport(config)).rejects.toThrow('OAuth transport creation failed');
  });

  it('should not use OAuth for stdio transport', async () => {
    const config: MCPServerConfig = {
      id: 'stdio-server',
      name: 'Stdio Server',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      oauth: {
        enabled: true, // Should be ignored for stdio
      },
    };

    // stdio transport would be handled differently
    // This test ensures OAuth is not applied to stdio
    await expect(createTransport(config)).rejects.toThrow(
      'STDIO transport should not reach createTransport'
    );
  });
});
```

---

## Consideraciones de Seguridad

### 1. Token Exposure en Logs

**Riesgo**: Tokens OAuth en logs pueden ser capturados

**Mitigación**:
```typescript
// ❌ MAL
logger.debug('Token:', token.accessToken);

// ✅ BIEN
logger.debug('Token:', token.accessToken.substring(0, 8) + '...[REDACTED]');
```

### 2. Error Messages

**Riesgo**: Exponer detalles internos en errores

**Mitigación**:
```typescript
// ❌ MAL
throw new Error(`Refresh failed with token: ${refreshToken}`);

// ✅ BIEN
throw new Error('Token refresh failed. Re-authorization required.');
```

### 3. Token Storage

**Validación**:
- ✅ Tokens encriptados con `safeStorage`
- ✅ Tokens nunca en variables de entorno
- ✅ Tokens nunca en query parameters
- ✅ Tokens solo en headers `Authorization`

### 4. HTTPS Enforcement

**Validación**:
```typescript
if (baseUrl.startsWith('http://') && !isLocalhost(baseUrl)) {
  logger.warn('Non-HTTPS endpoint detected', { baseUrl });
}
```

### 5. Token Refresh Race Conditions

**Problema**: Multiple requests simultáneos pueden intentar refresh

**Solución futura** (opcional):
```typescript
private refreshPromises = new Map<string, Promise<OAuthTokens>>();

async ensureValidToken(serverId: string): Promise<OAuthTokens> {
  // Check if refresh is already in progress
  if (this.refreshPromises.has(serverId)) {
    return this.refreshPromises.get(serverId)!;
  }

  // ... rest of implementation
}
```

---

## Checklist de Implementación

### Código

- [ ] `OAuthHttpClient.ts` creado y completo
- [ ] `OAuthService.ts` creado y completo
- [ ] `transports.ts` modificado con soporte OAuth
- [ ] `types.ts` actualizado con nuevos tipos
- [ ] `index.ts` actualizado con exports
- [ ] `MCPServerConfig` actualizado con campo `oauth`

### Testing

- [ ] `OAuthHttpClient.test.ts` - 80%+ cobertura
- [ ] `OAuthService.test.ts` - 80%+ cobertura
- [ ] `oauth-transport-integration.test.ts` - escenarios clave
- [ ] Todos los tests pasan
- [ ] No hay warnings de TypeScript

### Documentación

- [ ] `fase_4_oauth.md` completo
- [ ] Comentarios JSDoc en todo el código
- [ ] README actualizado (si aplica)

### Validación

- [ ] Logging apropiado en todos los puntos clave
- [ ] Error handling robusto
- [ ] No hay secrets en logs
- [ ] HTTPS enforcement validado
- [ ] Code review completado

---

## Troubleshooting

### Problema: "No OAuth tokens found"

**Causa**: Server no tiene tokens almacenados

**Solución**:
1. Verificar que `authorize()` se ejecutó correctamente
2. Verificar que tokens se guardaron en preferences
3. Ejecutar flujo de autorización nuevamente

### Problema: "Token refresh failed"

**Causa**: Refresh token inválido o expirado

**Solución**:
1. Verificar que refresh token existe
2. Verificar metadata del authorization server
3. Re-autorizar con `authorize()`

### Problema: Transport creation fails con OAuth

**Causa**: Configuración OAuth incompleta

**Solución**:
1. Verificar que `config.oauth.enabled === true`
2. Verificar que `config.oauth.clientId` existe
3. Verificar que tokens existen en storage

### Problema: 401 después de refresh

**Causa**: Token revocado del lado del servidor

**Solución**:
1. Limpiar tokens: `disconnect({ serverId, revokeTokens: false })`
2. Re-autorizar: `authorize({ serverId, ... })`

---

## Próximos Pasos

### Después de Fase 4

Una vez completada la Fase 4, el sistema OAuth estará funcionalmente completo para casos de uso básicos. Las siguientes fases añaden funcionalidad avanzada:

**Fase 5: Dynamic Client Registration (RFC 7591)**
- Registro automático de Levante como cliente OAuth
- Eliminación de necesidad de client ID manual
- Soporte para providers que requieren registro

**Fase 6: Revocación y UI**
- RFC 7009: Token Revocation
- UI completa para gestión de conexiones OAuth
- Disconnect con revocación de tokens
- Visualización de estado de autenticación

### Testing Manual Recomendado

Antes de considerar la Fase 4 completa:

1. **Test con servidor OAuth real**:
   - Configurar servidor OAuth de prueba
   - Ejecutar flujo completo de autorización
   - Verificar auto-refresh funciona
   - Verificar 401 handling

2. **Test de integración**:
   - Conectar a servidor MCP con OAuth
   - Listar tools/resources/prompts
   - Ejecutar tool calls
   - Verificar logs

3. **Test de edge cases**:
   - Token expirado
   - Refresh token inválido
   - Network errors
   - Authorization server down

---

## Resumen Ejecutivo Final

### ¿Qué incluye la Fase 4?

✅ **OAuthHttpClient**: Cliente HTTP con auto-refresh
✅ **OAuthService**: Orquestador de alto nivel
✅ **Transport Integration**: OAuth en transportes MCP
✅ **401 Handling**: Retry automático tras refresh
✅ **Complete Testing**: Tests unitarios e integración

### Stack Tecnológico

- **TypeScript**: Strict mode
- **Vitest**: Testing framework
- **Electron safeStorage**: Token encryption
- **MCP SDK**: Transport layer

### Duración Estimada

- **Implementación**: 3-4 días
- **Testing**: 1-2 días
- **Total**: 5-6 días

### Prerequisitos

- ✅ Fase 1: Token Store (completa)
- ✅ Fase 2: OAuth Flow (completa)
- ✅ Fase 3: Discovery (completa)

### Resultado Final

Al completar la Fase 4, Levante podrá:

1. **Conectar** a servidores MCP protegidos con OAuth
2. **Auto-refresh** tokens expirados sin intervención del usuario
3. **Recuperarse** automáticamente de errores 401
4. **Mantener** conexiones OAuth estables y seguras

---

**Última actualización**: 2025-12-21
**Versión**: 1.0
**Estado**: Plan de implementación
**Autor**: Arquitectura Levante
