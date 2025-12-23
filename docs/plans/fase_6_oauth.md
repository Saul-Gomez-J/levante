# Fase 6: Revocación de Tokens, Disconnect y UI Final - OAuth para Levante

## Información del Documento

- **Versión**: 1.0
- **Fecha**: 2025-12-21
- **Estado**: Plan de Implementación
- **Prerrequisitos**: Fases 1-5 completadas
- **Duración Estimada**: 1-2 semanas

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Objetivos de la Fase 6](#objetivos-de-la-fase-6)
3. [Plan de Implementación](#plan-de-implementación)
4. [Paso 1: Token Revocation (RFC 7009)](#paso-1-token-revocation-rfc-7009)
5. [Paso 2: IPC Handlers](#paso-2-ipc-handlers)
6. [Paso 3: Zustand Store para OAuth](#paso-3-zustand-store-para-oauth)
7. [Paso 4: Componentes UI](#paso-4-componentes-ui)
8. [Paso 5: Hook Personalizado useOAuth](#paso-5-hook-personalizado-useoauth)
9. [Paso 6: Integración con Settings](#paso-6-integración-con-settings)
10. [Testing](#testing)
11. [Consideraciones de Seguridad](#consideraciones-de-seguridad)
12. [Checklist de Implementación](#checklist-de-implementación)

---

## Resumen Ejecutivo

La Fase 6 completa la implementación OAuth de Levante añadiendo:

- **Token Revocation (RFC 7009)**: Revocación segura de tokens al desconectar
- **IPC Handlers completos**: Autorización, desconexión, estado y refresh manual
- **Zustand Store**: Gestión de estado OAuth en el renderer
- **UI Components**: Dialogs, vistas de permisos e indicadores de estado
- **Integración Settings**: Panel de gestión OAuth en Settings > MCP

### Arquitectura de la Fase 6

```
┌─────────────────────────────────────────────────────────────┐
│                    RENDERER PROCESS                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  UI Components (Fase 6)                              │   │
│  │  ├── OAuthConnectionDialog                           │   │
│  │  ├── OAuthPermissionsView                            │   │
│  │  ├── OAuthStatusIndicator                            │   │
│  │  └── MCPSection (extendido)                          │   │
│  └──────────────────────────────────────────────────────┘   │
│                         │                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  State Management                                     │   │
│  │  ├── oauthStore (Zustand) ← NUEVO                    │   │
│  │  └── useOAuth hook ← NUEVO                           │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │ IPC (levante/oauth/*)
┌─────────────────────────────────────────────────────────────┐
│                     MAIN PROCESS                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  IPC Handlers (oauthHandlers.ts)                     │   │
│  │  ├── levante/oauth/authorize ← NUEVO                 │   │
│  │  ├── levante/oauth/disconnect ← NUEVO                │   │
│  │  ├── levante/oauth/status ← NUEVO                    │   │
│  │  ├── levante/oauth/refresh ← NUEVO                   │   │
│  │  └── levante/oauth/list ← NUEVO                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                         │                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  OAuthService (existente)                            │   │
│  │  └── disconnect() → EXTENDIDO con revocación        │   │
│  └──────────────────────────────────────────────────────┘   │
│                         │                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  OAuthFlowManager (Fase 2)                           │   │
│  │  └── revokeToken() ← NUEVO (RFC 7009)               │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Objetivos de la Fase 6

1. ✅ **Token Revocation**: RFC 7009 para revocación segura de tokens
2. ✅ **IPC Completo**: Handlers para autorización, desconexión, estado y refresh
3. ✅ **Estado Global**: Zustand store para OAuth en renderer
4. ✅ **UI Completa**: Dialogs, vistas de permisos e indicadores de estado
5. ✅ **Integración Settings**: Panel OAuth en Settings > MCP
6. ✅ **Testing Completo**: Unit, integration y E2E tests

---

## Plan de Implementación

### Orden de Implementación

```
Paso 1: Token Revocation (RFC 7009)
   └── OAuthFlowManager.revokeToken()
   └── OAuthService.disconnect() (extender)
   └── Tests de revocación

Paso 2: IPC Handlers
   └── oauthHandlers.ts (extender)
   └── Handlers para authorize, disconnect, status, refresh, list

Paso 3: Zustand Store
   └── oauthStore.ts
   └── Actions: authorize, disconnect, refresh, getStatus

Paso 4: Componentes UI
   └── OAuthConnectionDialog.tsx
   └── OAuthPermissionsView.tsx
   └── OAuthStatusIndicator.tsx

Paso 5: Hook useOAuth
   └── useOAuth.ts
   └── Simplificar interacción con oauthStore

Paso 6: Integración Settings
   └── MCPSection.tsx (extender)
   └── Añadir panel OAuth

Testing
   └── Tests de revocación
   └── Tests de IPC
   └── Tests de componentes UI
   └── E2E tests
```

---

## Paso 1: Token Revocation (RFC 7009)

### 1.1. Extender `OAuthFlowManager` con `revokeToken()`

**Archivo**: `src/main/services/oauth/OAuthFlowManager.ts`

**Modificación**: Añadir método para revocar tokens según RFC 7009.

```typescript
// Añadir al final de la clase OAuthFlowManager

/**
 * Revoca un token (access o refresh) según RFC 7009
 *
 * @param params - Parámetros de revocación
 */
async revokeToken(params: {
    revocationEndpoint: string;
    token: string;
    tokenTypeHint?: 'access_token' | 'refresh_token';
    clientId: string;
    clientSecret?: string;
}): Promise<void> {
    try {
        this.logger.core.info('Revoking token', {
            revocationEndpoint: params.revocationEndpoint,
            tokenTypeHint: params.tokenTypeHint,
        });

        // Construir body según RFC 7009
        const body = new URLSearchParams({
            token: params.token,
            client_id: params.clientId,
        });

        // Token type hint (opcional pero recomendado)
        if (params.tokenTypeHint) {
            body.set('token_type_hint', params.tokenTypeHint);
        }

        // Client secret (solo confidential clients)
        if (params.clientSecret) {
            body.set('client_secret', params.clientSecret);
        }

        // Hacer request
        const response = await fetch(params.revocationEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body: body.toString(),
        });

        // RFC 7009: El servidor DEBE responder con 200 OK
        // incluso si el token era inválido o ya estaba revocado
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            this.logger.core.error('Token revocation failed', {
                status: response.status,
                error: data.error,
                errorDescription: data.error_description,
            });

            throw new OAuthFlowError(
                `Token revocation failed: ${data.error_description || data.error || response.statusText}`,
                'TOKEN_REVOCATION_FAILED',
                {
                    status: response.status,
                    error: data.error,
                    errorDescription: data.error_description,
                }
            );
        }

        this.logger.core.info('Token revoked successfully');
    } catch (error) {
        if (error instanceof OAuthFlowError) {
            throw error;
        }

        this.logger.core.error('Token revocation error', {
            error: error instanceof Error ? error.message : error,
        });

        throw new OAuthFlowError(
            'Failed to revoke token',
            'TOKEN_REVOCATION_FAILED',
            { error }
        );
    }
}
```

**Añadir al archivo `types.ts`**:

```typescript
// Añadir a src/main/services/oauth/types.ts

/**
 * Parámetros para revocación de token (RFC 7009)
 */
export interface TokenRevocationParams {
    /** Revocation endpoint del AS */
    revocationEndpoint: string;

    /** Token a revocar (access o refresh) */
    token: string;

    /** Hint del tipo de token */
    tokenTypeHint?: 'access_token' | 'refresh_token';

    /** Client ID */
    clientId: string;

    /** Client secret (solo confidential clients) */
    clientSecret?: string;
}
```

**Actualizar OAuthFlowError** en `types.ts`:

```typescript
// Modificar el tipo OAuthFlowError para incluir TOKEN_REVOCATION_FAILED
export class OAuthFlowError extends Error {
    constructor(
        message: string,
        public readonly code:
            | 'PKCE_GENERATION_FAILED'
            | 'INVALID_STATE'
            | 'STATE_EXPIRED'
            | 'AUTHORIZATION_DENIED'
            | 'TOKEN_EXCHANGE_FAILED'
            | 'TOKEN_REFRESH_FAILED'
            | 'TOKEN_REVOCATION_FAILED'  // ← NUEVO
            | 'LOOPBACK_SERVER_FAILED'
            | 'CALLBACK_TIMEOUT'
            | 'INVALID_RESPONSE',
        public readonly details?: any
    ) {
        super(message);
        this.name = 'OAuthFlowError';
    }
}
```

### 1.2. Extender `OAuthService.disconnect()` con Revocación

**Archivo**: `src/main/services/oauth/OAuthService.ts`

**Modificación**: Reemplazar el método `disconnect` actual.

```typescript
/**
 * Disconnect server and optionally revoke tokens (Fase 6)
 */
async disconnect(params: DisconnectParams): Promise<void> {
    const { serverId, revokeTokens = true } = params;  // Default: true

    logger.core.info('Disconnecting OAuth server', {
        serverId,
        revokeTokens,
    });

    try {
        // Fase 6: Token revocation
        if (revokeTokens) {
            logger.core.info('Attempting token revocation', { serverId });

            // Get tokens
            const tokens = await this.tokenStore.getTokens(serverId);

            // Get OAuth config
            const config = await this.preferencesService.get(
                `mcpServers.${serverId}.oauth`
            ) as OAuthServerConfig | undefined;

            if (tokens && config?.authServerId) {
                try {
                    // Get auth server metadata
                    const metadata = await this.discoveryService.fetchServerMetadata(
                        config.authServerId
                    );

                    // Check if revocation is supported
                    if (metadata.revocation_endpoint) {
                        // Revocar refresh token primero (invalida también el access token)
                        if (tokens.refreshToken) {
                            await this.flowManager.revokeToken({
                                revocationEndpoint: metadata.revocation_endpoint,
                                token: tokens.refreshToken,
                                tokenTypeHint: 'refresh_token',
                                clientId: config.clientId!,
                                clientSecret: config.clientSecret,
                            });

                            logger.core.info('Refresh token revoked', { serverId });
                        }

                        // Revocar access token
                        await this.flowManager.revokeToken({
                            revocationEndpoint: metadata.revocation_endpoint,
                            token: tokens.accessToken,
                            tokenTypeHint: 'access_token',
                            clientId: config.clientId!,
                            clientSecret: config.clientSecret,
                        });

                        logger.core.info('Access token revoked', { serverId });
                    } else {
                        logger.core.warn('Authorization server does not support token revocation', {
                            serverId,
                            authServerId: config.authServerId,
                        });
                    }
                } catch (revocationError) {
                    // Log error but continue with disconnect
                    logger.core.error('Token revocation failed, continuing with disconnect', {
                        serverId,
                        error: revocationError instanceof Error
                            ? revocationError.message
                            : revocationError,
                    });
                }
            }
        }

        // Delete tokens (siempre, incluso si revocación falló)
        await this.tokenStore.deleteTokens(serverId);

        // Remove OAuth config
        await this.preferencesService.set(`mcpServers.${serverId}.oauth`, undefined);

        logger.core.info('Server disconnected successfully', { serverId });
    } catch (error) {
        logger.core.error('Error during disconnect', {
            serverId,
            error: error instanceof Error ? error.message : error,
        });

        throw error;
    }
}
```

### 1.3. Test de Token Revocation

**Archivo**: `src/main/services/oauth/__tests__/OAuthFlowManager.test.ts`

**Añadir test**:

```typescript
describe('Token Revocation (Fase 6)', () => {
    it('should revoke access token', async () => {
        const flowManager = new OAuthFlowManager();

        // Mock revocation endpoint
        const mockRevocationEndpoint = 'https://auth.example.com/revoke';

        // Mock fetch
        global.fetch = vi.fn().mockResolvedValueOnce(
            new Response(null, { status: 200 })
        );

        await flowManager.revokeToken({
            revocationEndpoint: mockRevocationEndpoint,
            token: 'mock-access-token',
            tokenTypeHint: 'access_token',
            clientId: 'test-client',
        });

        // Verify fetch was called correctly
        expect(global.fetch).toHaveBeenCalledWith(
            mockRevocationEndpoint,
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Content-Type': 'application/x-www-form-urlencoded',
                }),
                body: expect.stringContaining('token=mock-access-token'),
            })
        );
    });

    it('should revoke refresh token with client secret', async () => {
        const flowManager = new OAuthFlowManager();

        global.fetch = vi.fn().mockResolvedValueOnce(
            new Response(null, { status: 200 })
        );

        await flowManager.revokeToken({
            revocationEndpoint: 'https://auth.example.com/revoke',
            token: 'mock-refresh-token',
            tokenTypeHint: 'refresh_token',
            clientId: 'test-client',
            clientSecret: 'test-secret',
        });

        const fetchCall = (global.fetch as any).mock.calls[0];
        const body = fetchCall[1].body;

        expect(body).toContain('token=mock-refresh-token');
        expect(body).toContain('token_type_hint=refresh_token');
        expect(body).toContain('client_secret=test-secret');
    });

    it('should throw error if revocation fails', async () => {
        const flowManager = new OAuthFlowManager();

        global.fetch = vi.fn().mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    error: 'invalid_token',
                    error_description: 'Token is invalid',
                }),
                { status: 400 }
            )
        );

        await expect(
            flowManager.revokeToken({
                revocationEndpoint: 'https://auth.example.com/revoke',
                token: 'invalid-token',
                tokenTypeHint: 'access_token',
                clientId: 'test-client',
            })
        ).rejects.toThrow('Token revocation failed');
    });
});
```

---

## Paso 2: IPC Handlers

### 2.1. Extender `oauthHandlers.ts`

**Archivo**: `src/main/ipc/oauthHandlers.ts`

**Reemplazar contenido completo**:

```typescript
/**
 * OAuth IPC Handlers Module (Fase 6 - Completo)
 *
 * Handles:
 * - OAuth authorization flow
 * - Token management
 * - Connection status
 * - Token refresh
 * - Server disconnection with revocation
 */

import { ipcMain } from 'electron';
import { getLogger } from '../services/logging';
import { OAuthService } from '../services/oauth';
import { PreferencesService } from '../services/preferencesService';

const logger = getLogger();

// Singleton instances
let oauthService: OAuthService;
let preferencesService: PreferencesService;

/**
 * Initialize services
 */
async function initializeServices(): Promise<void> {
    if (!preferencesService) {
        preferencesService = new PreferencesService();
        await preferencesService.initialize();
    }

    if (!oauthService) {
        oauthService = new OAuthService(preferencesService);
    }
}

/**
 * Register all OAuth-related IPC handlers
 */
export function setupOAuthHandlers(): void {
    // Authorize (start OAuth flow)
    ipcMain.handle('levante/oauth/authorize', handleAuthorize);

    // Disconnect (revoke tokens)
    ipcMain.handle('levante/oauth/disconnect', handleDisconnect);

    // Get status
    ipcMain.handle('levante/oauth/status', handleStatus);

    // Refresh token manually
    ipcMain.handle('levante/oauth/refresh', handleRefresh);

    // List OAuth servers
    ipcMain.handle('levante/oauth/list', handleList);

    logger.core.info('OAuth handlers registered successfully');
}

/**
 * Start OAuth authorization flow
 */
async function handleAuthorize(
    _event: any,
    params: {
        serverId: string;
        mcpServerUrl: string;
        scopes?: string[];
        clientId?: string;
    }
): Promise<{
    success: boolean;
    error?: string;
    tokens?: any;
}> {
    try {
        await initializeServices();

        logger.core.info('IPC: Starting OAuth authorization', {
            serverId: params.serverId,
        });

        const result = await oauthService.authorize({
            serverId: params.serverId,
            mcpServerUrl: params.mcpServerUrl,
            scopes: params.scopes,
            clientId: params.clientId,
        });

        if (result.success) {
            logger.core.info('IPC: OAuth authorization successful', {
                serverId: params.serverId,
            });

            return {
                success: true,
                tokens: {
                    expiresAt: result.tokens?.expiresAt,
                    scope: result.tokens?.scope,
                },
            };
        } else {
            logger.core.error('IPC: OAuth authorization failed', {
                serverId: params.serverId,
                error: result.error,
            });

            return {
                success: false,
                error: result.error,
            };
        }
    } catch (error) {
        logger.core.error('IPC: OAuth authorization error', {
            serverId: params.serverId,
            error: error instanceof Error ? error.message : error,
        });

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Disconnect OAuth server and revoke tokens
 */
async function handleDisconnect(
    _event: any,
    params: {
        serverId: string;
        revokeTokens?: boolean;
    }
): Promise<{
    success: boolean;
    error?: string;
}> {
    try {
        await initializeServices();

        logger.core.info('IPC: Disconnecting OAuth server', {
            serverId: params.serverId,
            revokeTokens: params.revokeTokens,
        });

        await oauthService.disconnect({
            serverId: params.serverId,
            revokeTokens: params.revokeTokens ?? true,
        });

        logger.core.info('IPC: OAuth server disconnected', {
            serverId: params.serverId,
        });

        return { success: true };
    } catch (error) {
        logger.core.error('IPC: OAuth disconnect error', {
            serverId: params.serverId,
            error: error instanceof Error ? error.message : error,
        });

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Get OAuth status for a server
 */
async function handleStatus(
    _event: any,
    params: { serverId: string }
): Promise<{
    success: boolean;
    data?: {
        hasConfig: boolean;
        hasTokens: boolean;
        isTokenValid: boolean;
        expiresAt?: number;
        scopes?: string[];
        authServerId?: string;
    };
    error?: string;
}> {
    try {
        await initializeServices();

        const hasConfig = await oauthService.hasValidConfig(params.serverId);
        const hasTokens = await oauthService.hasValidTokens(params.serverId);

        // Get additional details
        const tokens = await oauthService['tokenStore'].getTokens(params.serverId);
        const config = await preferencesService.get(
            `mcpServers.${params.serverId}.oauth`
        ) as any;

        const isTokenValid = tokens
            ? !oauthService['tokenStore'].isTokenExpired(tokens)
            : false;

        return {
            success: true,
            data: {
                hasConfig,
                hasTokens,
                isTokenValid,
                expiresAt: tokens?.expiresAt,
                scopes: config?.scopes,
                authServerId: config?.authServerId,
            },
        };
    } catch (error) {
        logger.core.error('IPC: OAuth status error', {
            serverId: params.serverId,
            error: error instanceof Error ? error.message : error,
        });

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Force refresh OAuth token
 */
async function handleRefresh(
    _event: any,
    params: { serverId: string }
): Promise<{
    success: boolean;
    error?: string;
    tokens?: any;
}> {
    try {
        await initializeServices();

        logger.core.info('IPC: Refreshing OAuth token', {
            serverId: params.serverId,
        });

        const tokens = await oauthService.ensureValidToken(params.serverId);

        logger.core.info('IPC: OAuth token refreshed', {
            serverId: params.serverId,
        });

        return {
            success: true,
            tokens: {
                expiresAt: tokens.expiresAt,
                scope: tokens.scope,
            },
        };
    } catch (error) {
        logger.core.error('IPC: OAuth refresh error', {
            serverId: params.serverId,
            error: error instanceof Error ? error.message : error,
        });

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * List all OAuth-enabled servers
 */
async function handleList(): Promise<{
    success: boolean;
    data?: Array<{
        serverId: string;
        hasConfig: boolean;
        hasTokens: boolean;
        isTokenValid: boolean;
    }>;
    error?: string;
}> {
    try {
        await initializeServices();

        const mcpServers = await preferencesService.get('mcpServers') as Record<string, any> || {};
        const oauthServers = [];

        for (const [serverId, config] of Object.entries(mcpServers)) {
            if (config.oauth?.enabled) {
                const hasConfig = await oauthService.hasValidConfig(serverId);
                const hasTokens = await oauthService.hasValidTokens(serverId);
                const tokens = await oauthService['tokenStore'].getTokens(serverId);
                const isTokenValid = tokens
                    ? !oauthService['tokenStore'].isTokenExpired(tokens)
                    : false;

                oauthServers.push({
                    serverId,
                    hasConfig,
                    hasTokens,
                    isTokenValid,
                });
            }
        }

        return {
            success: true,
            data: oauthServers,
        };
    } catch (error) {
        logger.core.error('IPC: OAuth list error', {
            error: error instanceof Error ? error.message : error,
        });

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
```

### 2.2. Añadir tipos al preload

**Archivo**: `src/preload/index.ts`

**Añadir al objeto `levante`**:

```typescript
// Buscar el objeto levante.oauth y reemplazarlo o añadir:

oauth: {
  // Authorize OAuth flow
  authorize: (params: {
    serverId: string;
    mcpServerUrl: string;
    scopes?: string[];
    clientId?: string;
  }) =>
    ipcRenderer.invoke('levante/oauth/authorize', params) as Promise<{
      success: boolean;
      error?: string;
      tokens?: {
        expiresAt: number;
        scope?: string;
      };
    }>,

  // Disconnect and revoke
  disconnect: (params: { serverId: string; revokeTokens?: boolean }) =>
    ipcRenderer.invoke('levante/oauth/disconnect', params) as Promise<{
      success: boolean;
      error?: string;
    }>,

  // Get status
  status: (params: { serverId: string }) =>
    ipcRenderer.invoke('levante/oauth/status', params) as Promise<{
      success: boolean;
      data?: {
        hasConfig: boolean;
        hasTokens: boolean;
        isTokenValid: boolean;
        expiresAt?: number;
        scopes?: string[];
        authServerId?: string;
      };
      error?: string;
    }>,

  // Refresh token
  refresh: (params: { serverId: string }) =>
    ipcRenderer.invoke('levante/oauth/refresh', params) as Promise<{
      success: boolean;
      error?: string;
      tokens?: {
        expiresAt: number;
        scope?: string;
      };
    }>,

  // List OAuth servers
  list: () =>
    ipcRenderer.invoke('levante/oauth/list') as Promise<{
      success: boolean;
      data?: Array<{
        serverId: string;
        hasConfig: boolean;
        hasTokens: boolean;
        isTokenValid: boolean;
      }>;
      error?: string;
    }>,
},
```

---

## Paso 3: Zustand Store para OAuth

### 3.1. Crear `oauthStore.ts`

**Archivo**: `src/renderer/stores/oauthStore.ts` (NUEVO)

```typescript
import { create } from 'zustand';

/**
 * OAuth Server Status
 */
export interface OAuthServerStatus {
  serverId: string;
  hasConfig: boolean;
  hasTokens: boolean;
  isTokenValid: boolean;
  expiresAt?: number;
  scopes?: string[];
  authServerId?: string;
}

/**
 * OAuth Store State
 */
interface OAuthState {
  // Estado
  servers: Record<string, OAuthServerStatus>;
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;

  // Actions
  authorize: (params: {
    serverId: string;
    mcpServerUrl: string;
    scopes?: string[];
    clientId?: string;
  }) => Promise<void>;

  disconnect: (serverId: string, revokeTokens?: boolean) => Promise<void>;

  refreshStatus: (serverId: string) => Promise<void>;

  refreshToken: (serverId: string) => Promise<void>;

  loadAllServers: () => Promise<void>;

  clearError: (serverId: string) => void;
}

/**
 * OAuth Zustand Store
 */
export const useOAuthStore = create<OAuthState>((set, get) => ({
  servers: {},
  loading: {},
  errors: {},

  /**
   * Start OAuth authorization flow
   */
  authorize: async (params) => {
    const { serverId } = params;

    set((state) => ({
      loading: { ...state.loading, [serverId]: true },
      errors: { ...state.errors, [serverId]: null },
    }));

    try {
      const result = await window.levante.oauth.authorize(params);

      if (!result.success) {
        throw new Error(result.error || 'Authorization failed');
      }

      // Refresh status after authorization
      await get().refreshStatus(serverId);
    } catch (error) {
      set((state) => ({
        errors: {
          ...state.errors,
          [serverId]: error instanceof Error ? error.message : 'Unknown error',
        },
      }));
      throw error;
    } finally {
      set((state) => ({
        loading: { ...state.loading, [serverId]: false },
      }));
    }
  },

  /**
   * Disconnect OAuth server and revoke tokens
   */
  disconnect: async (serverId, revokeTokens = true) => {
    set((state) => ({
      loading: { ...state.loading, [serverId]: true },
      errors: { ...state.errors, [serverId]: null },
    }));

    try {
      const result = await window.levante.oauth.disconnect({
        serverId,
        revokeTokens,
      });

      if (!result.success) {
        throw new Error(result.error || 'Disconnect failed');
      }

      // Remove from state
      set((state) => {
        const newServers = { ...state.servers };
        delete newServers[serverId];
        return { servers: newServers };
      });
    } catch (error) {
      set((state) => ({
        errors: {
          ...state.errors,
          [serverId]: error instanceof Error ? error.message : 'Unknown error',
        },
      }));
      throw error;
    } finally {
      set((state) => ({
        loading: { ...state.loading, [serverId]: false },
      }));
    }
  },

  /**
   * Refresh status for a server
   */
  refreshStatus: async (serverId) => {
    set((state) => ({
      loading: { ...state.loading, [serverId]: true },
      errors: { ...state.errors, [serverId]: null },
    }));

    try {
      const result = await window.levante.oauth.status({ serverId });

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to get status');
      }

      set((state) => ({
        servers: {
          ...state.servers,
          [serverId]: {
            serverId,
            ...result.data!,
          },
        },
      }));
    } catch (error) {
      set((state) => ({
        errors: {
          ...state.errors,
          [serverId]: error instanceof Error ? error.message : 'Unknown error',
        },
      }));
    } finally {
      set((state) => ({
        loading: { ...state.loading, [serverId]: false },
      }));
    }
  },

  /**
   * Force refresh token
   */
  refreshToken: async (serverId) => {
    set((state) => ({
      loading: { ...state.loading, [serverId]: true },
      errors: { ...state.errors, [serverId]: null },
    }));

    try {
      const result = await window.levante.oauth.refresh({ serverId });

      if (!result.success) {
        throw new Error(result.error || 'Token refresh failed');
      }

      // Refresh status
      await get().refreshStatus(serverId);
    } catch (error) {
      set((state) => ({
        errors: {
          ...state.errors,
          [serverId]: error instanceof Error ? error.message : 'Unknown error',
        },
      }));
      throw error;
    } finally {
      set((state) => ({
        loading: { ...state.loading, [serverId]: false },
      }));
    }
  },

  /**
   * Load all OAuth-enabled servers
   */
  loadAllServers: async () => {
    try {
      const result = await window.levante.oauth.list();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to load servers');
      }

      // Update state
      const servers: Record<string, OAuthServerStatus> = {};
      for (const server of result.data) {
        servers[server.serverId] = server;
      }

      set({ servers });
    } catch (error) {
      console.error('Failed to load OAuth servers:', error);
    }
  },

  /**
   * Clear error for a server
   */
  clearError: (serverId) => {
    set((state) => ({
      errors: { ...state.errors, [serverId]: null },
    }));
  },
}));
```

---

## Paso 4: Componentes UI

### 4.1. `OAuthConnectionDialog.tsx`

**Archivo**: `src/renderer/components/oauth/OAuthConnectionDialog.tsx` (NUEVO)

**Crear directorio**: `src/renderer/components/oauth/`

```typescript
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, ShieldCheck, ExternalLink } from 'lucide-react';
import { useOAuthStore } from '@/stores/oauthStore';

interface OAuthConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId: string;
  mcpServerUrl: string;
  onSuccess?: () => void;
}

export function OAuthConnectionDialog({
  open,
  onOpenChange,
  serverId,
  mcpServerUrl,
  onSuccess,
}: OAuthConnectionDialogProps) {
  const [scopes, setScopes] = useState('mcp:read mcp:write');
  const [clientId, setClientId] = useState('');
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { authorize } = useOAuthStore();

  const handleAuthorize = async () => {
    setIsAuthorizing(true);
    setError(null);

    try {
      await authorize({
        serverId,
        mcpServerUrl,
        scopes: scopes.split(' ').filter(Boolean),
        clientId: clientId || undefined,
      });

      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authorization failed');
    } finally {
      setIsAuthorizing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            OAuth Authorization
          </DialogTitle>
          <DialogDescription>
            Connect to <strong>{mcpServerUrl}</strong> using OAuth 2.1
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Scopes */}
          <div className="space-y-2">
            <Label htmlFor="scopes">Scopes (space-separated)</Label>
            <Input
              id="scopes"
              value={scopes}
              onChange={(e) => setScopes(e.target.value)}
              placeholder="mcp:read mcp:write"
              disabled={isAuthorizing}
            />
            <p className="text-xs text-muted-foreground">
              Permissions requested from the MCP server
            </p>
          </div>

          {/* Client ID (optional) */}
          <div className="space-y-2">
            <Label htmlFor="client-id">
              Client ID <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="client-id"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Auto-register if empty"
              disabled={isAuthorizing}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to use Dynamic Client Registration
            </p>
          </div>

          {/* Info */}
          <Alert>
            <ExternalLink className="h-4 w-4" />
            <AlertDescription>
              Your browser will open to complete the authorization. After approving,
              you can close the browser window and return to Levante.
            </AlertDescription>
          </Alert>

          {/* Error */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isAuthorizing}
          >
            Cancel
          </Button>
          <Button onClick={handleAuthorize} disabled={isAuthorizing}>
            {isAuthorizing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Authorizing...
              </>
            ) : (
              <>
                <ShieldCheck className="mr-2 h-4 w-4" />
                Authorize
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### 4.2. `OAuthPermissionsView.tsx`

**Archivo**: `src/renderer/components/oauth/OAuthPermissionsView.tsx` (NUEVO)

```typescript
import { useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  ShieldCheck,
  Clock,
  RefreshCw,
  LogOut,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { useOAuthStore } from '@/stores/oauthStore';
import { formatDistanceToNow } from 'date-fns';

interface OAuthPermissionsViewProps {
  serverId: string;
}

export function OAuthPermissionsView({ serverId }: OAuthPermissionsViewProps) {
  const { servers, loading, errors, refreshStatus, refreshToken, disconnect } = useOAuthStore();

  const server = servers[serverId];
  const isLoading = loading[serverId];
  const error = errors[serverId];

  useEffect(() => {
    refreshStatus(serverId);
  }, [serverId, refreshStatus]);

  const handleRefresh = async () => {
    try {
      await refreshToken(serverId);
    } catch (err) {
      console.error('Failed to refresh token:', err);
    }
  };

  const handleDisconnect = async () => {
    if (confirm('Disconnect and revoke access? This will invalidate all tokens.')) {
      try {
        await disconnect(serverId, true);
      } catch (err) {
        console.error('Failed to disconnect:', err);
      }
    }
  };

  if (isLoading && !server) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!server) {
    return (
      <Alert>
        <AlertDescription>OAuth not configured for this server</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          OAuth Connection
        </CardTitle>
        <CardDescription>Status and permissions for {serverId}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Connection Status</span>
          {server.isTokenValid ? (
            <Badge variant="default" className="gap-1">
              <CheckCircle className="h-3 w-3" />
              Connected
            </Badge>
          ) : server.hasTokens ? (
            <Badge variant="secondary" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              Token Expired
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1">
              <XCircle className="h-3 w-3" />
              Not Connected
            </Badge>
          )}
        </div>

        <Separator />

        {/* Scopes */}
        {server.scopes && server.scopes.length > 0 && (
          <div className="space-y-2">
            <span className="text-sm font-medium">Granted Permissions</span>
            <div className="flex flex-wrap gap-2">
              {server.scopes.map((scope) => (
                <Badge key={scope} variant="secondary">
                  {scope}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Expiration */}
        {server.expiresAt && (
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4" />
              Token expires
            </span>
            <span>
              {server.isTokenValid
                ? formatDistanceToNow(new Date(server.expiresAt), { addSuffix: true })
                : 'Expired'}
            </span>
          </div>
        )}

        {/* Authorization Server */}
        {server.authServerId && (
          <div className="text-sm">
            <span className="text-muted-foreground">Authorization Server: </span>
            <code className="text-xs">{server.authServerId}</code>
          </div>
        )}

        <Separator />

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading || !server.hasTokens}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh Token
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDisconnect}
            disabled={isLoading}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Disconnect
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

### 4.3. `OAuthStatusIndicator.tsx`

**Archivo**: `src/renderer/components/oauth/OAuthStatusIndicator.tsx` (NUEVO)

```typescript
import { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, ShieldAlert, Shield } from 'lucide-react';
import { useOAuthStore } from '@/stores/oauthStore';

interface OAuthStatusIndicatorProps {
  serverId: string;
  variant?: 'default' | 'compact';
}

export function OAuthStatusIndicator({
  serverId,
  variant = 'default',
}: OAuthStatusIndicatorProps) {
  const { servers, refreshStatus } = useOAuthStore();
  const server = servers[serverId];

  useEffect(() => {
    refreshStatus(serverId);
  }, [serverId, refreshStatus]);

  if (!server?.hasConfig) {
    return null;
  }

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-1">
        {server.isTokenValid ? (
          <ShieldCheck className="h-4 w-4 text-green-500" />
        ) : server.hasTokens ? (
          <ShieldAlert className="h-4 w-4 text-yellow-500" />
        ) : (
          <Shield className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
    );
  }

  return (
    <Badge variant={server.isTokenValid ? 'default' : 'secondary'} className="gap-1">
      {server.isTokenValid ? (
        <>
          <ShieldCheck className="h-3 w-3" />
          OAuth Active
        </>
      ) : server.hasTokens ? (
        <>
          <ShieldAlert className="h-3 w-3" />
          Token Expired
        </>
      ) : (
        <>
          <Shield className="h-3 w-3" />
          OAuth
        </>
      )}
    </Badge>
  );
}
```

---

## Paso 5: Hook Personalizado useOAuth

### 5.1. Crear `useOAuth.ts`

**Archivo**: `src/renderer/hooks/useOAuth.ts` (NUEVO)

**Crear directorio**: `src/renderer/hooks/` (si no existe)

```typescript
import { useEffect } from 'react';
import { useOAuthStore } from '@/stores/oauthStore';

/**
 * Hook personalizado para gestionar OAuth
 *
 * Simplifica el uso del store de OAuth en componentes
 */
export function useOAuth(serverId?: string) {
  const store = useOAuthStore();

  // Auto-load on mount
  useEffect(() => {
    store.loadAllServers();
  }, []);

  // Auto-refresh status for specific server
  useEffect(() => {
    if (serverId) {
      store.refreshStatus(serverId);
    }
  }, [serverId, store.refreshStatus]);

  return {
    // State
    servers: store.servers,
    loading: store.loading,
    errors: store.errors,

    // Current server (if provided)
    server: serverId ? store.servers[serverId] : undefined,
    isLoading: serverId ? store.loading[serverId] : false,
    error: serverId ? store.errors[serverId] : undefined,

    // Actions
    authorize: store.authorize,
    disconnect: store.disconnect,
    refresh: store.refreshToken,
    refreshStatus: store.refreshStatus,
    clearError: store.clearError,
    loadAll: store.loadAllServers,
  };
}
```

---

## Paso 6: Integración con Settings

### 6.1. Extender `MCPSection.tsx`

**Archivo**: `src/renderer/components/settings/MCPSection.tsx`

**Modificación**: Añadir sección OAuth al final del componente.

```typescript
// Importar componentes OAuth al inicio del archivo
import { OAuthPermissionsView } from '@/components/oauth/OAuthPermissionsView';
import { OAuthConnectionDialog } from '@/components/oauth/OAuthConnectionDialog';
import { useOAuth } from '@/hooks/useOAuth';

// Dentro del componente MCPSection, al final del return (antes del último </div>):

{/* OAuth Configuration Section */}
<Collapsible className="space-y-2">
  <CollapsibleTrigger asChild>
    <Button variant="ghost" className="w-full justify-between p-4 h-auto">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4" />
        <span className="font-medium">OAuth Connections</span>
      </div>
      <ChevronDown className="h-4 w-4 transition-transform ui-expanded:rotate-180" />
    </Button>
  </CollapsibleTrigger>
  <CollapsibleContent className="space-y-4 pt-2">
    <p className="text-sm text-muted-foreground px-4">
      Manage OAuth 2.1 connections for MCP servers that require authentication.
    </p>

    <div className="px-4">
      <OAuthServersList />
    </div>
  </CollapsibleContent>
</Collapsible>
```

**Añadir componente auxiliar** al final del archivo `MCPSection.tsx`:

```typescript
/**
 * Lista de servidores OAuth
 */
function OAuthServersList() {
  const { servers, loadAll } = useOAuth();
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const oauthServers = Object.values(servers);

  if (oauthServers.length === 0) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          No OAuth-enabled MCP servers configured yet.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      {oauthServers.map((server) => (
        <Card key={server.serverId}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{server.serverId}</CardTitle>
              <OAuthStatusIndicator serverId={server.serverId} variant="compact" />
            </div>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedServerId(server.serverId)}
            >
              Manage Connection
            </Button>
          </CardContent>
        </Card>
      ))}

      {/* Dialog para gestionar conexión */}
      {selectedServerId && (
        <Dialog
          open={!!selectedServerId}
          onOpenChange={(open) => !open && setSelectedServerId(null)}
        >
          <DialogContent className="max-w-2xl">
            <OAuthPermissionsView serverId={selectedServerId} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
```

---

## Testing

### 7.1. Test de Revocación

**Archivo**: `src/main/services/oauth/__tests__/token-revocation.test.ts` (NUEVO)

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OAuthService } from '../OAuthService';
import { PreferencesService } from '../../preferencesService';

describe('Token Revocation (RFC 7009)', () => {
  let oauthService: OAuthService;
  let preferencesService: PreferencesService;

  beforeEach(async () => {
    preferencesService = new PreferencesService();
    await preferencesService.initialize();
    oauthService = new OAuthService(preferencesService);

    // Mock tokens
    await oauthService['tokenStore'].saveTokens('test-server', {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000,
      tokenType: 'Bearer',
    });

    // Mock config
    await preferencesService.set('mcpServers.test-server.oauth', {
      enabled: true,
      authServerId: 'https://auth.example.com',
      clientId: 'test-client',
      scopes: ['mcp:read', 'mcp:write'],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should revoke tokens on disconnect', async () => {
    // Mock fetch
    global.fetch = vi.fn()
      .mockResolvedValueOnce(
        // Metadata fetch
        new Response(
          JSON.stringify({
            issuer: 'https://auth.example.com',
            authorization_endpoint: 'https://auth.example.com/authorize',
            token_endpoint: 'https://auth.example.com/token',
            revocation_endpoint: 'https://auth.example.com/revoke',
            response_types_supported: ['code'],
            code_challenge_methods_supported: ['S256'],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        // Refresh token revocation
        new Response(null, { status: 200 })
      )
      .mockResolvedValueOnce(
        // Access token revocation
        new Response(null, { status: 200 })
      );

    await oauthService.disconnect({
      serverId: 'test-server',
      revokeTokens: true,
    });

    // Verify revocation was called
    expect(global.fetch).toHaveBeenCalledTimes(3); // metadata + 2 revocations

    // Verify tokens were deleted
    const tokens = await oauthService['tokenStore'].getTokens('test-server');
    expect(tokens).toBeNull();
  });

  it('should continue disconnect even if revocation fails', async () => {
    // Mock fetch to fail revocation
    global.fetch = vi.fn()
      .mockResolvedValueOnce(
        // Metadata fetch
        new Response(
          JSON.stringify({
            issuer: 'https://auth.example.com',
            authorization_endpoint: 'https://auth.example.com/authorize',
            token_endpoint: 'https://auth.example.com/token',
            revocation_endpoint: 'https://auth.example.com/revoke',
            response_types_supported: ['code'],
            code_challenge_methods_supported: ['S256'],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        // Revocation fails
        new Response(
          JSON.stringify({ error: 'invalid_token' }),
          { status: 400 }
        )
      );

    // Should not throw
    await oauthService.disconnect({
      serverId: 'test-server',
      revokeTokens: true,
    });

    // Tokens should still be deleted
    const tokens = await oauthService['tokenStore'].getTokens('test-server');
    expect(tokens).toBeNull();
  });
});
```

### 7.2. Test de IPC Handlers

**Archivo**: `src/main/ipc/__tests__/oauthHandlers.test.ts` (NUEVO)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupOAuthHandlers } from '../oauthHandlers';
import { ipcMain } from 'electron';

describe('OAuth IPC Handlers', () => {
  beforeEach(() => {
    setupOAuthHandlers();
  });

  it('should register all OAuth handlers', () => {
    const handleSpy = vi.spyOn(ipcMain, 'handle');

    expect(handleSpy).toHaveBeenCalledWith(
      'levante/oauth/authorize',
      expect.any(Function)
    );
    expect(handleSpy).toHaveBeenCalledWith(
      'levante/oauth/disconnect',
      expect.any(Function)
    );
    expect(handleSpy).toHaveBeenCalledWith(
      'levante/oauth/status',
      expect.any(Function)
    );
    expect(handleSpy).toHaveBeenCalledWith(
      'levante/oauth/refresh',
      expect.any(Function)
    );
    expect(handleSpy).toHaveBeenCalledWith(
      'levante/oauth/list',
      expect.any(Function)
    );
  });
});
```

### 7.3. Test de Componentes UI

**Archivo**: `src/renderer/components/oauth/__tests__/OAuthConnectionDialog.test.tsx` (NUEVO)

**Crear directorio**: `src/renderer/components/oauth/__tests__/`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OAuthConnectionDialog } from '../OAuthConnectionDialog';

// Mock useOAuthStore
vi.mock('@/stores/oauthStore', () => ({
  useOAuthStore: () => ({
    authorize: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('OAuthConnectionDialog', () => {
  it('should render authorization dialog', () => {
    render(
      <OAuthConnectionDialog
        open={true}
        onOpenChange={vi.fn()}
        serverId="test-server"
        mcpServerUrl="https://mcp.example.com"
      />
    );

    expect(screen.getByText('OAuth Authorization')).toBeInTheDocument();
    expect(screen.getByText(/Connect to/)).toBeInTheDocument();
  });

  it('should call authorize on button click', async () => {
    const mockAuthorize = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useOAuthStore).mockReturnValue({
      authorize: mockAuthorize,
    } as any);

    const onSuccess = vi.fn();

    render(
      <OAuthConnectionDialog
        open={true}
        onOpenChange={vi.fn()}
        serverId="test-server"
        mcpServerUrl="https://mcp.example.com"
        onSuccess={onSuccess}
      />
    );

    const authorizeButton = screen.getByRole('button', { name: /Authorize/i });
    fireEvent.click(authorizeButton);

    await waitFor(() => {
      expect(mockAuthorize).toHaveBeenCalledWith({
        serverId: 'test-server',
        mcpServerUrl: 'https://mcp.example.com',
        scopes: ['mcp:read', 'mcp:write'],
        clientId: undefined,
      });
      expect(onSuccess).toHaveBeenCalled();
    });
  });
});
```

---

## Consideraciones de Seguridad

### 1. Token Revocation (RFC 7009)

- ✅ **Revocación en Disconnect**: Siempre revocar tokens al desconectar (default: `true`)
- ✅ **Refresh Token primero**: Revocar refresh token primero invalida también el access token
- ✅ **Error Handling**: Si revocación falla, continuar con disconnect local
- ✅ **Logging**: No loggear tokens completos, solo preview sanitizado

### 2. IPC Security

- ✅ **Validación de parámetros**: Validar todos los parámetros en handlers
- ✅ **Error Sanitization**: No exponer detalles internos en errores IPC
- ✅ **Rate Limiting**: Considerar rate limiting en flujos OAuth (futuro)

### 3. UI Security

- ✅ **Confirmación en Disconnect**: Mostrar confirmación antes de revocar tokens
- ✅ **No mostrar tokens**: Nunca mostrar access/refresh tokens en UI
- ✅ **Estado visual claro**: Indicadores visuales del estado de conexión OAuth

### 4. Store Security

- ✅ **No almacenar tokens en memoria**: Solo metadata en Zustand store
- ✅ **Refresh automático**: Auto-refresh status periódicamente
- ✅ **Cleanup en unmount**: Limpiar estados al desmontar componentes

---

## Checklist de Implementación

### Backend (Main Process)

- [ ] **Paso 1.1**: Añadir `revokeToken()` a `OAuthFlowManager`
- [ ] **Paso 1.2**: Extender `OAuthService.disconnect()` con revocación
- [ ] **Paso 1.3**: Tests de token revocation
- [ ] **Paso 2.1**: Extender `oauthHandlers.ts` con nuevos handlers
- [ ] **Paso 2.2**: Actualizar `preload/index.ts` con tipos OAuth

### Frontend (Renderer Process)

- [ ] **Paso 3.1**: Crear `oauthStore.ts` (Zustand)
- [ ] **Paso 4.1**: Crear `OAuthConnectionDialog.tsx`
- [ ] **Paso 4.2**: Crear `OAuthPermissionsView.tsx`
- [ ] **Paso 4.3**: Crear `OAuthStatusIndicator.tsx`
- [ ] **Paso 5.1**: Crear hook `useOAuth.ts`
- [ ] **Paso 6.1**: Extender `MCPSection.tsx` con panel OAuth

### Testing

- [ ] **Test 7.1**: Tests de revocación de tokens
- [ ] **Test 7.2**: Tests de IPC handlers
- [ ] **Test 7.3**: Tests de componentes UI
- [ ] **Test E2E**: Flujo completo OAuth desde UI

### Documentación

- [ ] Actualizar `resumen_fases_12345.md` → `resumen_fases_123456.md`
- [ ] Añadir screenshots de UI a documentación
- [ ] Actualizar README principal con sección OAuth

---

## Próximos Pasos (Post Fase 6)

### Mejoras Futuras

1. **Client ID Embebidos**: Estrategia de fallback cuando Dynamic Registration falla
2. **OAuth Admin UI**: Panel dedicado para gestionar múltiples conexiones OAuth
3. **Token Monitoring**: Alertas visuales antes de expiración de tokens
4. **OAuth Analytics**: Métricas de uso de OAuth (conexiones exitosas/fallidas)
5. **Multi-Account Support**: Soportar múltiples cuentas por servidor OAuth

---

## Conclusión

La Fase 6 completa la implementación OAuth para Levante con:

- ✅ **RFC 7009**: Token Revocation completo
- ✅ **IPC Completo**: 5 handlers OAuth (`authorize`, `disconnect`, `status`, `refresh`, `list`)
- ✅ **Zustand Store**: Gestión de estado OAuth en renderer
- ✅ **3 Componentes UI**: Connection Dialog, Permissions View, Status Indicator
- ✅ **Hook useOAuth**: Simplificación de integración en componentes
- ✅ **Integración Settings**: Panel OAuth en Settings > MCP

**Total de archivos a crear/modificar**: ~15 archivos

**Arquitectura final**:
```
Main Process → OAuthService → OAuthFlowManager → RFC 7009 Revocation
                    ↓
              IPC Handlers (5 handlers)
                    ↓
Renderer → oauthStore (Zustand) → useOAuth hook → UI Components (3)
                                                        ↓
                                              Settings > MCP > OAuth Panel
```

---

**Última actualización**: 2025-12-21
**Versión**: 1.0
**Autor**: Arquitectura Levante
**Estado**: Listo para implementación
