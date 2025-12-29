# Plan de Implementación: Puerto Fijo para OAuth Loopback

## Problema Actual

El flujo OAuth actual utiliza un **puerto dinámico** para el servidor de redirección loopback. Esto causa problemas con Authorization Servers como Supabase que validan estrictamente el `redirect_uri`:

1. En el DCR (Dynamic Client Registration), se registra el cliente con un `redirect_uri` que incluye el puerto dinámico del momento (ej: `http://127.0.0.1:54321/callback`)
2. En reintentos o futuras autorizaciones, se levanta un nuevo servidor en un **puerto diferente** (ej: `http://127.0.0.1:54892/callback`)
3. El AS compara el `redirect_uri` enviado con el registrado y devuelve error: **"redirect_uri not allowed"**

## Solución Propuesta

Usar siempre el **mismo redirect_uri loopback con puerto fijo** (ej: `http://127.0.0.1:31337/callback`):

1. Definir una constante para el puerto fijo
2. Siempre arrancar el servidor en ese puerto específico
3. Validar credenciales existentes: si tienen un `redirect_uri` diferente, invalidarlas y re-registrar
4. Manejar el caso donde el puerto está ocupado

---

## Archivos a Modificar

| Archivo | Cambios |
|---------|---------|
| `src/main/services/oauth/constants.ts` | **NUEVO** - Constantes OAuth incluyendo puerto fijo |
| `src/main/services/oauth/OAuthRedirectServer.ts` | Usar puerto fijo, manejar puerto ocupado |
| `src/main/services/oauth/OAuthService.ts` | Validar redirect_uri de credenciales existentes |
| `src/main/services/oauth/OAuthDiscoveryService.ts` | Usar redirect_uri fijo en DCR |
| `src/main/services/oauth/index.ts` | Exportar nuevas constantes |

---

## Paso 1: Crear archivo de constantes

### Archivo: `src/main/services/oauth/constants.ts` (NUEVO)

```typescript
/**
 * OAuth Constants
 *
 * Constantes para el flujo OAuth, incluyendo el puerto fijo
 * para el servidor loopback de redirección.
 */

/**
 * Puerto fijo para el servidor loopback OAuth
 *
 * Elegimos 31337 porque:
 * - Está en el rango de puertos no privilegiados (> 1024)
 * - Es poco probable que esté en uso por otras aplicaciones
 * - Es fácil de recordar para debugging
 *
 * Si este puerto estuviera ocupado, el flujo fallará y se
 * informará al usuario que cierre la aplicación que lo usa.
 */
export const OAUTH_LOOPBACK_PORT = 31337;

/**
 * Hostname para el servidor loopback
 * Siempre 127.0.0.1 por seguridad (no localhost)
 */
export const OAUTH_LOOPBACK_HOST = '127.0.0.1';

/**
 * Path del callback OAuth
 */
export const OAUTH_CALLBACK_PATH = '/callback';

/**
 * Redirect URI fijo para OAuth
 * Se usa tanto en DCR como en authorize
 */
export const OAUTH_REDIRECT_URI = `http://${OAUTH_LOOPBACK_HOST}:${OAUTH_LOOPBACK_PORT}${OAUTH_CALLBACK_PATH}`;

/**
 * Timeout para el callback (5 minutos)
 */
export const OAUTH_CALLBACK_TIMEOUT = 5 * 60 * 1000;
```

---

## Paso 2: Modificar OAuthRedirectServer

### Archivo: `src/main/services/oauth/OAuthRedirectServer.ts`

#### 2.1 Importar constantes

**Líneas 1-9 - Agregar import:**

```typescript
import * as http from 'http';
import * as net from 'net';
import { getLogger } from '../logging';
import {
    OAUTH_LOOPBACK_PORT,
    OAUTH_LOOPBACK_HOST,
    OAUTH_CALLBACK_PATH,
    OAUTH_CALLBACK_TIMEOUT,
    OAUTH_REDIRECT_URI,
} from './constants';
import type {
    LoopbackServerConfig,
    LoopbackServerResult,
    AuthorizationCallback,
} from './types';
import { OAuthFlowError } from './types';
```

#### 2.2 Modificar DEFAULT_CONFIG

**Líneas 28-33 - Cambiar a puerto fijo:**

```typescript
    private readonly DEFAULT_CONFIG: Required<LoopbackServerConfig> = {
        port: OAUTH_LOOPBACK_PORT, // Puerto fijo
        hostname: OAUTH_LOOPBACK_HOST,
        callbackPath: OAUTH_CALLBACK_PATH,
        timeout: OAUTH_CALLBACK_TIMEOUT,
    };
```

#### 2.3 Modificar método start()

**Líneas 39-113 - Usar puerto fijo y mejorar manejo de errores:**

```typescript
    /**
     * Inicia el servidor loopback en el puerto fijo
     * Retorna el puerto y redirect_uri
     *
     * @throws OAuthFlowError si el puerto está ocupado
     */
    async start(
        config: LoopbackServerConfig = {}
    ): Promise<LoopbackServerResult> {
        const finalConfig = { ...this.DEFAULT_CONFIG, ...config };

        try {
            // Verificar si el puerto está disponible
            const isAvailable = await this.isPortAvailable(finalConfig.port);

            if (!isAvailable) {
                this.logger.oauth.error('OAuth loopback port is in use', {
                    port: finalConfig.port,
                });

                throw new OAuthFlowError(
                    `Puerto ${finalConfig.port} está ocupado. Por favor, cierra la aplicación que lo esté usando e intenta de nuevo.`,
                    'LOOPBACK_SERVER_FAILED',
                    { port: finalConfig.port, reason: 'PORT_IN_USE' }
                );
            }

            this.port = finalConfig.port;

            this.logger.oauth.info('Starting OAuth redirect server on fixed port', {
                port: this.port,
                hostname: finalConfig.hostname,
            });

            // Crear promise para callback
            this.callbackPromise = new Promise<AuthorizationCallback>(
                (resolve, reject) => {
                    this.resolveCallback = resolve;
                    this.rejectCallback = reject;

                    // Timeout
                    this.timeoutHandle = setTimeout(() => {
                        reject(
                            new OAuthFlowError(
                                'OAuth callback timeout - user did not complete authorization',
                                'CALLBACK_TIMEOUT',
                                { timeout: finalConfig.timeout }
                            )
                        );
                        this.stop();
                    }, finalConfig.timeout);
                }
            );

            // Crear servidor HTTP
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res, finalConfig.callbackPath);
            });

            // Iniciar servidor
            await new Promise<void>((resolve, reject) => {
                this.server!.listen(this.port, finalConfig.hostname, () => {
                    this.logger.oauth.debug('OAuth redirect server listening', {
                        port: this.port,
                    });
                    resolve();
                });

                this.server!.on('error', (error: NodeJS.ErrnoException) => {
                    this.logger.oauth.error('OAuth redirect server error', {
                        error: error.message,
                        code: error.code,
                    });

                    // Mensaje más descriptivo para EADDRINUSE
                    if (error.code === 'EADDRINUSE') {
                        reject(
                            new OAuthFlowError(
                                `Puerto ${this.port} está ocupado. Por favor, cierra la aplicación que lo esté usando e intenta de nuevo.`,
                                'LOOPBACK_SERVER_FAILED',
                                { error: error.message, port: this.port, reason: 'PORT_IN_USE' }
                            )
                        );
                    } else {
                        reject(
                            new OAuthFlowError(
                                'Failed to start loopback server',
                                'LOOPBACK_SERVER_FAILED',
                                { error: error.message }
                            )
                        );
                    }
                });
            });

            // Siempre retornar el redirect URI fijo
            return {
                port: this.port,
                redirectUri: OAUTH_REDIRECT_URI,
            };
        } catch (error) {
            this.logger.oauth.error('Failed to start OAuth redirect server', {
                error: error instanceof Error ? error.message : error,
            });
            throw error;
        }
    }
```

#### 2.4 Reemplazar findAvailablePort con isPortAvailable

**Líneas 164-185 - Cambiar método:**

```typescript
    /**
     * Verifica si el puerto fijo está disponible
     *
     * @param port - Puerto a verificar
     * @returns true si está disponible, false si está ocupado
     */
    private async isPortAvailable(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const server = net.createServer();

            server.once('error', (error: NodeJS.ErrnoException) => {
                if (error.code === 'EADDRINUSE') {
                    this.logger.oauth.debug('Port is in use', { port });
                    resolve(false);
                } else {
                    // Otro error, asumimos que el puerto no está disponible
                    this.logger.oauth.warn('Error checking port availability', {
                        port,
                        error: error.message,
                    });
                    resolve(false);
                }
            });

            server.once('listening', () => {
                server.close(() => {
                    this.logger.oauth.debug('Port is available', { port });
                    resolve(true);
                });
            });

            server.listen(port, OAUTH_LOOPBACK_HOST);
        });
    }
```

---

## Paso 3: Modificar OAuthService

### Archivo: `src/main/services/oauth/OAuthService.ts`

#### 3.1 Importar constantes

**Línea 1-23 - Agregar import:**

```typescript
import { OAuthDiscoveryService } from './OAuthDiscoveryService';
import { OAuthFlowManager } from './OAuthFlowManager';
import { OAuthTokenStore } from './OAuthTokenStore';
import { OAuthHttpClient } from './OAuthHttpClient';
import { OAUTH_REDIRECT_URI } from './constants';
import { safeStorage } from 'electron';
import { PreferencesService } from '../preferencesService';
import { getLogger } from '../logging';
import type {
    OAuthTokens,
    AuthorizationServerMetadata,
    OAuthServiceError,
    OAuthClientCredentials,
    TokenEndpointAuthMethod,
} from './types';
```

#### 3.2 Agregar validación de redirect_uri en getValidClientCredentials

**Líneas 670-727 - Modificar método:**

```typescript
    /**
     * Obtiene credenciales válidas, verificando:
     * 1. Que existan
     * 2. Que el client_secret no haya expirado
     * 3. Que el redirect_uri coincida con el fijo actual
     *
     * Si el redirect_uri no coincide, las credenciales se invalidan
     * y se retorna null para forzar nuevo DCR.
     *
     * @param serverId - ID del servidor MCP
     * @returns Credenciales válidas o null si no hay/no se pueden usar
     */
    async getValidClientCredentials(
        serverId: string
    ): Promise<OAuthClientCredentials | null> {
        const credentials = await this.getClientCredentials(serverId);

        if (!credentials) {
            logger.oauth.debug('No client credentials found', { serverId });
            return null;
        }

        // NUEVO: Verificar que el redirect_uri coincida con el fijo actual
        const storedConfig = await this.preferencesService.get(
            `mcpServers.${serverId}.oauth`
        ) as any;

        if (storedConfig?.redirectUri && storedConfig.redirectUri !== OAUTH_REDIRECT_URI) {
            logger.oauth.warn('Stored redirect_uri does not match fixed port, invalidating credentials', {
                serverId,
                storedRedirectUri: storedConfig.redirectUri,
                expectedRedirectUri: OAUTH_REDIRECT_URI,
            });

            // Eliminar credenciales con redirect_uri antiguo
            await this.deleteClientCredentials(serverId);

            // También limpiar el oauth config
            await this.preferencesService.set(`mcpServers.${serverId}.oauth`, undefined);

            // Notificar que las credenciales fueron invalidadas
            this.notifyCredentialsExpired(serverId, 'registration_revoked');

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
```

#### 3.3 Modificar authorize() para usar redirect_uri fijo

**Líneas 122-132 - Simplificar pre-allocation:**

```typescript
            // Step 2: Pre-allocate redirect server (puerto fijo)
            logger.oauth.info('Step 2: Starting redirect server on fixed port');

            // Start redirect server - siempre usa el puerto fijo
            const redirectServer = this.flowManager['redirectServer'];
            const { redirectUri } = await redirectServer.start();

            logger.oauth.debug('Redirect server started on fixed port', {
                redirectUri,
                expectedUri: OAUTH_REDIRECT_URI,
            });

            // Validar que el redirectUri sea el esperado
            if (redirectUri !== OAUTH_REDIRECT_URI) {
                await redirectServer.stop();
                throw this.createError(
                    'AUTHORIZATION_FAILED',
                    'Redirect URI mismatch',
                    { redirectUri, expected: OAUTH_REDIRECT_URI }
                );
            }
```

---

## Paso 4: Modificar OAuthDiscoveryService

### Archivo: `src/main/services/oauth/OAuthDiscoveryService.ts`

#### 4.1 Importar constantes

**Línea 1-13 - Agregar import:**

```typescript
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
```

#### 4.2 Modificar registerClient para usar redirect_uri fijo

**Líneas 844-863 - Cambiar redirect_uris:**

```typescript
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
```

---

## Paso 5: Actualizar exports

### Archivo: `src/main/services/oauth/index.ts`

**Agregar export de constantes:**

```typescript
// ... exports existentes ...

// Constantes OAuth
export {
    OAUTH_LOOPBACK_PORT,
    OAUTH_LOOPBACK_HOST,
    OAUTH_CALLBACK_PATH,
    OAUTH_REDIRECT_URI,
    OAUTH_CALLBACK_TIMEOUT,
} from './constants';
```

---

## Resumen de Cambios

### Archivos Nuevos
1. `src/main/services/oauth/constants.ts` - Constantes OAuth con puerto fijo

### Archivos Modificados
1. `OAuthRedirectServer.ts`:
   - Usar puerto fijo en lugar de dinámico
   - Cambiar `findAvailablePort()` por `isPortAvailable()`
   - Mejorar mensajes de error para puerto ocupado

2. `OAuthService.ts`:
   - Validar que credenciales existentes usen el redirect_uri fijo
   - Invalidar credenciales con redirect_uri antiguo
   - Forzar nuevo DCR si redirect_uri no coincide

3. `OAuthDiscoveryService.ts`:
   - Usar redirect_uri fijo en DCR
   - Validar que redirectUris proporcionados incluyan el fijo

4. `index.ts`:
   - Exportar nuevas constantes

---

## Flujo Después de la Implementación

```
1. Usuario inicia OAuth
   ↓
2. OAuthService.authorize()
   ↓
3. OAuthRedirectServer.start(port: 31337)
   ├─ Puerto disponible → Continuar
   └─ Puerto ocupado → Error descriptivo
   ↓
4. Verificar credenciales existentes
   ├─ No existen → DCR con redirect_uri fijo
   ├─ Existen pero redirect_uri diferente → Invalidar + DCR nuevo
   └─ Existen y redirect_uri correcto → Usar existentes
   ↓
5. DCR (si necesario)
   └─ redirect_uris: ["http://127.0.0.1:31337/callback"]
   ↓
6. Authorization Flow
   └─ redirect_uri: "http://127.0.0.1:31337/callback"
   ↓
7. Token Exchange
   └─ redirect_uri: "http://127.0.0.1:31337/callback" (MISMO)
   ↓
8. Guardar configuración con redirect_uri fijo
```

---

## Consideraciones Adicionales

### Puerto Ocupado
Si el puerto 31337 está ocupado:
- Se muestra error descriptivo al usuario
- El usuario debe cerrar la aplicación que usa el puerto
- No hay fallback a puerto dinámico (para evitar el problema original)

### Migración de Credenciales Existentes
- Las credenciales con redirect_uri diferente se **invalidan automáticamente**
- Se notifica al usuario vía IPC
- Se fuerza nuevo DCR con el redirect_uri fijo

### Elección del Puerto
El puerto 31337 fue elegido porque:
- Está en el rango de puertos no privilegiados (> 1024)
- Es poco común que esté en uso
- Es memorable para debugging ("elite" en leetspeak)

Si se prefiere otro puerto, solo hay que cambiar `OAUTH_LOOPBACK_PORT` en `constants.ts`.

---

## Testing

### Casos a probar:
1. **Primera autorización**: DCR + authorize con puerto fijo
2. **Re-autorización**: Usar credenciales existentes con mismo redirect_uri
3. **Credenciales antiguas**: Credenciales con redirect_uri dinámico se invalidan
4. **Puerto ocupado**: Error descriptivo y no hay fallback
5. **Supabase**: Verificar que no hay error "redirect_uri not allowed"
