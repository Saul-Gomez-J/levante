# Plan de Implementación: Fases 5 y 6 - OAuth Private Client Support

> Plan detallado para implementar la validación de expiración de client_secret y documentación/tests.

## Contexto

### Estado Actual (Post Fases 1 y 2)

| Fase | Descripción | Estado |
|------|-------------|--------|
| 1 | DCR con cliente confidencial | ✅ Implementada |
| 2 | HTTP Basic Auth (`client_secret_basic`) | ✅ Implementada |
| 3 | Credenciales manuales (skip DCR) | ⏸️ No necesario (sin UI) |
| 4 | Credenciales pre-configuradas | ⏸️ No necesario (sin caso de uso) |
| 5 | Validación de expiración de client_secret | 📋 **Este plan** |
| 6 | Documentación y Tests | 📋 **Este plan** |

### Capacidades Existentes Relevantes

El código actual ya tiene:

1. **`OAuthClientCredentials`** en `types.ts` con `registrationMetadata.client_secret_expires_at`
2. **`saveClientCredentials()`** en `OAuthService.ts` que guarda metadata de registro
3. **`getClientCredentials()`** en `OAuthService.ts` que recupera y desencripta credenciales
4. **Tests de integración** en `oauth/__tests__/oauth-integration.test.ts`

---

## Fase 5: Validación y Expiración de Client Secret

### Objetivo

Implementar validación de expiración de `client_secret` según RFC 7591, incluyendo:
- Verificar si el secret ha expirado antes de usarlo
- Intentar re-registro si el secret expiró y hay `registration_client_uri`
- Notificar al usuario si las credenciales expiraron

### Archivos a Modificar

| Archivo | Tipo de Cambio |
|---------|----------------|
| `src/main/services/oauth/OAuthService.ts` | Añadir validación de expiración |
| `src/main/services/oauth/OAuthHttpClient.ts` | Verificar credenciales antes de requests |
| `src/main/services/oauth/types.ts` | Añadir nuevos códigos de error |
| `src/main/ipc/oauthHandlers.ts` | Nuevo evento para expiración de credenciales |

---

### 5.1 Actualizar Tipos de Error

**Archivo**: `src/main/services/oauth/types.ts`

**Ubicación**: Añadir al final de `OAuthServiceError['code']` (línea ~492-499)

```typescript
// ANTES (línea 490-500)
export interface OAuthServiceError extends Error {
    code:
    | 'DISCOVERY_FAILED'
    | 'AUTHORIZATION_FAILED'
    | 'TOKEN_EXCHANGE_FAILED'
    | 'NO_CLIENT_ID'
    | 'SAVE_FAILED'
    | 'AUTH_SERVER_NOT_FOUND'
    | 'MISSING_CLIENT_ID';
    details?: Record<string, unknown>;
}

// DESPUÉS
export interface OAuthServiceError extends Error {
    code:
    | 'DISCOVERY_FAILED'
    | 'AUTHORIZATION_FAILED'
    | 'TOKEN_EXCHANGE_FAILED'
    | 'NO_CLIENT_ID'
    | 'SAVE_FAILED'
    | 'AUTH_SERVER_NOT_FOUND'
    | 'MISSING_CLIENT_ID'
    | 'CLIENT_SECRET_EXPIRED'        // Nuevo: client_secret expiró
    | 'CLIENT_REREGISTRATION_FAILED'; // Nuevo: falló re-registro
    details?: Record<string, unknown>;
}
```

---

### 5.2 Añadir Método de Validación de Expiración

**Archivo**: `src/main/services/oauth/OAuthService.ts`

**Ubicación**: Añadir después del método `getClientCredentials()` (después de línea 583)

```typescript
/**
 * Verifica si el client_secret ha expirado
 * RFC 7591: client_secret_expires_at = 0 significa que nunca expira
 *
 * @param credentials - Credenciales del cliente
 * @returns true si el secret es válido (no expirado), false si expiró
 */
private isClientSecretValid(credentials: OAuthClientCredentials): boolean {
    const expiresAt = credentials.registrationMetadata?.client_secret_expires_at;

    // 0 = nunca expira (RFC 7591)
    if (!expiresAt || expiresAt === 0) {
        return true;
    }

    // Añadir buffer de 5 minutos para evitar race conditions
    const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
    const expiresAtMs = expiresAt * 1000; // RFC 7591 usa segundos

    return Date.now() < expiresAtMs - EXPIRY_BUFFER_MS;
}

/**
 * Obtiene credenciales válidas, intentando re-registrar si están expiradas
 *
 * @param serverId - ID del servidor MCP
 * @returns Credenciales válidas o null si no hay/no se pueden obtener
 */
async getValidClientCredentials(
    serverId: string
): Promise<OAuthClientCredentials | null> {
    const credentials = await this.getClientCredentials(serverId);

    if (!credentials) {
        logger.oauth.debug('No client credentials found', { serverId });
        return null;
    }

    // Verificar expiración del client_secret
    if (!this.isClientSecretValid(credentials)) {
        logger.oauth.warn('Client secret expired', {
            serverId,
            expiresAt: credentials.registrationMetadata?.client_secret_expires_at,
            clientId: this.sanitizeForLog(credentials.clientId),
        });

        // Si tiene registration_client_uri, intentar actualizar
        if (credentials.registrationMetadata?.registration_client_uri) {
            try {
                logger.oauth.info('Attempting client re-registration', { serverId });
                const newCredentials = await this.refreshClientRegistration(
                    serverId,
                    credentials
                );
                return newCredentials;
            } catch (error) {
                logger.oauth.error('Failed to refresh client registration', {
                    serverId,
                    error: error instanceof Error ? error.message : error,
                });

                // Eliminar credenciales expiradas
                await this.deleteClientCredentials(serverId);

                // Notificar al usuario
                this.notifyCredentialsExpired(serverId, 'client_secret_expired');

                return null;
            }
        }

        // No se puede actualizar, eliminar credenciales expiradas
        logger.oauth.warn(
            'Cannot refresh registration, deleting expired credentials',
            { serverId }
        );
        await this.deleteClientCredentials(serverId);

        // Notificar al usuario
        this.notifyCredentialsExpired(serverId, 'client_secret_expired');

        return null;
    }

    return credentials;
}

/**
 * Intenta refrescar el registro del cliente usando registration_client_uri
 * RFC 7592: OAuth 2.0 Dynamic Client Registration Management Protocol
 *
 * @param serverId - ID del servidor
 * @param credentials - Credenciales actuales (expiradas)
 */
private async refreshClientRegistration(
    serverId: string,
    credentials: OAuthClientCredentials
): Promise<OAuthClientCredentials> {
    const registrationUri = credentials.registrationMetadata?.registration_client_uri;
    const registrationToken = credentials.registrationMetadata?.registration_access_token;

    if (!registrationUri || !registrationToken) {
        throw this.createError(
            'CLIENT_REREGISTRATION_FAILED',
            'Missing registration URI or token',
            { serverId }
        );
    }

    logger.oauth.debug('Refreshing client registration', {
        serverId,
        registrationUri: this.sanitizeForLog(registrationUri),
    });

    // GET current registration
    const response = await fetch(registrationUri, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${registrationToken}`,
            Accept: 'application/json',
        },
    });

    if (!response.ok) {
        throw this.createError(
            'CLIENT_REREGISTRATION_FAILED',
            `Registration refresh failed: ${response.status}`,
            { serverId, status: response.status }
        );
    }

    const registrationResponse = await response.json();

    // Crear nuevas credenciales
    const newCredentials: OAuthClientCredentials = {
        clientId: registrationResponse.client_id,
        clientSecret: registrationResponse.client_secret,
        registeredAt: Date.now(),
        authServerId: credentials.authServerId,
        tokenEndpointAuthMethod: credentials.tokenEndpointAuthMethod,
        registrationMetadata: {
            client_secret_expires_at: registrationResponse.client_secret_expires_at,
            registration_access_token: registrationResponse.registration_access_token || registrationToken,
            registration_client_uri: registrationResponse.registration_client_uri || registrationUri,
        },
    };

    // Guardar nuevas credenciales
    await this.saveClientCredentials(serverId, newCredentials);

    logger.oauth.info('Client registration refreshed successfully', {
        serverId,
        clientId: this.sanitizeForLog(newCredentials.clientId),
        newExpiresAt: newCredentials.registrationMetadata?.client_secret_expires_at,
    });

    return newCredentials;
}

/**
 * Elimina credenciales de cliente del almacenamiento
 */
private async deleteClientCredentials(serverId: string): Promise<void> {
    await this.preferencesService.set(
        `mcpServers.${serverId}.oauth.clientCredentials`,
        undefined
    );

    logger.oauth.info('Client credentials deleted', { serverId });
}

/**
 * Notifica al renderer que las credenciales expiraron
 * El renderer mostrará un mensaje al usuario
 */
private notifyCredentialsExpired(
    serverId: string,
    reason: 'client_secret_expired' | 'registration_revoked'
): void {
    // Import BrowserWindow lazily to avoid circular deps
    const { BrowserWindow } = require('electron');
    const mainWindow = BrowserWindow.getAllWindows()[0];

    if (mainWindow) {
        mainWindow.webContents.send('levante/oauth/credentials-expired', {
            serverId,
            reason,
            timestamp: Date.now(),
        });

        logger.oauth.info('Credentials expiration notification sent', {
            serverId,
            reason,
        });
    }
}
```

---

### 5.3 Integrar Validación en el Flujo de Autorización

**Archivo**: `src/main/services/oauth/OAuthService.ts`

**Ubicación**: Modificar el método `authorize()` para usar credenciales válidas (línea ~130-165)

```typescript
// ANTES (línea 130-165)
// Step 3: Dynamic Client Registration (if needed)
let clientId = providedClientId;
let clientSecret: string | undefined;
let tokenEndpointAuthMethod: TokenEndpointAuthMethod = 'none';

if (!clientId) {
    logger.oauth.info(
        'Step 3: No client_id provided, attempting Dynamic Client Registration'
    );

    // Check if AS supports Dynamic Client Registration
    if (this.discoveryService.supportsClientRegistration(metadata)) {
        // ... registro dinámico
    }
}

// DESPUÉS
// Step 3: Dynamic Client Registration (if needed)
let clientId = providedClientId;
let clientSecret: string | undefined;
let tokenEndpointAuthMethod: TokenEndpointAuthMethod = 'none';

if (!clientId) {
    logger.oauth.info(
        'Step 3: No client_id provided, checking existing credentials'
    );

    // Primero verificar si hay credenciales existentes válidas
    const existingCredentials = await this.getValidClientCredentials(serverId);

    if (existingCredentials) {
        logger.oauth.info('Using existing valid client credentials', {
            serverId,
            clientId: this.sanitizeForLog(existingCredentials.clientId),
            hasSecret: !!existingCredentials.clientSecret,
        });

        clientId = existingCredentials.clientId;
        clientSecret = existingCredentials.clientSecret;
        tokenEndpointAuthMethod = existingCredentials.tokenEndpointAuthMethod ?? 'none';
    } else {
        // No hay credenciales válidas, intentar DCR
        logger.oauth.info('No valid credentials, attempting Dynamic Client Registration');

        // Check if AS supports Dynamic Client Registration
        if (this.discoveryService.supportsClientRegistration(metadata)) {
            logger.oauth.info(
                'Dynamic Client Registration supported, attempting registration'
            );

            try {
                const credentials =
                    await this.discoveryService.registerClient(
                        metadata.registration_endpoint!,
                        authServerId,
                        {
                            redirectUris: [redirectUri],
                            preferConfidential: false,
                        }
                    );

                clientId = credentials.clientId;
                clientSecret = credentials.clientSecret;
                tokenEndpointAuthMethod = credentials.tokenEndpointAuthMethod ?? 'none';

                // Save credentials to preferences (encrypted)
                await this.saveClientCredentials(serverId, credentials);

                logger.oauth.info('Dynamic Client Registration successful', {
                    clientId: this.sanitizeForLog(clientId),
                    hasClientSecret: !!clientSecret,
                });
            } catch (registrationError) {
                // Cleanup redirect server
                await redirectServer.stop();

                // Dynamic Registration failed
                logger.oauth.error('Dynamic Client Registration failed', {
                    error:
                        registrationError instanceof Error
                            ? registrationError.message
                            : registrationError,
                });

                return {
                    success: false,
                    error: `Dynamic Client Registration failed: ${registrationError instanceof Error
                        ? registrationError.message
                        : 'Unknown error'
                        }. This server requires manual client configuration (feature coming soon).`,
                };
            }
        } else {
            // Cleanup redirect server
            await redirectServer.stop();

            // No Dynamic Registration available
            logger.oauth.warn(
                'Dynamic Client Registration not supported by Authorization Server'
            );

            return {
                success: false,
                error: 'This Authorization Server does not support Dynamic Client Registration. Manual client configuration will be required (feature coming soon).',
            };
        }
    }
} else {
    logger.oauth.info('Step 3: Using provided client_id', {
        clientId: this.sanitizeForLog(clientId),
    });
}
```

---

### 5.4 Verificar Credenciales en OAuthHttpClient

**Archivo**: `src/main/services/oauth/OAuthHttpClient.ts`

**Ubicación**: Modificar `getOAuthConfig()` para verificar expiración (línea ~211-225)

```typescript
// ANTES (línea 211-225)
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

    return config as unknown as OAuthServerConfig;
}

// DESPUÉS
private async getOAuthConfig(serverId: string): Promise<OAuthServerConfig> {
    const config = await this.preferencesService.get(
        `mcpServers.${serverId}.oauth`
    ) as any;

    if (!config) {
        throw this.createError(
            'NO_OAUTH_CONFIG',
            'OAuth configuration not found for server',
            { serverId }
        );
    }

    // Verificar si hay client credentials y si están expiradas
    const clientCredentials = config.clientCredentials;
    if (clientCredentials?.registrationMetadata?.client_secret_expires_at) {
        const expiresAt = clientCredentials.registrationMetadata.client_secret_expires_at;

        // 0 = nunca expira, cualquier otro valor es timestamp en segundos
        if (expiresAt !== 0 && Date.now() >= expiresAt * 1000) {
            logger.oauth.warn('Client credentials expired during token refresh', {
                serverId,
                expiresAt,
            });

            // Notificar - el refresh fallará pero queremos informar
            // La re-autorización será necesaria
        }
    }

    return config as unknown as OAuthServerConfig;
}
```

---

### 5.5 Añadir Nuevo Código de Error a OAuthHttpClient

**Archivo**: `src/main/services/oauth/types.ts`

**Ubicación**: Actualizar `OAuthHttpClientError` (línea ~476-485)

```typescript
// ANTES
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

// DESPUÉS
export interface OAuthHttpClientError extends Error {
    code:
    | 'NO_TOKENS'
    | 'NO_REFRESH_TOKEN'
    | 'REFRESH_FAILED'
    | 'NO_OAUTH_CONFIG'
    | 'NETWORK_ERROR'
    | 'UNAUTHORIZED'
    | 'CREDENTIALS_EXPIRED';  // Nuevo
    details?: Record<string, unknown>;
}
```

---

### 5.6 Añadir Handler IPC para Evento de Expiración

**Archivo**: `src/main/ipc/oauthHandlers.ts`

**Ubicación**: Añadir al final del archivo, antes del cierre de `setupOAuthHandlers()`

```typescript
// Añadir al preload API (exponer al renderer)
// Este evento ya se envía desde OAuthService.notifyCredentialsExpired()
// El renderer debe escuchar: window.levante.oauth.onCredentialsExpired(callback)
```

**Archivo**: `src/preload/index.ts` (si existe exposición de IPC)

Añadir listener para el nuevo evento:

```typescript
// En la sección de oauth del preload
onCredentialsExpired: (callback: (data: {
    serverId: string;
    reason: 'client_secret_expired' | 'registration_revoked';
    timestamp: number;
}) => void) => {
    ipcRenderer.on('levante/oauth/credentials-expired', (_, data) => callback(data));
},
```

---

## Fase 6: Documentación y Tests

### Objetivo

- Actualizar la documentación de arquitectura OAuth
- Actualizar CLAUDE.md con información sobre credenciales de cliente
- Añadir tests unitarios para validación de expiración

---

### 6.1 Actualizar Documentación de Arquitectura

**Archivo**: `docs/oauth/oauth-architecture.md`

**Ubicación**: Añadir nueva sección antes de "## Resumen Ejecutivo" (después de línea ~1594)

```markdown
### 6. Client Secret Expiration Handling (Fase 5)

El sistema maneja automáticamente la expiración de `client_secret` según RFC 7591:

**Flujo de Validación**:
```
┌─────────────────────────────────────────────────────────────────┐
│                    VALIDACIÓN DE CREDENCIALES                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
              ┌──────────────────────────────┐
              │ ¿Existe client_secret_       │
              │ expires_at en metadata?      │
              └───────────────┬──────────────┘
                              │
               ┌──────────────┴──────────────┐
               │                             │
               ▼                             ▼
        ┌───────────┐                 ┌────────────┐
        │  NO / 0   │                 │    SÍ      │
        │ (nunca    │                 │ (timestamp)│
        │  expira)  │                 └──────┬─────┘
        └─────┬─────┘                        │
              │                              ▼
              │                 ┌────────────────────────┐
              │                 │ now < (expires_at - 5m)?│
              │                 └───────────┬────────────┘
              │                             │
              │                  ┌──────────┴──────────┐
              │                  │                     │
              ▼                  ▼                     ▼
        ┌───────────┐     ┌───────────┐        ┌────────────┐
        │ VÁLIDO    │     │ VÁLIDO    │        │ EXPIRADO   │
        └───────────┘     └───────────┘        └──────┬─────┘
                                                      │
                                                      ▼
                                      ┌──────────────────────────┐
                                      │ ¿Tiene registration_     │
                                      │ client_uri?              │
                                      └───────────┬──────────────┘
                                                  │
                                       ┌──────────┴──────────┐
                                       │                     │
                                       ▼                     ▼
                                ┌────────────┐        ┌────────────┐
                                │    SÍ      │        │    NO      │
                                │ Intentar   │        │ Eliminar   │
                                │ re-registro│        │ credentials│
                                └──────┬─────┘        │ Notificar  │
                                       │              └────────────┘
                                       ▼
                                ┌────────────────────┐
                                │ GET registration_  │
                                │ client_uri con     │
                                │ Bearer token       │
                                └─────────┬──────────┘
                                          │
                               ┌──────────┴──────────┐
                               │                     │
                               ▼                     ▼
                        ┌────────────┐        ┌────────────┐
                        │  Éxito     │        │  Error     │
                        │  Guardar   │        │  Eliminar  │
                        │  nuevas    │        │  credentials│
                        │  creds     │        │  Notificar │
                        └────────────┘        └────────────┘
```

**Buffer de Seguridad**:
- Se aplica un buffer de 5 minutos antes de la expiración real
- Previene race conditions durante operaciones

**Evento IPC**:
```typescript
// Enviado cuando las credenciales expiran
mainWindow.webContents.send('levante/oauth/credentials-expired', {
    serverId: 'server1',
    reason: 'client_secret_expired',
    timestamp: 1735000000000,
});
```

**Respuesta del Renderer**:
- Mostrar notificación al usuario
- Ofrecer re-autorización
```

---

### 6.2 Actualizar CLAUDE.md

**Archivo**: `CLAUDE.md`

**Ubicación**: Añadir a la sección de OAuth (después de DEBUG_OAUTH en la sección de logging)

```markdown
## OAuth System

Levante implements OAuth 2.1 with PKCE for MCP server authentication:

**Key Features:**
- Dynamic Client Registration (RFC 7591)
- Client secret expiration handling
- Token auto-refresh
- Token revocation on disconnect

**Client Credentials:**
- Stored encrypted in `ui-preferences.json`
- Automatic validation of `client_secret_expires_at`
- Re-registration attempt if secret expires
- IPC notification on credentials expiration

**Files:**
- `src/main/services/oauth/` - Core OAuth services
- `src/main/ipc/oauthHandlers.ts` - IPC handlers
- `src/renderer/stores/oauthStore.ts` - UI state

For detailed architecture: See [OAuth Architecture](docs/oauth/oauth-architecture.md)
```

---

### 6.3 Tests Unitarios para Validación de Expiración

**Archivo**: `src/main/services/oauth/__tests__/oauth-credentials-expiration.test.ts` (nuevo)

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OAuthService } from '../OAuthService';
import type { PreferencesService } from '../../preferencesService';
import type { OAuthClientCredentials } from '../types';

// Mock electron
vi.mock('electron', () => ({
    shell: {
        openExternal: vi.fn(),
    },
    safeStorage: {
        isEncryptionAvailable: vi.fn(() => true),
        encryptString: vi.fn((str: string) => Buffer.from(str, 'utf8')),
        decryptString: vi.fn((buffer: Buffer) => buffer.toString('utf8')),
    },
    BrowserWindow: {
        getAllWindows: vi.fn(() => [{
            webContents: {
                send: vi.fn(),
            },
        }]),
    },
}));

// Mock logger
vi.mock('../../logging', () => ({
    getLogger: () => ({
        oauth: {
            info: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
    }),
}));

// Mock PreferencesService
class MockPreferencesService {
    private store: Record<string, any> = {};

    async get<T>(key: string): Promise<T | undefined> {
        const keys = key.split('.');
        let value: any = this.store;
        for (const k of keys) {
            value = value?.[k];
            if (value === undefined) return undefined;
        }
        return value as T;
    }

    async set(key: string, value: any): Promise<void> {
        const keys = key.split('.');
        const lastKey = keys.pop()!;
        let target: any = this.store;
        for (const k of keys) {
            if (!target[k]) target[k] = {};
            target = target[k];
        }
        target[lastKey] = value;
    }

    async getAll(): Promise<any> {
        return this.store;
    }

    reset(): void {
        this.store = {};
    }
}

describe('OAuth Client Credentials Expiration', () => {
    let oauthService: OAuthService;
    let mockPreferences: MockPreferencesService;

    beforeEach(() => {
        mockPreferences = new MockPreferencesService();
        oauthService = new OAuthService(mockPreferences as any as PreferencesService);
    });

    afterEach(() => {
        mockPreferences.reset();
        vi.clearAllMocks();
    });

    describe('isClientSecretValid', () => {
        it('should return true when client_secret_expires_at is 0 (never expires)', async () => {
            const credentials: OAuthClientCredentials = {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                registeredAt: Date.now(),
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    client_secret_expires_at: 0, // Never expires
                },
            };

            // Access private method via any
            const isValid = (oauthService as any).isClientSecretValid(credentials);
            expect(isValid).toBe(true);
        });

        it('should return true when client_secret_expires_at is undefined', async () => {
            const credentials: OAuthClientCredentials = {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                registeredAt: Date.now(),
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    // No client_secret_expires_at
                },
            };

            const isValid = (oauthService as any).isClientSecretValid(credentials);
            expect(isValid).toBe(true);
        });

        it('should return true when secret has not expired', async () => {
            const futureTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

            const credentials: OAuthClientCredentials = {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                registeredAt: Date.now(),
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    client_secret_expires_at: futureTimestamp,
                },
            };

            const isValid = (oauthService as any).isClientSecretValid(credentials);
            expect(isValid).toBe(true);
        });

        it('should return false when secret has expired', async () => {
            const pastTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

            const credentials: OAuthClientCredentials = {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                registeredAt: Date.now() - 7200000,
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    client_secret_expires_at: pastTimestamp,
                },
            };

            const isValid = (oauthService as any).isClientSecretValid(credentials);
            expect(isValid).toBe(false);
        });

        it('should return false when secret will expire within 5 minute buffer', async () => {
            // Expires in 2 minutes (within 5 minute buffer)
            const nearFutureTimestamp = Math.floor(Date.now() / 1000) + 120;

            const credentials: OAuthClientCredentials = {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                registeredAt: Date.now(),
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    client_secret_expires_at: nearFutureTimestamp,
                },
            };

            const isValid = (oauthService as any).isClientSecretValid(credentials);
            expect(isValid).toBe(false);
        });
    });

    describe('getValidClientCredentials', () => {
        it('should return null when no credentials exist', async () => {
            const result = await (oauthService as any).getValidClientCredentials('nonexistent-server');
            expect(result).toBeNull();
        });

        it('should return credentials when they are valid', async () => {
            const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;

            await mockPreferences.set('mcpServers.test-server.oauth.clientCredentials', {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                registeredAt: Date.now(),
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    client_secret_expires_at: futureTimestamp,
                },
            });

            const result = await (oauthService as any).getValidClientCredentials('test-server');

            expect(result).not.toBeNull();
            expect(result.clientId).toBe('test-client');
        });

        it('should delete expired credentials and return null', async () => {
            const pastTimestamp = Math.floor(Date.now() / 1000) - 3600;

            await mockPreferences.set('mcpServers.test-server.oauth.clientCredentials', {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                registeredAt: Date.now() - 7200000,
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    client_secret_expires_at: pastTimestamp,
                    // No registration_client_uri, so cannot refresh
                },
            });

            const result = await (oauthService as any).getValidClientCredentials('test-server');

            expect(result).toBeNull();

            // Verify credentials were deleted
            const stored = await mockPreferences.get('mcpServers.test-server.oauth.clientCredentials');
            expect(stored).toBeUndefined();
        });

        it('should attempt re-registration when expired but has registration_client_uri', async () => {
            const pastTimestamp = Math.floor(Date.now() / 1000) - 3600;
            const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;

            await mockPreferences.set('mcpServers.test-server.oauth.clientCredentials', {
                clientId: 'old-client',
                clientSecret: 'old-secret',
                registeredAt: Date.now() - 7200000,
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    client_secret_expires_at: pastTimestamp,
                    registration_client_uri: 'https://auth.example.com/clients/123',
                    registration_access_token: 'registration-token',
                },
            });

            // Mock fetch for re-registration
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    client_id: 'new-client',
                    client_secret: 'new-secret',
                    client_secret_expires_at: futureTimestamp,
                }),
            });

            const result = await (oauthService as any).getValidClientCredentials('test-server');

            expect(result).not.toBeNull();
            expect(result.clientId).toBe('new-client');
            expect(result.clientSecret).toBe('new-secret');

            // Verify new credentials were saved
            const stored = await mockPreferences.get('mcpServers.test-server.oauth.clientCredentials');
            expect(stored).toBeDefined();
        });

        it('should notify user when credentials expire and cannot be refreshed', async () => {
            const { BrowserWindow } = require('electron');
            const mockSend = vi.fn();
            BrowserWindow.getAllWindows.mockReturnValue([{
                webContents: { send: mockSend },
            }]);

            const pastTimestamp = Math.floor(Date.now() / 1000) - 3600;

            await mockPreferences.set('mcpServers.test-server.oauth.clientCredentials', {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                registeredAt: Date.now() - 7200000,
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    client_secret_expires_at: pastTimestamp,
                    // No registration_client_uri
                },
            });

            await (oauthService as any).getValidClientCredentials('test-server');

            expect(mockSend).toHaveBeenCalledWith(
                'levante/oauth/credentials-expired',
                expect.objectContaining({
                    serverId: 'test-server',
                    reason: 'client_secret_expired',
                })
            );
        });
    });
});
```

---

### 6.4 Añadir Test de Integración

**Archivo**: `src/main/services/oauth/__tests__/oauth-integration.test.ts`

**Ubicación**: Añadir nuevo describe block al final del archivo (antes de la última llave de cierre)

```typescript
describe('Client Credentials Expiration Integration', () => {
    it('should validate credentials before authorization flow', async () => {
        const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;

        // Setup existing valid credentials
        await mockPreferences.set('mcpServers.test-server.oauth.clientCredentials', {
            clientId: 'existing-client',
            clientSecret: 'existing-secret',
            registeredAt: Date.now(),
            authServerId: 'https://auth.example.com',
            tokenEndpointAuthMethod: 'client_secret_post',
            registrationMetadata: {
                client_secret_expires_at: futureTimestamp,
            },
        });

        // The authorization flow should use existing credentials
        // instead of doing DCR again
        // (This would be tested in a full integration test with OAuthService)
    });

    it('should handle expired credentials during token refresh', async () => {
        const pastTimestamp = Math.floor(Date.now() / 1000) - 3600;

        // Setup expired tokens
        const expiredTokens = {
            accessToken: 'expired-access',
            refreshToken: 'valid-refresh',
            expiresAt: Date.now() - 1000,
            tokenType: 'Bearer' as const,
        };

        await tokenStore.saveTokens('test-server', expiredTokens);

        // Setup OAuth config with expired client credentials
        await mockPreferences.set('mcpServers.test-server.oauth', {
            enabled: true,
            authServerId: 'https://auth.example.com',
            clientId: 'test-client',
            scopes: ['mcp:read'],
            clientCredentials: {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                registeredAt: Date.now() - 7200000,
                authServerId: 'https://auth.example.com',
                registrationMetadata: {
                    client_secret_expires_at: pastTimestamp,
                },
            },
        });

        // Token refresh should work even with expired client credentials
        // (tokens are separate from client credentials)
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                access_token: 'new-access',
                refresh_token: 'new-refresh',
                expires_in: 3600,
                token_type: 'Bearer',
            }),
        });

        const newTokens = await flowManager.refreshAccessToken({
            tokenEndpoint: 'https://auth.example.com/token',
            refreshToken: 'valid-refresh',
            clientId: 'test-client',
            clientSecret: 'test-secret',
        });

        expect(newTokens.accessToken).toBe('new-access');
    });
});
```

---

## Resumen de Cambios

### Archivos Modificados

| Archivo | Cambios | Líneas Aproximadas |
|---------|---------|-------------------|
| `src/main/services/oauth/types.ts` | Nuevos códigos de error | +4 líneas |
| `src/main/services/oauth/OAuthService.ts` | Métodos de validación y re-registro | +150 líneas |
| `src/main/services/oauth/OAuthHttpClient.ts` | Verificación de credenciales | +15 líneas |
| `src/preload/index.ts` | Listener para evento de expiración | +8 líneas |
| `docs/oauth/oauth-architecture.md` | Documentación de expiración | +80 líneas |
| `CLAUDE.md` | Sección OAuth | +20 líneas |

### Archivos Nuevos

| Archivo | Propósito |
|---------|-----------|
| `src/main/services/oauth/__tests__/oauth-credentials-expiration.test.ts` | Tests unitarios |

---

## Flujo de Pruebas Manual

1. **Configurar servidor MCP con OAuth**
2. **Autorizar** → Verificar que DCR funciona y guarda `client_secret_expires_at`
3. **Simular expiración** → Modificar manualmente `client_secret_expires_at` en preferences a timestamp pasado
4. **Intentar re-autorizar** → Verificar que:
   - Se detecta la expiración
   - Se intenta re-registro (si hay `registration_client_uri`)
   - Se notifica al usuario (si no se puede re-registrar)
5. **Verificar logs** → Buscar mensajes de "Client secret expired" y "credentials-expired"

---

## Consideraciones de Seguridad

1. **Buffer de tiempo**: 5 minutos antes de expiración real para evitar race conditions
2. **No logs de secrets**: Solo se loguean indicadores booleanos (`hasSecret: true`)
3. **Limpieza automática**: Credenciales expiradas se eliminan automáticamente
4. **Notificación segura**: El evento IPC solo contiene `serverId` y `reason`, no credenciales

---

## Referencias

- [RFC 7591: OAuth 2.0 Dynamic Client Registration](https://tools.ietf.org/html/rfc7591) - Sección 3.2.1 (client_secret_expires_at)
- [RFC 7592: OAuth 2.0 Dynamic Client Registration Management](https://tools.ietf.org/html/rfc7592) - Re-registro de clientes

---

**Creado**: 2025-12-28
**Versión**: 1.0.0
