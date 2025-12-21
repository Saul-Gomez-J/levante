# Fase 5: Dynamic Client Registration - Plan de Implementación

## Información del Documento

- **Versión**: 1.0
- **Fecha**: 2025-12-21
- **Estado**: Plan de Implementación
- **Fase**: 5 de 6 - Dynamic Client Registration
- **Prerequisitos**: Fases 1-4 completadas

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Contexto y Objetivos](#contexto-y-objetivos)
3. [Arquitectura de la Fase 5](#arquitectura-de-la-fase-5)
4. [Modificaciones Detalladas](#modificaciones-detalladas)
5. [Flujo de Ejecución](#flujo-de-ejecución)
6. [Plan de Testing](#plan-de-testing)
7. [Integración con Fases Previas](#integración-con-fases-previas)
8. [Consideraciones de Seguridad](#consideraciones-de-seguridad)
9. [Próximos Pasos](#próximos-pasos)

---

## Resumen Ejecutivo

La **Fase 5** implementa Dynamic Client Registration (RFC 7591), permitiendo que Levante se registre automáticamente ante Authorization Servers sin necesidad de configuración manual de `client_id`.

### ¿Qué se implementará?

✅ Registro automático de Levante como cliente OAuth
✅ Soporte para RFC 7591 (Dynamic Client Registration Protocol)
✅ Almacenamiento seguro de credenciales de cliente registradas
✅ Manejo de errores cuando Dynamic Registration no está disponible
✅ Integración transparente con el flujo OAuth existente

### ¿Qué NO se implementará en esta fase?

❌ Estrategia de fallback cuando Dynamic Registration falla (TO-DO futuro)
❌ Client IDs embebidos para proveedores conocidos (TO-DO futuro)
❌ UI para gestionar clientes registrados (Fase 6)

---

## Contexto y Objetivos

### Estado Actual (Post Fase 4)

Ya tenemos implementado:
- ✅ Token Store seguro con encriptación
- ✅ OAuth Flow completo con PKCE
- ✅ Discovery automático de Authorization Servers
- ✅ HTTP Client con auto-refresh de tokens
- ✅ Integración con transportes MCP

### Problema a Resolver

Actualmente, para conectar un servidor MCP con OAuth, necesitamos:
1. Que el usuario proporcione un `client_id` manualmente, O
2. Tener `client_id` embebido en Levante para proveedores conocidos

**Ambas opciones son subóptimas**:
- Los usuarios finales de Levante no administran servidores OAuth
- Mantener client_ids embebidos es poco escalable

### Solución: Dynamic Client Registration

RFC 7591 permite que Levante se registre automáticamente como cliente OAuth ante cualquier Authorization Server que lo soporte, eliminando la configuración manual.

### Objetivos de la Fase 5

1. **Implementar RFC 7591** - Registro automático de cliente
2. **Almacenamiento seguro** - Guardar `client_id` y `client_secret` (si aplica) encriptados
3. **Integración transparente** - El usuario no necesita saber que ocurre el registro
4. **Manejo de errores** - Informar claramente cuando Dynamic Registration no está disponible
5. **Testing completo** - Validar flujo exitoso y casos de error

---

## Arquitectura de la Fase 5

### Componentes Afectados

```
┌─────────────────────────────────────────────────────────────┐
│                     FASE 5 - COMPONENTES                     │
└─────────────────────────────────────────────────────────────┘

1. OAuthDiscoveryService (MODIFICAR)
   └── + registerClient() → Nuevo método para RFC 7591

2. OAuthService (MODIFICAR)
   └── + authorize() → Integrar Dynamic Registration

3. types.ts (MODIFICAR)
   └── + OAuthClientRegistration → Nuevos tipos

4. PreferencesService (YA EXISTE)
   └── Usar para guardar clientId/clientSecret

5. TESTS (CREAR)
   ├── OAuthDiscoveryService.test.ts → Agregar tests de registro
   └── dynamic-client-registration.test.ts → Integration tests
```

### Flujo de Datos

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. Usuario intenta conectar servidor MCP con OAuth              │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ 2. OAuthService.authorize() → Discovery automático              │
│    - Fetch /.well-known/oauth-protected-resource                │
│    - Fetch /.well-known/oauth-authorization-server              │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ 3. Check: ¿Metadata incluye registration_endpoint?              │
└──────────────────────────────────────────────────────────────────┘
                    ↓ SI                      ↓ NO
┌─────────────────────────────┐   ┌──────────────────────────────┐
│ 4a. Dynamic Registration    │   │ 4b. Error: Registration      │
│     OAuthDiscoveryService   │   │     no disponible            │
│     .registerClient()       │   │     (TO-DO: Fallback)        │
└─────────────────────────────┘   └──────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────────────┐
│ 5. Guardar clientId/clientSecret en PreferencesService          │
│    (Encriptados con safeStorage)                                │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ 6. Continuar con flujo OAuth normal (Authorization Code + PKCE) │
└──────────────────────────────────────────────────────────────────┘
```

---

## Modificaciones Detalladas

### 1. Actualizar Tipos TypeScript

**Archivo**: `src/main/services/oauth/types.ts`

**Modificaciones**:

```typescript
// ========================================
// AGREGAR AL FINAL DEL ARCHIVO
// ========================================

/**
 * RFC 7591: Dynamic Client Registration Request
 */
export interface OAuthClientRegistrationRequest {
  /** Human-readable name of the client */
  client_name: string;

  /** Array of redirect URIs */
  redirect_uris: string[];

  /** Grant types the client can use */
  grant_types?: string[];

  /** Response types the client can use */
  response_types?: string[];

  /** Token endpoint authentication method */
  token_endpoint_auth_method?: 'none' | 'client_secret_post' | 'client_secret_basic';

  /** Requested scopes */
  scope?: string;

  /** URL of the client application */
  client_uri?: string;

  /** Logo URI */
  logo_uri?: string;
}

/**
 * RFC 7591: Dynamic Client Registration Response
 */
export interface OAuthClientRegistrationResponse {
  /** Unique client identifier */
  client_id: string;

  /** Client secret (only for confidential clients) */
  client_secret?: string;

  /** Timestamp when client_secret expires (0 = never) */
  client_secret_expires_at?: number;

  /** Registration access token */
  registration_access_token?: string;

  /** Registration client URI for updates */
  registration_client_uri?: string;

  /** Timestamp when the client was registered */
  client_id_issued_at?: number;

  /** Echo of request fields */
  client_name?: string;
  redirect_uris?: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
  scope?: string;
}

/**
 * Stored client credentials after registration
 */
export interface OAuthClientCredentials {
  clientId: string;
  clientSecret?: string; // Encrypted if exists
  registeredAt: number;
  authServerId: string;
  registrationMetadata?: {
    client_secret_expires_at?: number;
    registration_access_token?: string; // Encrypted
    registration_client_uri?: string;
  };
}

/**
 * Error de registro de cliente
 */
export class ClientRegistrationError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'ClientRegistrationError';
  }
}
```

**Modificar la interfaz `MCPServerConfig`** (si no está ya extendida):

```typescript
// ========================================
// MODIFICAR INTERFAZ EXISTENTE
// ========================================

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'http' | 'sse' | 'streamable-http';
  baseUrl?: string;
  command?: string;
  args?: string[];
  headers?: Record<string, string>;

  oauth?: {
    enabled: boolean;
    authServerId?: string;

    // NUEVO: Credenciales de cliente
    clientCredentials?: OAuthClientCredentials;

    scopes?: string[];
    redirectUri?: string;
  };
}
```

---

### 2. Extender OAuthDiscoveryService

**Archivo**: `src/main/services/oauth/OAuthDiscoveryService.ts`

**Modificaciones**: Agregar el método `registerClient()` al final de la clase

```typescript
// ========================================
// AGREGAR AL FINAL DE LA CLASE OAuthDiscoveryService
// ========================================

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
  authServerId: string
): Promise<OAuthClientCredentials> {
  this.logger.mcp.info('Attempting Dynamic Client Registration', {
    registrationEndpoint,
    authServerId,
  });

  // Validate HTTPS (except localhost)
  const url = new URL(registrationEndpoint);
  if (url.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new ClientRegistrationError(
      'Registration endpoint must use HTTPS',
      'invalid_endpoint'
    );
  }

  // Prepare registration request (RFC 7591)
  const registrationRequest: OAuthClientRegistrationRequest = {
    client_name: 'Levante',
    client_uri: 'https://github.com/levante-hub/levante',

    // Loopback redirect without specific port (will be dynamic)
    redirect_uris: ['http://127.0.0.1/callback'],

    // Grant types for Authorization Code Flow with PKCE
    grant_types: ['authorization_code', 'refresh_token'],

    // Response type for Authorization Code Flow
    response_types: ['code'],

    // Public client (no client secret needed for PKCE)
    token_endpoint_auth_method: 'none',

    // Minimal scopes (server-specific scopes will be requested during authorization)
    scope: 'mcp:read mcp:write',
  };

  try {
    // POST to registration endpoint
    const response = await fetch(registrationEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(registrationRequest),
    });

    if (!response.ok) {
      // Parse error response
      let errorData: any;
      try {
        errorData = await response.json();
      } catch {
        errorData = { error: 'unknown_error', error_description: await response.text() };
      }

      this.logger.mcp.error('Client registration failed', {
        status: response.status,
        error: errorData.error,
        description: errorData.error_description,
      });

      throw new ClientRegistrationError(
        errorData.error_description || `Registration failed: ${errorData.error}`,
        errorData.error || 'registration_failed',
        response.status
      );
    }

    // Parse successful response
    const data: OAuthClientRegistrationResponse = await response.json();

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

    // Build credentials object
    const credentials: OAuthClientCredentials = {
      clientId: data.client_id,
      clientSecret: data.client_secret, // Will be encrypted when saved
      registeredAt: Date.now(),
      authServerId,
      registrationMetadata: {
        client_secret_expires_at: data.client_secret_expires_at,
        registration_access_token: data.registration_access_token,
        registration_client_uri: data.registration_client_uri,
      },
    };

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
      `Failed to register client: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
supportsClientRegistration(metadata: {
  registrationEndpoint?: string;
  [key: string]: any;
}): boolean {
  return !!metadata.registrationEndpoint;
}
```

---

### 3. Modificar OAuthService para Integrar Dynamic Registration

**Archivo**: `src/main/services/oauth/OAuthService.ts`

**Modificaciones**: Actualizar el método `authorize()` para incluir Dynamic Client Registration

```typescript
// ========================================
// MODIFICAR EL MÉTODO authorize() EN OAuthService
// ========================================

/**
 * Complete OAuth authorization flow with automatic Dynamic Client Registration
 *
 * Flow:
 * 1. Discovery of Authorization Server
 * 2. Fetch AS Metadata
 * 3. Dynamic Client Registration (if needed and supported)
 * 4. Authorization Code Flow with PKCE
 * 5. Token Exchange
 * 6. Save tokens
 *
 * @param params - Authorization parameters
 * @returns Authorization result with success status
 */
async authorize(params: {
  serverId: string;
  mcpServerUrl: string;
  clientId?: string; // Optional: use if already registered
  scopes?: string[];
}): Promise<{ success: boolean; error?: string }> {
  const { serverId, mcpServerUrl, clientId: providedClientId, scopes = ['mcp:read', 'mcp:write'] } = params;

  try {
    this.logger.mcp.info('Starting OAuth authorization flow', {
      serverId,
      mcpServerUrl,
      hasProvidedClientId: !!providedClientId,
    });

    // Step 1: Discovery of Authorization Server
    this.logger.mcp.info('Step 1: Discovering Authorization Server');
    const discovery = await this.discoveryService.discoverAuthServer(mcpServerUrl);

    if (!discovery.authorizationServers || discovery.authorizationServers.length === 0) {
      throw new Error('No authorization servers found for this MCP server');
    }

    // Use first authorization server
    const authServerId = discovery.authorizationServers[0];
    this.logger.mcp.info('Authorization Server discovered', { authServerId });

    // Step 2: Fetch Authorization Server metadata
    this.logger.mcp.info('Step 2: Fetching Authorization Server metadata');
    const metadata = await this.discoveryService.fetchServerMetadata(authServerId);

    // Step 3: Dynamic Client Registration (if needed)
    let clientId = providedClientId;
    let clientSecret: string | undefined;

    if (!clientId) {
      this.logger.mcp.info('Step 3: No client_id provided, checking for Dynamic Client Registration');

      // Check if AS supports Dynamic Client Registration
      if (this.discoveryService.supportsClientRegistration(metadata)) {
        this.logger.mcp.info('Dynamic Client Registration supported, attempting registration');

        try {
          const credentials = await this.discoveryService.registerClient(
            metadata.registrationEndpoint!,
            authServerId
          );

          clientId = credentials.clientId;
          clientSecret = credentials.clientSecret;

          // Save credentials to preferences (encrypted)
          await this.saveClientCredentials(serverId, credentials);

          this.logger.mcp.info('Dynamic Client Registration successful', {
            clientId: this.sanitizeForLog(clientId),
            hasClientSecret: !!clientSecret,
          });
        } catch (registrationError) {
          // Dynamic Registration failed
          this.logger.mcp.error('Dynamic Client Registration failed', {
            error: registrationError instanceof Error ? registrationError.message : registrationError,
          });

          // TO-DO: Implement fallback strategy
          // For now, we throw an error informing the user
          return {
            success: false,
            error: `Dynamic Client Registration failed: ${
              registrationError instanceof Error ? registrationError.message : 'Unknown error'
            }. This server requires manual client configuration (feature coming soon).`,
          };
        }
      } else {
        // No Dynamic Registration available
        this.logger.mcp.warn('Dynamic Client Registration not supported by Authorization Server');

        // TO-DO: Implement fallback strategy
        // Options to consider:
        // 1. Check for embedded client_id for known providers
        // 2. Check if MCP server config includes client_id
        // 3. Prompt user (not ideal)
        return {
          success: false,
          error: 'This Authorization Server does not support Dynamic Client Registration. Manual client configuration will be required (feature coming soon).',
        };
      }
    } else {
      this.logger.mcp.info('Step 3: Using provided client_id', {
        clientId: this.sanitizeForLog(clientId),
      });
    }

    // Step 4: Authorization Code Flow with PKCE
    this.logger.mcp.info('Step 4: Starting Authorization Code Flow with PKCE');

    // Generate PKCE
    const { verifier, challenge } = this.flowManager.generatePKCE();

    // Generate state
    const state = this.stateManager.createState(serverId);

    // Start loopback server
    const redirectServer = new OAuthRedirectServer();
    const { port, url: redirectUri } = await redirectServer.start();

    this.logger.mcp.info('Loopback server started', { port, redirectUri });

    // Create authorization URL
    const authUrl = this.flowManager.createAuthorizationUrl({
      authEndpoint: metadata.authorizationEndpoint,
      clientId,
      redirectUri,
      scopes,
      state,
      codeChallenge: challenge,
    });

    this.logger.mcp.info('Opening browser for user authorization');

    // Open browser (using Electron shell)
    const { shell } = require('electron');
    await shell.openExternal(authUrl);

    // Wait for callback
    this.logger.mcp.info('Waiting for authorization callback...');
    const { code, state: receivedState } = await redirectServer.waitForCallback();

    // Stop loopback server
    await redirectServer.stop();

    // Validate state
    if (!this.stateManager.validateState(receivedState, serverId)) {
      throw new Error('Invalid state parameter (CSRF protection)');
    }

    this.logger.mcp.info('Authorization code received', {
      code: this.sanitizeForLog(code),
    });

    // Step 5: Exchange code for tokens
    this.logger.mcp.info('Step 5: Exchanging authorization code for tokens');

    const tokens = await this.flowManager.exchangeCodeForTokens({
      tokenEndpoint: metadata.tokenEndpoint,
      code,
      redirectUri,
      clientId,
      codeVerifier: verifier,
      clientSecret, // Include if we have it from Dynamic Registration
    });

    // Step 6: Save tokens
    this.logger.mcp.info('Step 6: Saving tokens');
    await this.tokenStore.saveTokens(serverId, tokens);

    // Save OAuth configuration to preferences
    await this.saveOAuthConfig(serverId, {
      enabled: true,
      authServerId,
      scopes,
      redirectUri: 'http://127.0.0.1/callback', // Generic, port is dynamic
    });

    this.logger.mcp.info('OAuth authorization flow completed successfully', {
      serverId,
    });

    return { success: true };
  } catch (error) {
    this.logger.mcp.error('OAuth authorization failed', {
      serverId,
      error: error instanceof Error ? error.message : error,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ========================================
// AGREGAR MÉTODOS AUXILIARES A OAuthService
// ========================================

/**
 * Save client credentials to preferences (encrypted)
 *
 * @param serverId - MCP server ID
 * @param credentials - Client credentials from Dynamic Registration
 */
private async saveClientCredentials(
  serverId: string,
  credentials: OAuthClientCredentials
): Promise<void> {
  const { safeStorage } = require('electron');

  // Encrypt sensitive fields
  const toSave = {
    ...credentials,
    clientSecret: credentials.clientSecret
      ? `ENCRYPTED:${safeStorage.encryptString(credentials.clientSecret).toString('base64')}`
      : undefined,
    registrationMetadata: credentials.registrationMetadata
      ? {
          ...credentials.registrationMetadata,
          registration_access_token: credentials.registrationMetadata.registration_access_token
            ? `ENCRYPTED:${safeStorage.encryptString(credentials.registrationMetadata.registration_access_token).toString('base64')}`
            : undefined,
        }
      : undefined,
  };

  await this.preferencesService.set(
    `mcpServers.${serverId}.oauth.clientCredentials`,
    toSave
  );

  this.logger.mcp.info('Client credentials saved', {
    serverId,
    clientId: this.sanitizeForLog(credentials.clientId),
  });
}

/**
 * Get client credentials from preferences (decrypted)
 *
 * @param serverId - MCP server ID
 * @returns Client credentials or null if not found
 */
private async getClientCredentials(
  serverId: string
): Promise<OAuthClientCredentials | null> {
  const stored = await this.preferencesService.get(
    `mcpServers.${serverId}.oauth.clientCredentials`
  );

  if (!stored) {
    return null;
  }

  const { safeStorage } = require('electron');

  // Decrypt sensitive fields
  return {
    ...stored,
    clientSecret: stored.clientSecret && stored.clientSecret.startsWith('ENCRYPTED:')
      ? safeStorage.decryptString(
          Buffer.from(stored.clientSecret.replace('ENCRYPTED:', ''), 'base64')
        )
      : stored.clientSecret,
    registrationMetadata: stored.registrationMetadata
      ? {
          ...stored.registrationMetadata,
          registration_access_token:
            stored.registrationMetadata.registration_access_token &&
            stored.registrationMetadata.registration_access_token.startsWith('ENCRYPTED:')
              ? safeStorage.decryptString(
                  Buffer.from(
                    stored.registrationMetadata.registration_access_token.replace('ENCRYPTED:', ''),
                    'base64'
                  )
                )
              : stored.registrationMetadata.registration_access_token,
        }
      : undefined,
  };
}

/**
 * Save OAuth configuration to preferences
 *
 * @param serverId - MCP server ID
 * @param config - OAuth configuration
 */
private async saveOAuthConfig(
  serverId: string,
  config: {
    enabled: boolean;
    authServerId: string;
    scopes: string[];
    redirectUri: string;
  }
): Promise<void> {
  await this.preferencesService.set(`mcpServers.${serverId}.oauth`, {
    ...config,
    // Keep existing clientCredentials if they exist
    clientCredentials: await this.getClientCredentials(serverId),
  });
}

/**
 * Sanitize sensitive data for logging
 *
 * @param value - Value to sanitize
 * @returns Sanitized value (first 8 chars + redacted)
 */
private sanitizeForLog(value: string): string {
  if (!value || value.length < 16) return '[REDACTED]';
  return `${value.substring(0, 8)}...[REDACTED]`;
}
```

**Importante**: También actualizar el método `exchangeCodeForTokens` en `OAuthFlowManager` para soportar `clientSecret`:

**Archivo**: `src/main/services/oauth/OAuthFlowManager.ts`

```typescript
// ========================================
// MODIFICAR EL MÉTODO exchangeCodeForTokens
// ========================================

async exchangeCodeForTokens(params: {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  clientId: string;
  codeVerifier: string;
  clientSecret?: string; // NUEVO: Opcional para confidential clients
}): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.codeVerifier,
  });

  // Add client_secret if provided (for confidential clients)
  if (params.clientSecret) {
    body.set('client_secret', params.clientSecret);
  }

  const response = await fetch(params.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Token exchange failed: ${error.error_description || error.error}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope,
  };
}
```

---

### 4. Actualizar Exports

**Archivo**: `src/main/services/oauth/index.ts`

```typescript
// ========================================
// AGREGAR NUEVOS EXPORTS
// ========================================

export {
  OAuthClientRegistrationRequest,
  OAuthClientRegistrationResponse,
  OAuthClientCredentials,
  ClientRegistrationError,
} from './types';
```

---

## Flujo de Ejecución

### Flujo Completo de Authorization con Dynamic Client Registration

```
┌────────────────────────────────────────────────────────────────┐
│ 1. Usuario: Click "Connect to MCP Server"                     │
│    - UI: OAuthConnectionDialog se muestra                     │
└────────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────────┐
│ 2. OAuthService.authorize({ serverId, mcpServerUrl })          │
│    - No clientId proporcionado                                 │
└────────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────────┐
│ 3. Discovery: discoverAuthServer(mcpServerUrl)                 │
│    GET https://mcp.example.com/.well-known/oauth-protected-resource│
│    → { authorization_servers: ["https://auth.example.com"] }   │
└────────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────────┐
│ 4. Fetch Metadata: fetchServerMetadata(authServerId)          │
│    GET https://auth.example.com/.well-known/oauth-authorization-server│
│    → {                                                         │
│         authorization_endpoint: "https://auth.example.com/authorize"│
│         token_endpoint: "https://auth.example.com/token"       │
│         registration_endpoint: "https://auth.example.com/register"│
│         ...                                                    │
│      }                                                         │
└────────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────────┐
│ 5. Check: supportsClientRegistration(metadata)                │
│    → TRUE (registration_endpoint exists)                      │
└────────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────────┐
│ 6. Dynamic Client Registration:                               │
│    POST https://auth.example.com/register                     │
│    Body: {                                                     │
│      client_name: "Levante",                                   │
│      redirect_uris: ["http://127.0.0.1/callback"],            │
│      grant_types: ["authorization_code", "refresh_token"],     │
│      response_types: ["code"],                                 │
│      token_endpoint_auth_method: "none",                       │
│      scope: "mcp:read mcp:write"                               │
│    }                                                           │
│    → Response: {                                               │
│         client_id: "abc123...",                                │
│         client_secret: "xyz789..." (opcional)                  │
│      }                                                         │
└────────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────────┐
│ 7. Save Client Credentials (Encrypted):                       │
│    PreferencesService.set(                                     │
│      "mcpServers.{serverId}.oauth.clientCredentials",          │
│      {                                                         │
│        clientId: "abc123...",                                  │
│        clientSecret: "ENCRYPTED:...",                          │
│        registeredAt: 1703980800000,                            │
│        authServerId: "https://auth.example.com"                │
│      }                                                         │
│    )                                                           │
└────────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────────┐
│ 8. Continue with OAuth Flow (Authorization Code + PKCE)       │
│    - Generate PKCE (verifier + challenge)                     │
│    - Generate state                                            │
│    - Start loopback server                                     │
│    - Open browser with authorization URL                       │
│    - Wait for callback                                         │
│    - Exchange code for tokens                                  │
│    - Save tokens (encrypted)                                   │
└────────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────────┐
│ 9. Success: Connection Established                            │
│    UI: Show success message                                    │
│    MCP: Connect to server with OAuth tokens                    │
└────────────────────────────────────────────────────────────────┘
```

### Estructura de Datos en Preferences

Después de completar la Fase 5, el archivo `ui-preferences.json` tendrá:

```json
{
  "mcpServers": {
    "github-mcp": {
      "id": "github-mcp",
      "name": "GitHub MCP Server",
      "transport": "http",
      "baseUrl": "https://mcp.github.com",
      "oauth": {
        "enabled": true,
        "authServerId": "https://auth.github.com",
        "scopes": ["mcp:read", "mcp:write"],
        "redirectUri": "http://127.0.0.1/callback",
        "clientCredentials": {
          "clientId": "levante-abc123",
          "clientSecret": "ENCRYPTED:aGVsbG8gd29ybGQ=...",
          "registeredAt": 1703980800000,
          "authServerId": "https://auth.github.com",
          "registrationMetadata": {
            "client_secret_expires_at": 0,
            "registration_access_token": "ENCRYPTED:cmVnaXN0cmF0aW9u...",
            "registration_client_uri": "https://auth.github.com/clients/abc123"
          }
        }
      }
    }
  },
  "oauthTokens": {
    "github-mcp": {
      "accessToken": "ENCRYPTED:YWNjZXNzVG9rZW4=...",
      "refreshToken": "ENCRYPTED:cmVmcmVzaFRva2Vu...",
      "expiresAt": 1703984400000,
      "tokenType": "Bearer",
      "scope": "mcp:read mcp:write",
      "issuedAt": 1703980800000
    }
  }
}
```

---

## Plan de Testing

### 1. Unit Tests para OAuthDiscoveryService

**Archivo**: `src/main/services/oauth/__tests__/OAuthDiscoveryService.test.ts`

**Agregar al final del archivo**:

```typescript
// ========================================
// PHASE 5: DYNAMIC CLIENT REGISTRATION TESTS
// ========================================

describe('OAuthDiscoveryService - Dynamic Client Registration', () => {
  let discovery: OAuthDiscoveryService;
  let mockFetch: MockFetch;

  beforeEach(() => {
    discovery = new OAuthDiscoveryService();
    mockFetch = new MockFetch();
    global.fetch = mockFetch.fetch;
  });

  describe('registerClient()', () => {
    it('should successfully register client with Authorization Server', async () => {
      // Mock registration endpoint response
      mockFetch.mockResponse('https://auth.example.com/register', {
        client_id: 'levante-abc123',
        client_name: 'Levante',
        redirect_uris: ['http://127.0.0.1/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        client_id_issued_at: 1703980800,
      });

      const credentials = await discovery.registerClient(
        'https://auth.example.com/register',
        'https://auth.example.com'
      );

      expect(credentials.clientId).toBe('levante-abc123');
      expect(credentials.authServerId).toBe('https://auth.example.com');
      expect(credentials.registeredAt).toBeGreaterThan(0);
      expect(credentials.clientSecret).toBeUndefined(); // Public client
    });

    it('should handle confidential client with client_secret', async () => {
      // Mock registration endpoint response with client_secret
      mockFetch.mockResponse('https://auth.example.com/register', {
        client_id: 'levante-confidential',
        client_secret: 'super-secret-xyz',
        client_secret_expires_at: 0,
        redirect_uris: ['http://127.0.0.1/callback'],
      });

      const credentials = await discovery.registerClient(
        'https://auth.example.com/register',
        'https://auth.example.com'
      );

      expect(credentials.clientId).toBe('levante-confidential');
      expect(credentials.clientSecret).toBe('super-secret-xyz');
      expect(credentials.registrationMetadata?.client_secret_expires_at).toBe(0);
    });

    it('should include registration access token if provided', async () => {
      // Mock registration endpoint response with registration_access_token
      mockFetch.mockResponse('https://auth.example.com/register', {
        client_id: 'levante-abc123',
        registration_access_token: 'rat-token-xyz',
        registration_client_uri: 'https://auth.example.com/clients/abc123',
      });

      const credentials = await discovery.registerClient(
        'https://auth.example.com/register',
        'https://auth.example.com'
      );

      expect(credentials.registrationMetadata?.registration_access_token).toBe('rat-token-xyz');
      expect(credentials.registrationMetadata?.registration_client_uri).toBe(
        'https://auth.example.com/clients/abc123'
      );
    });

    it('should throw ClientRegistrationError on HTTP 400 Bad Request', async () => {
      // Mock error response
      mockFetch.mockErrorResponse('https://auth.example.com/register', 400, {
        error: 'invalid_client_metadata',
        error_description: 'Invalid redirect_uri format',
      });

      await expect(
        discovery.registerClient('https://auth.example.com/register', 'https://auth.example.com')
      ).rejects.toThrow(ClientRegistrationError);

      try {
        await discovery.registerClient(
          'https://auth.example.com/register',
          'https://auth.example.com'
        );
      } catch (error) {
        expect(error).toBeInstanceOf(ClientRegistrationError);
        expect((error as ClientRegistrationError).code).toBe('invalid_client_metadata');
        expect((error as ClientRegistrationError).statusCode).toBe(400);
      }
    });

    it('should throw ClientRegistrationError on network error', async () => {
      // Mock network failure
      mockFetch.mockNetworkError('https://auth.example.com/register');

      await expect(
        discovery.registerClient('https://auth.example.com/register', 'https://auth.example.com')
      ).rejects.toThrow(ClientRegistrationError);

      try {
        await discovery.registerClient(
          'https://auth.example.com/register',
          'https://auth.example.com'
        );
      } catch (error) {
        expect(error).toBeInstanceOf(ClientRegistrationError);
        expect((error as ClientRegistrationError).code).toBe('network_error');
      }
    });

    it('should reject HTTP endpoints (require HTTPS)', async () => {
      await expect(
        discovery.registerClient('http://auth.example.com/register', 'http://auth.example.com')
      ).rejects.toThrow('Registration endpoint must use HTTPS');
    });

    it('should allow HTTP for localhost', async () => {
      // Mock localhost registration endpoint
      mockFetch.mockResponse('http://localhost:8080/register', {
        client_id: 'local-client',
      });

      const credentials = await discovery.registerClient(
        'http://localhost:8080/register',
        'http://localhost:8080'
      );

      expect(credentials.clientId).toBe('local-client');
    });

    it('should throw if response missing client_id', async () => {
      // Mock invalid response (missing client_id)
      mockFetch.mockResponse('https://auth.example.com/register', {
        client_name: 'Levante',
        // Missing client_id
      });

      await expect(
        discovery.registerClient('https://auth.example.com/register', 'https://auth.example.com')
      ).rejects.toThrow('Registration response missing client_id');
    });
  });

  describe('supportsClientRegistration()', () => {
    it('should return true if registration_endpoint exists', () => {
      const metadata = {
        authorization_endpoint: 'https://auth.example.com/authorize',
        token_endpoint: 'https://auth.example.com/token',
        registration_endpoint: 'https://auth.example.com/register',
      };

      expect(discovery.supportsClientRegistration(metadata)).toBe(true);
    });

    it('should return false if registration_endpoint is missing', () => {
      const metadata = {
        authorization_endpoint: 'https://auth.example.com/authorize',
        token_endpoint: 'https://auth.example.com/token',
      };

      expect(discovery.supportsClientRegistration(metadata)).toBe(false);
    });

    it('should return false if registration_endpoint is null/undefined', () => {
      expect(discovery.supportsClientRegistration({ registration_endpoint: null })).toBe(false);
      expect(discovery.supportsClientRegistration({ registration_endpoint: undefined })).toBe(
        false
      );
      expect(discovery.supportsClientRegistration({})).toBe(false);
    });
  });
});
```

### 2. Integration Tests

**Archivo**: `src/main/services/oauth/__tests__/dynamic-client-registration.test.ts` (NUEVO)

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OAuthService } from '../OAuthService';
import { PreferencesService } from '../../preferences/PreferencesService';
import { MockAuthServer } from './mocks/MockAuthServer';
import { MockMcpServer } from './mocks/MockMcpServer';

describe('Dynamic Client Registration - Integration', () => {
  let oauthService: OAuthService;
  let preferencesService: PreferencesService;
  let mockAuthServer: MockAuthServer;
  let mockMcpServer: MockMcpServer;

  beforeEach(async () => {
    // Setup mock servers
    mockAuthServer = new MockAuthServer();
    await mockAuthServer.start();

    mockMcpServer = new MockMcpServer({
      authorizationServers: [mockAuthServer.baseUrl],
    });
    await mockMcpServer.start();

    // Setup services
    preferencesService = new PreferencesService();
    await preferencesService.initialize();

    oauthService = new OAuthService(preferencesService);
  });

  afterEach(async () => {
    await mockAuthServer.stop();
    await mockMcpServer.stop();
  });

  it('should complete full OAuth flow with Dynamic Client Registration', async () => {
    // Enable Dynamic Client Registration on mock server
    mockAuthServer.enableDynamicRegistration({
      client_id: 'auto-registered-client',
      client_secret: 'auto-secret-xyz',
    });

    // Mock user authorization (auto-approve)
    mockAuthServer.setAutoApprove(true);

    // Start OAuth flow WITHOUT providing client_id
    const result = await oauthService.authorize({
      serverId: 'test-server',
      mcpServerUrl: mockMcpServer.baseUrl,
      // clientId: NOT PROVIDED - should trigger Dynamic Registration
      scopes: ['mcp:read', 'mcp:write'],
    });

    // Verify success
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify Dynamic Registration was called
    expect(mockAuthServer.registrationCalled).toBe(true);
    expect(mockAuthServer.lastRegistrationRequest).toMatchObject({
      client_name: 'Levante',
      redirect_uris: ['http://127.0.0.1/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });

    // Verify client credentials were saved
    const savedCredentials = await preferencesService.get(
      'mcpServers.test-server.oauth.clientCredentials'
    );
    expect(savedCredentials).toBeDefined();
    expect(savedCredentials.clientId).toBe('auto-registered-client');
    expect(savedCredentials.clientSecret).toMatch(/^ENCRYPTED:/);

    // Verify tokens were saved
    const savedTokens = await preferencesService.get('oauthTokens.test-server');
    expect(savedTokens).toBeDefined();
    expect(savedTokens.accessToken).toMatch(/^ENCRYPTED:/);
  });

  it('should fail gracefully when Dynamic Registration is not supported', async () => {
    // Disable Dynamic Client Registration on mock server
    mockAuthServer.disableDynamicRegistration();

    // Start OAuth flow WITHOUT providing client_id
    const result = await oauthService.authorize({
      serverId: 'test-server',
      mcpServerUrl: mockMcpServer.baseUrl,
      scopes: ['mcp:read', 'mcp:write'],
    });

    // Verify failure
    expect(result.success).toBe(false);
    expect(result.error).toContain('does not support Dynamic Client Registration');

    // Verify no credentials were saved
    const savedCredentials = await preferencesService.get(
      'mcpServers.test-server.oauth.clientCredentials'
    );
    expect(savedCredentials).toBeUndefined();
  });

  it('should use provided client_id and skip Dynamic Registration', async () => {
    // Enable Dynamic Client Registration (but it should be skipped)
    mockAuthServer.enableDynamicRegistration({
      client_id: 'should-not-be-used',
    });

    // Mock user authorization
    mockAuthServer.setAutoApprove(true);

    // Start OAuth flow WITH provided client_id
    const result = await oauthService.authorize({
      serverId: 'test-server',
      mcpServerUrl: mockMcpServer.baseUrl,
      clientId: 'manual-client-id', // Provided manually
      scopes: ['mcp:read', 'mcp:write'],
    });

    // Verify success
    expect(result.success).toBe(true);

    // Verify Dynamic Registration was NOT called
    expect(mockAuthServer.registrationCalled).toBe(false);

    // Verify tokens were saved (authorization succeeded with manual client_id)
    const savedTokens = await preferencesService.get('oauthTokens.test-server');
    expect(savedTokens).toBeDefined();
  });

  it('should handle Dynamic Registration errors gracefully', async () => {
    // Enable Dynamic Client Registration but simulate error
    mockAuthServer.enableDynamicRegistration(
      {
        client_id: 'will-fail',
      },
      true // simulateError
    );

    // Start OAuth flow
    const result = await oauthService.authorize({
      serverId: 'test-server',
      mcpServerUrl: mockMcpServer.baseUrl,
      scopes: ['mcp:read', 'mcp:write'],
    });

    // Verify failure
    expect(result.success).toBe(false);
    expect(result.error).toContain('Dynamic Client Registration failed');

    // Verify Dynamic Registration was attempted
    expect(mockAuthServer.registrationCalled).toBe(true);

    // Verify no credentials or tokens were saved
    const savedCredentials = await preferencesService.get(
      'mcpServers.test-server.oauth.clientCredentials'
    );
    expect(savedCredentials).toBeUndefined();

    const savedTokens = await preferencesService.get('oauthTokens.test-server');
    expect(savedTokens).toBeUndefined();
  });
});
```

### 3. Mock Helpers (si no existen ya)

**Archivo**: `src/main/services/oauth/__tests__/mocks/MockFetch.ts` (usar o actualizar el existente)

```typescript
export class MockFetch {
  private responses = new Map<string, any>();
  private errors = new Map<string, Error>();

  fetch = async (url: string, options?: RequestInit): Promise<Response> => {
    // Check for error first
    if (this.errors.has(url)) {
      throw this.errors.get(url);
    }

    // Check for mock response
    if (this.responses.has(url)) {
      const data = this.responses.get(url);

      if (data.status && data.status >= 400) {
        // Error response
        return new Response(JSON.stringify(data.body || {}), {
          status: data.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Success response
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // No mock found
    throw new Error(`No mock response for ${url}`);
  };

  mockResponse(url: string, data: any) {
    this.responses.set(url, data);
  }

  mockErrorResponse(url: string, status: number, body: any) {
    this.responses.set(url, { status, body });
  }

  mockNetworkError(url: string) {
    this.errors.set(url, new Error('Network error'));
  }

  reset() {
    this.responses.clear();
    this.errors.clear();
  }
}
```

---

## Integración con Fases Previas

### Compatibilidad con Fases 1-4

La Fase 5 se integra perfectamente con las fases anteriores:

**Fase 1 (Token Store)**: ✅ Compatible
- `OAuthTokenStore` sigue funcionando igual
- Los tokens se guardan de la misma forma
- Nueva información: `clientCredentials` en config

**Fase 2 (OAuth Flow)**: ✅ Compatible
- `OAuthFlowManager` actualizado para soportar `clientSecret`
- `OAuthRedirectServer` sin cambios
- `OAuthStateManager` sin cambios

**Fase 3 (Discovery)**: ✅ Extendido
- `OAuthDiscoveryService` con nuevo método `registerClient()`
- Métodos existentes sin cambios
- Nuevo método helper `supportsClientRegistration()`

**Fase 4 (HTTP Client)**: ✅ Compatible
- `OAuthHttpClient` sin cambios
- `OAuthService` actualizado con lógica de Dynamic Registration
- Transportes MCP sin cambios

### Flujo Backward Compatible

```typescript
// Caso 1: Servidor CON Dynamic Registration (NUEVO)
await oauthService.authorize({
  serverId: 'github-mcp',
  mcpServerUrl: 'https://mcp.github.com',
  // No clientId → Dynamic Registration automático
});

// Caso 2: Servidor SIN Dynamic Registration (EXISTENTE)
await oauthService.authorize({
  serverId: 'custom-mcp',
  mcpServerUrl: 'https://mcp.custom.com',
  clientId: 'manual-client-123', // Provisto manualmente
});

// Caso 3: Servidor SIN OAuth (EXISTENTE)
await mcpService.connectServer({
  id: 'local-mcp',
  transport: 'stdio',
  command: 'npx',
  args: ['@modelcontextprotocol/server-filesystem'],
  // oauth no habilitado → flujo normal
});
```

---

## Consideraciones de Seguridad

### 1. Encriptación de Client Credentials

**Amenaza**: Robo de `client_secret` del filesystem

**Mitigación**:
```typescript
// ✅ BIEN: client_secret encriptado
const credentials = {
  clientId: 'levante-abc',
  clientSecret: 'ENCRYPTED:aGVsbG8gd29ybGQ=...', // Encrypted with safeStorage
};

// ❌ MAL: client_secret en plaintext
const credentials = {
  clientId: 'levante-abc',
  clientSecret: 'my-super-secret-xyz', // VULNERABLE
};
```

### 2. Validación de Registration Endpoint

**Amenaza**: Registro ante servidor malicioso

**Mitigación**:
```typescript
// Validar que registration_endpoint usa HTTPS
const url = new URL(registrationEndpoint);
if (url.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
  throw new ClientRegistrationError('Registration endpoint must use HTTPS', 'invalid_endpoint');
}

// Validar que registration_endpoint está en metadata del AS
if (metadata.registrationEndpoint !== registrationEndpoint) {
  throw new SecurityError('Registration endpoint mismatch');
}
```

### 3. Metadata Mínima en Registro

**Amenaza**: Solicitud de permisos excesivos

**Mitigación**:
```typescript
// ✅ BIEN: Solo permisos necesarios
const registrationRequest = {
  client_name: 'Levante',
  redirect_uris: ['http://127.0.0.1/callback'], // Solo loopback
  grant_types: ['authorization_code', 'refresh_token'], // Solo necesarios
  response_types: ['code'], // Solo Authorization Code
  token_endpoint_auth_method: 'none', // Public client (PKCE)
  scope: 'mcp:read mcp:write', // Scopes mínimos
};

// ❌ MAL: Permisos excesivos
const registrationRequest = {
  scope: 'mcp:read mcp:write mcp:delete mcp:admin', // Demasiados permisos
  grant_types: ['authorization_code', 'implicit', 'password'], // Flujos inseguros
};
```

### 4. Logging Seguro

**Amenaza**: Exposición de `client_secret` en logs

**Mitigación**:
```typescript
// ✅ BIEN: Nunca loggear client_secret completo
this.logger.mcp.info('Dynamic Client Registration successful', {
  clientId: this.sanitizeForLog(credentials.clientId),
  hasClientSecret: !!credentials.clientSecret, // Boolean, no valor
});

// ❌ MAL: client_secret en logs
this.logger.mcp.info('Registered', {
  clientSecret: credentials.clientSecret, // VULNERABLE
});
```

### 5. Validación de Response

**Amenaza**: Response malformado o malicioso

**Mitigación**:
```typescript
// Validar campos requeridos
if (!data.client_id) {
  throw new ClientRegistrationError('Registration response missing client_id', 'invalid_response');
}

// Validar tipos
if (typeof data.client_id !== 'string') {
  throw new ClientRegistrationError('Invalid client_id type', 'invalid_response');
}

// Validar expiration (si aplica)
if (data.client_secret_expires_at && data.client_secret_expires_at > 0) {
  const expiresAt = data.client_secret_expires_at * 1000; // Convert to ms
  const now = Date.now();

  if (expiresAt < now) {
    this.logger.mcp.warn('Client secret already expired', {
      expiresAt,
      now,
    });
  }
}
```

---

## Próximos Pasos

### Después de la Fase 5

1. **Testing Manual**: Probar con Authorization Servers reales que soporten Dynamic Registration
   - Google OAuth (soporta RFC 7591)
   - GitHub OAuth (no soporta, verificar error handling)
   - Auth0 (soporta, validar flujo completo)

2. **Documentación de Usuario**: Crear guía sobre:
   - Qué es Dynamic Client Registration
   - Qué hacer si el servidor no lo soporta
   - Cómo verificar si funcionó correctamente

3. **Fase 6 - UI y Revocación**: Siguiente fase incluye:
   - UI para ver clientes registrados
   - Botón para "Re-register" si client_secret expiró
   - Token revocation (RFC 7009) al desconectar
   - Gestión de permisos OAuth

### TO-DOs Pendientes (Futuras Iteraciones)

Según el plan original, quedan pendientes:

1. **Estrategia de Fallback** cuando Dynamic Registration no está disponible:
   - Client IDs embebidos para proveedores conocidos (Google, GitHub, etc.)
   - Configuración de `client_id` en el MCP server config
   - Combinación de ambas estrategias

2. **Client Metadata Management**:
   - Actualización de metadata de cliente registrado
   - Manejo de expiración de `client_secret`
   - Re-registro automático cuando credenciales expiran

3. **Client Deletion**:
   - Revocar registro cuando usuario desconecta servidor MCP permanentemente
   - Limpieza de credenciales huérfanas

---

## Resumen de Archivos Modificados/Creados

### Archivos Modificados

1. **`src/main/services/oauth/types.ts`**
   - ➕ `OAuthClientRegistrationRequest` interface
   - ➕ `OAuthClientRegistrationResponse` interface
   - ➕ `OAuthClientCredentials` interface
   - ➕ `ClientRegistrationError` class
   - 🔧 `MCPServerConfig.oauth.clientCredentials` field

2. **`src/main/services/oauth/OAuthDiscoveryService.ts`**
   - ➕ `registerClient()` method
   - ➕ `supportsClientRegistration()` helper method

3. **`src/main/services/oauth/OAuthService.ts`**
   - 🔧 `authorize()` method - integrar Dynamic Registration
   - ➕ `saveClientCredentials()` private method
   - ➕ `getClientCredentials()` private method
   - 🔧 `saveOAuthConfig()` method
   - ➕ `sanitizeForLog()` helper method

4. **`src/main/services/oauth/OAuthFlowManager.ts`**
   - 🔧 `exchangeCodeForTokens()` - agregar parámetro `clientSecret`

5. **`src/main/services/oauth/index.ts`**
   - ➕ Exports para nuevos tipos

### Archivos Creados (Tests)

6. **`src/main/services/oauth/__tests__/OAuthDiscoveryService.test.ts`**
   - ➕ Tests para `registerClient()`
   - ➕ Tests para `supportsClientRegistration()`

7. **`src/main/services/oauth/__tests__/dynamic-client-registration.test.ts`** (NUEVO)
   - ➕ Integration tests completos del flujo

8. **`src/main/services/oauth/__tests__/mocks/MockFetch.ts`** (si no existe)
   - ➕ Mock helpers para tests

---

## Checklist de Implementación

Antes de considerar la Fase 5 completa, verificar:

### Código
- [ ] Todos los tipos TypeScript definidos
- [ ] `OAuthDiscoveryService.registerClient()` implementado
- [ ] `OAuthService.authorize()` actualizado con Dynamic Registration
- [ ] `OAuthFlowManager.exchangeCodeForTokens()` soporta `clientSecret`
- [ ] Encriptación de `clientSecret` y `registration_access_token`
- [ ] Manejo de errores cuando Dynamic Registration no está disponible
- [ ] Logging seguro (sin exponer secrets)

### Testing
- [ ] Unit tests para `registerClient()` (éxito y errores)
- [ ] Unit tests para `supportsClientRegistration()`
- [ ] Integration tests del flujo completo
- [ ] Tests de error handling
- [ ] Tests de encriptación/desencriptación

### Seguridad
- [ ] HTTPS enforcement para registration endpoint
- [ ] Validación de response de registro
- [ ] No loggear `client_secret` completo
- [ ] Encriptación con `safeStorage`
- [ ] Metadata mínima en registro (principio de mínimo privilegio)

### Integración
- [ ] Compatible con Fases 1-4
- [ ] No rompe flujos existentes
- [ ] Backward compatible con servidores sin Dynamic Registration

### Documentación
- [ ] Este documento completado
- [ ] Comentarios en código
- [ ] Actualizaciones en plan principal de OAuth

---

**Fin del Documento**

*Última actualización*: 2025-12-21
*Versión*: 1.0
*Autor*: Arquitectura Levante
*Estado*: Listo para implementación
