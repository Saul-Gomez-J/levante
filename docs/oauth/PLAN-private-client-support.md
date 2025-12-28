# Plan: Soporte para Private Clients (Confidential Clients) en OAuth

> Plan detallado para añadir soporte completo de clientes confidenciales con `client_secret` en el sistema OAuth de Levante

## Resumen Ejecutivo

### Estado Actual

El sistema OAuth de Levante está diseñado principalmente como **cliente público** (public client):

| Aspecto | Estado Actual | Objetivo |
|---------|---------------|----------|
| DCR Registration | `token_endpoint_auth_method: 'none'` | Soporte para `client_secret_post` y `client_secret_basic` |
| Client Secret | Solo si el AS lo devuelve en DCR | Soportar credenciales pre-configuradas |
| Almacenamiento | Ya soporta encriptación de secrets | ✅ Mantener |
| Token Requests | Incluye secret si existe | ✅ Mantener, mejorar auth methods |
| Pre-config | No detecta credenciales existentes | Leer de config del servidor MCP |

### Capacidades Existentes (Ya Implementadas)

1. ✅ **Encriptación de client_secret** - Usa `safeStorage` (Keychain/DPAPI/libsecret)
2. ✅ **Inclusión en token requests** - `client_secret_post` en body de URLSearchParams
3. ✅ **Tipos TypeScript** - `token_endpoint_auth_method` con valores correctos
4. ✅ **Almacenamiento estructurado** - En `mcpServers.${serverId}.oauth.clientCredentials`

### Gaps a Resolver

1. ❌ DCR siempre solicita `token_endpoint_auth_method: 'none'`
2. ❌ No detecta credenciales pre-configuradas en config del servidor MCP
3. ❌ No soporta `client_secret_basic` (HTTP Basic Auth)
4. ❌ No se puede omitir DCR cuando hay credenciales pre-configuradas
5. ❌ No hay validación de expiración de client_secret

---

## Fase 1: Soporte de Client Secret en DCR

**Objetivo**: Permitir que DCR solicite registro como cliente confidencial cuando sea apropiado.

### Archivos a Modificar

| Archivo | Cambios |
|---------|---------|
| `src/main/services/oauth/OAuthDiscoveryService.ts` | Modificar `registerClient()` |
| `src/main/services/oauth/types.ts` | Añadir tipos para configuración de cliente |
| `src/main/services/oauth/OAuthService.ts` | Pasar preferencia de tipo de cliente |

### Cambios Detallados

#### 1.1 Actualizar `OAuthDiscoveryService.registerClient()`

**Ubicación**: `src/main/services/oauth/OAuthDiscoveryService.ts` (líneas 813-944)

**Cambio**: Añadir parámetro para especificar el tipo de cliente deseado.

```typescript
// Antes (línea 819)
async registerClient(
    registrationEndpoint: string,
    authServerId: string,
    redirectUris?: string[]
): Promise<OAuthClientCredentials>

// Después
async registerClient(
    registrationEndpoint: string,
    authServerId: string,
    options?: {
        redirectUris?: string[];
        preferConfidential?: boolean;  // Nuevo: solicitar client_secret
        tokenEndpointAuthMethod?: 'none' | 'client_secret_post' | 'client_secret_basic';
    }
): Promise<OAuthClientCredentials>
```

**Cambio en el body de registro** (línea 845-860):

```typescript
// Antes
const registrationRequest: OAuthClientRegistrationRequest = {
    client_name: 'Levante',
    // ...
    token_endpoint_auth_method: 'none',  // Public client (PKCE-only)
    // ...
};

// Después
const registrationRequest: OAuthClientRegistrationRequest = {
    client_name: 'Levante',
    // ...
    token_endpoint_auth_method: options?.preferConfidential
        ? (options.tokenEndpointAuthMethod ?? 'client_secret_post')
        : 'none',
    // ...
};
```

#### 1.2 Añadir tipos de configuración

**Ubicación**: `src/main/services/oauth/types.ts`

```typescript
/**
 * Configuración del tipo de cliente OAuth
 */
export interface OAuthClientTypeConfig {
    /** Si es true, intenta registrarse como cliente confidencial */
    preferConfidential: boolean;
    /** Método de autenticación preferido para el token endpoint */
    tokenEndpointAuthMethod: 'none' | 'client_secret_post' | 'client_secret_basic';
}

/**
 * Credenciales de cliente proporcionadas manualmente
 */
export interface ManualClientCredentials {
    clientId: string;
    clientSecret: string;
    /** Método de autenticación a usar */
    tokenEndpointAuthMethod: 'client_secret_post' | 'client_secret_basic';
}
```

### Tests Fase 1

```typescript
// OAuthDiscoveryService.test.ts
describe('registerClient with confidential client', () => {
    it('should request client_secret_post when preferConfidential is true', async () => {
        await discoveryService.registerClient(endpoint, authServerId, {
            preferConfidential: true,
            tokenEndpointAuthMethod: 'client_secret_post'
        });

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.token_endpoint_auth_method).toBe('client_secret_post');
    });

    it('should request client_secret_basic when specified', async () => {
        await discoveryService.registerClient(endpoint, authServerId, {
            preferConfidential: true,
            tokenEndpointAuthMethod: 'client_secret_basic'
        });

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.token_endpoint_auth_method).toBe('client_secret_basic');
    });
});
```

---

## Fase 2: Soporte para HTTP Basic Auth (client_secret_basic)

**Objetivo**: Implementar el método de autenticación `client_secret_basic` según RFC 6749.

### Archivos a Modificar

| Archivo | Cambios |
|---------|---------|
| `src/main/services/oauth/OAuthFlowManager.ts` | Implementar Basic Auth en token requests |
| `src/main/services/oauth/types.ts` | Añadir campo para auth method en params |

### Cambios Detallados

#### 2.1 Actualizar `OAuthFlowManager.exchangeCodeForTokens()`

**Ubicación**: `src/main/services/oauth/OAuthFlowManager.ts` (líneas 220-314)

```typescript
// Actualizar TokenExchangeParams
export interface TokenExchangeParams {
    tokenEndpoint: string;
    code: string;
    redirectUri: string;
    clientId: string;
    codeVerifier: string;
    clientSecret?: string;
    tokenEndpointAuthMethod?: 'none' | 'client_secret_post' | 'client_secret_basic'; // Nuevo
}

// Implementación
async exchangeCodeForTokens(params: TokenExchangeParams): Promise<OAuthTokens> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
    };

    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: params.code,
        redirect_uri: params.redirectUri,
        code_verifier: params.codeVerifier,
    });

    // Autenticación según método configurado
    const authMethod = params.tokenEndpointAuthMethod ??
        (params.clientSecret ? 'client_secret_post' : 'none');

    switch (authMethod) {
        case 'client_secret_basic':
            // RFC 6749 Section 2.3.1: HTTP Basic Authentication
            const credentials = Buffer.from(
                `${encodeURIComponent(params.clientId)}:${encodeURIComponent(params.clientSecret!)}`
            ).toString('base64');
            headers['Authorization'] = `Basic ${credentials}`;
            break;

        case 'client_secret_post':
            // RFC 6749 Section 2.3.1: Client credentials in request body
            body.set('client_id', params.clientId);
            if (params.clientSecret) {
                body.set('client_secret', params.clientSecret);
            }
            break;

        case 'none':
        default:
            // Public client: only client_id
            body.set('client_id', params.clientId);
            break;
    }

    const response = await fetch(params.tokenEndpoint, {
        method: 'POST',
        headers,
        body: body.toString(),
    });
    // ...resto del método
}
```

#### 2.2 Aplicar mismo patrón a `refreshAccessToken()` y `revokeToken()`

Los mismos cambios deben aplicarse a:
- `refreshAccessToken()` (líneas 319-413)
- `revokeToken()` (líneas 427-497)

### Tests Fase 2

```typescript
// OAuthFlowManager.test.ts
describe('client_secret_basic authentication', () => {
    it('should use Basic Auth header for client_secret_basic', async () => {
        await flowManager.exchangeCodeForTokens({
            tokenEndpoint: 'https://auth.example.com/token',
            code: 'code',
            redirectUri: 'http://127.0.0.1:8080/callback',
            clientId: 'my-client',
            codeVerifier: 'verifier',
            clientSecret: 'my-secret',
            tokenEndpointAuthMethod: 'client_secret_basic',
        });

        const headers = fetchMock.mock.calls[0][1].headers;
        const expectedAuth = Buffer.from('my-client:my-secret').toString('base64');
        expect(headers['Authorization']).toBe(`Basic ${expectedAuth}`);

        // Verificar que client_secret NO está en el body
        const body = fetchMock.mock.calls[0][1].body;
        expect(body).not.toContain('client_secret');
    });

    it('should URL-encode special characters in Basic Auth', async () => {
        await flowManager.exchangeCodeForTokens({
            // ...
            clientId: 'client:with:colons',
            clientSecret: 'secret/with/slashes',
            tokenEndpointAuthMethod: 'client_secret_basic',
        });

        const headers = fetchMock.mock.calls[0][1].headers;
        // Debe codificar caracteres especiales según RFC 6749
        const expectedAuth = Buffer.from(
            `${encodeURIComponent('client:with:colons')}:${encodeURIComponent('secret/with/slashes')}`
        ).toString('base64');
        expect(headers['Authorization']).toBe(`Basic ${expectedAuth}`);
    });
});
```

---

## Fase 3: Credenciales Manuales (Skip DCR)

**Objetivo**: Permitir configurar `client_id` y `client_secret` manualmente, omitiendo DCR.

### Archivos a Modificar

| Archivo | Cambios |
|---------|---------|
| `src/main/services/oauth/OAuthService.ts` | Detectar credenciales manuales |
| `src/main/services/oauth/types.ts` | Tipos para autorización manual |
| `src/main/ipc/oauthHandlers.ts` | Nuevo handler para configurar credenciales |

### Cambios Detallados

#### 3.1 Actualizar parámetros de `OAuthService.authorize()`

**Ubicación**: `src/main/services/oauth/OAuthService.ts`

```typescript
// Actualizar AuthorizeParams
export interface AuthorizeParams {
    serverId: string;
    mcpServerUrl: string;
    scopes?: string[];
    wwwAuthHeader?: string;

    // Nuevos campos para credenciales manuales
    manualCredentials?: {
        clientId: string;
        clientSecret: string;
        tokenEndpointAuthMethod: 'client_secret_post' | 'client_secret_basic';
    };

    // Nuevo: preferencia para DCR si no hay credenciales manuales
    clientTypePreference?: {
        preferConfidential: boolean;
        tokenEndpointAuthMethod?: 'none' | 'client_secret_post' | 'client_secret_basic';
    };
}
```

#### 3.2 Modificar flujo de autorización

**En `authorize()` (líneas 71-279)**:

```typescript
async authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
    // STEP 1: Discovery (sin cambios)
    const discoveryResult = await this.discoveryService.discoverFromUnauthorized(
        params.mcpServerUrl,
        params.wwwAuthHeader
    );

    // STEP 2: Start redirect server (sin cambios)
    const { port, redirectUri } = await this.startRedirectServer();

    // STEP 3: Obtener credenciales de cliente
    let clientId: string;
    let clientSecret: string | undefined;
    let tokenEndpointAuthMethod: 'none' | 'client_secret_post' | 'client_secret_basic' = 'none';

    if (params.manualCredentials) {
        // CASO A: Credenciales manuales - Skip DCR
        logger.oauth.info('Using manual client credentials, skipping DCR', {
            serverId: params.serverId,
            hasSecret: true,
        });

        clientId = params.manualCredentials.clientId;
        clientSecret = params.manualCredentials.clientSecret;
        tokenEndpointAuthMethod = params.manualCredentials.tokenEndpointAuthMethod;

        // Guardar credenciales manuales
        await this.saveManualCredentials(params.serverId, {
            clientId,
            clientSecret,
            tokenEndpointAuthMethod,
            authServerId: discoveryResult.authServerId,
            configuredAt: Date.now(),
            isManual: true,
        });

    } else {
        // CASO B: DCR automático (flujo existente mejorado)
        const existingCredentials = await this.getClientCredentials(params.serverId);

        if (existingCredentials) {
            clientId = existingCredentials.clientId;
            clientSecret = existingCredentials.clientSecret;
            tokenEndpointAuthMethod = existingCredentials.tokenEndpointAuthMethod ?? 'none';
        } else if (discoveryResult.metadata.registration_endpoint) {
            // Registrar nuevo cliente
            const credentials = await this.discoveryService.registerClient(
                discoveryResult.metadata.registration_endpoint,
                discoveryResult.authServerId,
                {
                    redirectUris: [redirectUri],
                    preferConfidential: params.clientTypePreference?.preferConfidential ?? false,
                    tokenEndpointAuthMethod: params.clientTypePreference?.tokenEndpointAuthMethod,
                }
            );

            clientId = credentials.clientId;
            clientSecret = credentials.clientSecret;
            tokenEndpointAuthMethod = clientSecret ? 'client_secret_post' : 'none';

            await this.saveClientCredentials(params.serverId, credentials);
        } else {
            throw this.createError('NO_REGISTRATION_ENDPOINT',
                'Authorization server does not support dynamic registration and no manual credentials provided');
        }
    }

    // STEP 4-6: Authorization flow, token exchange, save (actualizar para usar auth method)
    // ...
}
```

#### 3.3 Nuevo método para guardar credenciales manuales

```typescript
/**
 * Guarda credenciales configuradas manualmente (no DCR)
 */
private async saveManualCredentials(
    serverId: string,
    credentials: {
        clientId: string;
        clientSecret: string;
        tokenEndpointAuthMethod: 'client_secret_post' | 'client_secret_basic';
        authServerId: string;
        configuredAt: number;
        isManual: true;
    }
): Promise<void> {
    // Encriptar client_secret
    const toSave = {
        ...credentials,
        clientSecret: `ENCRYPTED:${safeStorage
            .encryptString(credentials.clientSecret)
            .toString('base64')}`,
    };

    await this.preferencesService.set(
        `mcpServers.${serverId}.oauth.clientCredentials`,
        toSave
    );

    logger.oauth.info('Manual client credentials saved', {
        serverId,
        authServerId: credentials.authServerId,
        authMethod: credentials.tokenEndpointAuthMethod,
    });
}
```

#### 3.4 Nuevo IPC handler para configurar credenciales

**Ubicación**: `src/main/ipc/oauthHandlers.ts`

```typescript
// Nuevo handler
ipcMain.handle('levante/oauth/configure-credentials', async (_, params: {
    serverId: string;
    clientId: string;
    clientSecret: string;
    tokenEndpointAuthMethod: 'client_secret_post' | 'client_secret_basic';
    authServerUrl?: string;
}) => {
    try {
        const oauthService = getOAuthService();

        await oauthService.configureManualCredentials(params);

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});
```

### Tests Fase 3

```typescript
// OAuthService.test.ts
describe('manual credentials flow', () => {
    it('should skip DCR when manual credentials provided', async () => {
        const result = await oauthService.authorize({
            serverId: 'test-server',
            mcpServerUrl: 'https://mcp.example.com',
            manualCredentials: {
                clientId: 'my-client-id',
                clientSecret: 'my-client-secret',
                tokenEndpointAuthMethod: 'client_secret_post',
            },
        });

        // Verificar que NO se llamó a registerClient
        expect(discoveryService.registerClient).not.toHaveBeenCalled();

        // Verificar que se guardaron las credenciales
        const saved = await preferencesService.get('mcpServers.test-server.oauth.clientCredentials');
        expect(saved.clientId).toBe('my-client-id');
        expect(saved.clientSecret).toStartWith('ENCRYPTED:');
        expect(saved.isManual).toBe(true);
    });

    it('should use correct auth method in token request', async () => {
        await oauthService.authorize({
            serverId: 'test-server',
            mcpServerUrl: 'https://mcp.example.com',
            manualCredentials: {
                clientId: 'client',
                clientSecret: 'secret',
                tokenEndpointAuthMethod: 'client_secret_basic',
            },
        });

        // Verificar que el token request usa Basic Auth
        const tokenCall = fetchMock.mock.calls.find(c => c[0].includes('/token'));
        expect(tokenCall[1].headers['Authorization']).toContain('Basic ');
    });
});
```

---

## Fase 4: Credenciales Pre-configuradas desde Config del Servidor MCP

**Objetivo**: Leer credenciales `client_id` y `client_secret` desde la configuración del servidor MCP, de la misma forma que ya se almacenan otros parámetros OAuth.

> **Nota**: No se añade UI manual. Las credenciales vienen pre-configuradas en la definición del servidor MCP, similar a cómo funcionan las API keys de los providers.

### Contexto

El almacenamiento actual ya soporta `clientSecret` en `mcpServers.${serverId}.oauth`:

```typescript
// Estructura actual en ui-preferences.json
{
    "mcpServers": {
        "my-server": {
            "oauth": {
                "enabled": true,
                "authServerId": "https://auth.example.com",
                "clientId": "pre-registered-client",      // Ya existe
                "clientSecret": "secret-from-provider",   // Ya existe (encriptado)
                "scopes": ["mcp:read", "mcp:write"],
                "redirectUri": "http://127.0.0.1:8080/callback"
            }
        }
    }
}
```

### Archivos a Modificar

| Archivo | Cambios |
|---------|---------|
| `src/main/services/oauth/OAuthService.ts` | Detectar credenciales pre-configuradas |
| `src/main/services/oauth/types.ts` | Añadir `tokenEndpointAuthMethod` a config |

### Cambios Detallados

#### 4.1 Actualizar tipo `OAuthServerConfig`

**Ubicación**: `src/main/services/oauth/types.ts`

```typescript
/**
 * Configuración OAuth almacenada para un servidor MCP
 */
export interface OAuthServerConfig {
    enabled: boolean;
    authServerId: string;
    clientId: string;
    clientSecret?: string;  // Encriptado con ENCRYPTED: prefix
    scopes: string[];
    redirectUri: string;

    // Nuevo: método de autenticación para token endpoint
    tokenEndpointAuthMethod?: 'none' | 'client_secret_post' | 'client_secret_basic';

    // Nuevo: indica si las credenciales fueron pre-configuradas (vs DCR)
    isPreConfigured?: boolean;
}
```

#### 4.2 Modificar flujo de autorización para detectar credenciales existentes

**Ubicación**: `src/main/services/oauth/OAuthService.ts`

En el método `authorize()`, añadir detección de credenciales pre-configuradas:

```typescript
async authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
    // STEP 1: Verificar si ya hay credenciales pre-configuradas
    const existingConfig = await this.getPreConfiguredCredentials(params.serverId);

    if (existingConfig?.clientId && existingConfig?.clientSecret) {
        logger.oauth.info('Using pre-configured client credentials, skipping DCR', {
            serverId: params.serverId,
            hasSecret: true,
            authMethod: existingConfig.tokenEndpointAuthMethod ?? 'client_secret_post',
        });

        // Usar credenciales pre-configuradas
        clientId = existingConfig.clientId;
        clientSecret = this.decryptIfNeeded(existingConfig.clientSecret);
        tokenEndpointAuthMethod = existingConfig.tokenEndpointAuthMethod ?? 'client_secret_post';
        skipDCR = true;
    }

    // STEP 2: Discovery (sin cambios)
    // ...

    // STEP 3: DCR solo si no hay credenciales pre-configuradas
    if (!skipDCR) {
        // Flujo DCR existente...
    }

    // STEP 4-6: Authorization flow con auth method correcto
    // ...
}
```

#### 4.3 Nuevo método para obtener credenciales pre-configuradas

```typescript
/**
 * Obtiene credenciales pre-configuradas desde la config del servidor MCP
 * (antes de iniciar el flujo OAuth)
 */
private async getPreConfiguredCredentials(
    serverId: string
): Promise<OAuthServerConfig | null> {
    const config = await this.preferencesService.get(
        `mcpServers.${serverId}.oauth`
    ) as OAuthServerConfig | null;

    if (!config) {
        return null;
    }

    // Solo retornar si tiene credenciales completas pre-configuradas
    if (config.clientId && config.clientSecret && config.isPreConfigured) {
        return {
            ...config,
            clientSecret: this.decryptIfNeeded(config.clientSecret),
        };
    }

    return null;
}

/**
 * Desencripta un valor si tiene el prefijo ENCRYPTED:
 */
private decryptIfNeeded(value: string): string {
    if (value.startsWith('ENCRYPTED:')) {
        return safeStorage.decryptString(
            Buffer.from(value.replace('ENCRYPTED:', ''), 'base64')
        );
    }
    return value;
}
```

#### 4.4 Método para configurar credenciales programáticamente

Para casos donde se necesite configurar credenciales desde código (ej: importación de configuración):

```typescript
/**
 * Configura credenciales de cliente para un servidor MCP
 * Usado para pre-configurar credenciales antes del flujo OAuth
 */
async configureClientCredentials(params: {
    serverId: string;
    clientId: string;
    clientSecret: string;
    tokenEndpointAuthMethod?: 'client_secret_post' | 'client_secret_basic';
    authServerId?: string;
}): Promise<void> {
    const encryptedSecret = `ENCRYPTED:${safeStorage
        .encryptString(params.clientSecret)
        .toString('base64')}`;

    // Obtener config existente o crear nueva
    const existingConfig = await this.preferencesService.get(
        `mcpServers.${params.serverId}.oauth`
    ) as OAuthServerConfig | null;

    const newConfig: Partial<OAuthServerConfig> = {
        ...existingConfig,
        clientId: params.clientId,
        clientSecret: encryptedSecret,
        tokenEndpointAuthMethod: params.tokenEndpointAuthMethod ?? 'client_secret_post',
        isPreConfigured: true,
    };

    if (params.authServerId) {
        newConfig.authServerId = params.authServerId;
    }

    await this.preferencesService.set(
        `mcpServers.${params.serverId}.oauth`,
        newConfig
    );

    logger.oauth.info('Client credentials configured', {
        serverId: params.serverId,
        authMethod: params.tokenEndpointAuthMethod ?? 'client_secret_post',
    });
}
```

### Flujo Actualizado

```
┌─────────────────────────────────────────────────────────────────┐
│                    INICIO DE AUTORIZACIÓN                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────────┐
              │ ¿Hay credenciales          │
              │ pre-configuradas?          │
              │ (clientId + clientSecret   │
              │  + isPreConfigured=true)   │
              └─────────────┬──────────────┘
                            │
                 ┌──────────┴──────────┐
                 │                     │
                 ▼                     ▼
            ┌────────┐           ┌──────────┐
            │   SÍ   │           │    NO    │
            └────┬───┘           └────┬─────┘
                 │                    │
                 ▼                    ▼
        ┌─────────────────┐   ┌─────────────────────┐
        │ Usar            │   │ DCR automático      │
        │ credenciales    │   │ (flujo existente)   │
        │ existentes      │   │                     │
        │                 │   │ token_endpoint_auth_│
        │ Skip DCR        │   │ method según Fase 1 │
        └────────┬────────┘   └──────────┬──────────┘
                 │                       │
                 └───────────┬───────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │ Authorization Code Flow      │
              │ (PKCE + auth method)         │
              └──────────────────────────────┘
```

### Ejemplo de Configuración Pre-configurada

```json
// En la configuración del servidor MCP (antes de conectar)
{
    "mcpServers": {
        "enterprise-mcp": {
            "url": "https://mcp.enterprise.com",
            "oauth": {
                "clientId": "levante-enterprise-client",
                "clientSecret": "ENCRYPTED:base64encodedencryptedvalue==",
                "tokenEndpointAuthMethod": "client_secret_basic",
                "isPreConfigured": true,
                "authServerId": "https://auth.enterprise.com"
            }
        }
    }
}
```

### Tests Fase 4

```typescript
// OAuthService.test.ts
describe('pre-configured credentials', () => {
    it('should skip DCR when pre-configured credentials exist', async () => {
        // Setup: pre-configure credentials
        await preferencesService.set('mcpServers.test-server.oauth', {
            clientId: 'pre-configured-client',
            clientSecret: 'ENCRYPTED:...',
            tokenEndpointAuthMethod: 'client_secret_post',
            isPreConfigured: true,
        });

        await oauthService.authorize({
            serverId: 'test-server',
            mcpServerUrl: 'https://mcp.example.com',
        });

        // Verificar que NO se llamó a registerClient
        expect(discoveryService.registerClient).not.toHaveBeenCalled();
    });

    it('should use pre-configured auth method in token request', async () => {
        await preferencesService.set('mcpServers.test-server.oauth', {
            clientId: 'client',
            clientSecret: 'ENCRYPTED:...',
            tokenEndpointAuthMethod: 'client_secret_basic',
            isPreConfigured: true,
        });

        await oauthService.authorize({
            serverId: 'test-server',
            mcpServerUrl: 'https://mcp.example.com',
        });

        // Verificar que el token request usa Basic Auth
        const tokenCall = fetchMock.mock.calls.find(c => c[0].includes('/token'));
        expect(tokenCall[1].headers['Authorization']).toContain('Basic ');
    });

    it('should fallback to DCR if no pre-configured credentials', async () => {
        // No pre-configured credentials

        await oauthService.authorize({
            serverId: 'test-server',
            mcpServerUrl: 'https://mcp.example.com',
        });

        // Verificar que SÍ se llamó a registerClient
        expect(discoveryService.registerClient).toHaveBeenCalled();
    });
});
```

---

## Fase 5: Validación y Expiración de Client Secret

**Objetivo**: Manejar la expiración de `client_secret` según RFC 7591.

### Archivos a Modificar

| Archivo | Cambios |
|---------|---------|
| `src/main/services/oauth/OAuthService.ts` | Validación de expiración |
| `src/main/services/oauth/OAuthHttpClient.ts` | Check antes de requests |

### Cambios Detallados

#### 5.1 Método de validación de expiración

```typescript
// OAuthService.ts
/**
 * Verifica si el client_secret ha expirado
 * @returns true si el secret es válido, false si expiró
 */
private isClientSecretValid(credentials: OAuthClientCredentials): boolean {
    const expiresAt = credentials.registrationMetadata?.client_secret_expires_at;

    // 0 = nunca expira (RFC 7591)
    if (!expiresAt || expiresAt === 0) {
        return true;
    }

    // Añadir buffer de 5 minutos
    const EXPIRY_BUFFER = 5 * 60 * 1000;
    return Date.now() < (expiresAt * 1000) - EXPIRY_BUFFER;
}

/**
 * Obtiene credenciales válidas, re-registrando si es necesario
 */
async getValidClientCredentials(serverId: string): Promise<OAuthClientCredentials | null> {
    const credentials = await this.getClientCredentials(serverId);

    if (!credentials) {
        return null;
    }

    if (!this.isClientSecretValid(credentials)) {
        logger.oauth.warn('Client secret expired, need re-registration', {
            serverId,
            expiresAt: credentials.registrationMetadata?.client_secret_expires_at,
        });

        // Si tiene registration_client_uri, intentar actualizar
        if (credentials.registrationMetadata?.registration_client_uri) {
            try {
                return await this.refreshClientRegistration(serverId, credentials);
            } catch (error) {
                logger.oauth.error('Failed to refresh client registration', { error });
                // Eliminar credenciales expiradas
                await this.deleteClientCredentials(serverId);
                return null;
            }
        }

        // No se puede actualizar, eliminar
        await this.deleteClientCredentials(serverId);
        return null;
    }

    return credentials;
}
```

#### 5.2 Notificación al usuario

```typescript
// Evento IPC para notificar expiración
mainWindow.webContents.send('levante/oauth/credentials-expired', {
    serverId,
    reason: 'client_secret_expired',
    expiresAt: credentials.registrationMetadata?.client_secret_expires_at,
});
```

---

## Fase 6: Documentación y Tests E2E

**Objetivo**: Documentar el nuevo flujo y añadir tests de integración.

### Documentación a Actualizar

| Archivo | Cambios |
|---------|---------|
| `docs/oauth/oauth-architecture.md` | Actualizar con nuevos flujos |
| `docs/guides/oauth-configuration.md` | Nuevo: guía de usuario |
| `CLAUDE.md` | Actualizar sección OAuth |

### Tests E2E

```typescript
// tests/e2e/oauth-private-client.spec.ts
import { test, expect } from '@playwright/test';

test.describe('OAuth Private Client Configuration', () => {
    test('should configure manual credentials', async ({ page }) => {
        // Navegar a configuración de MCP server
        await page.goto('/settings/mcp');

        // Abrir configuración OAuth
        await page.click('[data-testid="oauth-config-button"]');

        // Llenar credenciales
        await page.fill('[data-testid="client-id-input"]', 'test-client-id');
        await page.fill('[data-testid="client-secret-input"]', 'test-client-secret');
        await page.click('[data-testid="auth-method-post"]');

        // Guardar
        await page.click('[data-testid="save-credentials-button"]');

        // Verificar mensaje de éxito
        await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    });

    test('should use Basic Auth when configured', async ({ page }) => {
        // ... configurar con client_secret_basic
        // ... verificar que los requests usan Authorization: Basic
    });
});
```

---

## Resumen de Cambios por Archivo

| Archivo | Fase | Tipo de Cambio |
|---------|------|----------------|
| `OAuthDiscoveryService.ts` | 1 | Modificar `registerClient()` |
| `OAuthFlowManager.ts` | 2 | Implementar `client_secret_basic` |
| `OAuthService.ts` | 1, 3, 4, 5 | Credenciales pre-configuradas, validación |
| `types.ts` | 1, 2, 3, 4 | Nuevos tipos, `OAuthServerConfig` |
| `oauthHandlers.ts` | 3 | Nuevo handler para skip DCR |
| `OAuthHttpClient.ts` | 5 | Validación de expiración |
| Documentación | 6 | Actualizar guías |

---

## Diagrama de Flujo Actualizado

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        FLUJO DE AUTORIZACIÓN                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────┐                                           │
│  │ ¿Credenciales           │                                           │
│  │ pre-configuradas en     │                                           │
│  │ config del servidor MCP?│                                           │
│  └──────────┬──────────────┘                                           │
│             │                                                           │
│      ┌──────┴──────┐                                                   │
│      │             │                                                   │
│      ▼             ▼                                                   │
│  ┌───────┐    ┌────────────────┐                                       │
│  │  SÍ   │    │       NO       │                                       │
│  └───┬───┘    └───────┬────────┘                                       │
│      │                │                                                │
│      ▼                ▼                                                │
│  ┌────────────┐  ┌────────────────────────┐                           │
│  │ Skip DCR   │  │ ¿Credenciales DCR      │                           │
│  │ Usar       │  │ existentes y válidas?  │                           │
│  │ pre-config │  └───────────┬────────────┘                           │
│  └────┬───────┘              │                                        │
│       │            ┌─────────┴────────┐                               │
│       │            │                  │                               │
│       │            ▼                  ▼                               │
│       │       ┌────────┐       ┌───────────┐                          │
│       │       │   SÍ   │       │    NO     │                          │
│       │       └───┬────┘       └─────┬─────┘                          │
│       │           │                  │                                │
│       │           ▼                  ▼                                │
│       │      ┌─────────┐       ┌────────────────┐                     │
│       │      │ Usar    │       │ DCR con        │                     │
│       │      │ DCR     │       │ preferencia de │                     │
│       │      │ existente│      │ tipo cliente   │                     │
│       │      └────┬────┘       └───────┬────────┘                     │
│       │           │                    │                              │
│       │           │    ┌───────────────┘                              │
│       │           │    │                                              │
│       ▼           ▼    ▼                                              │
│  ┌──────────────────────────────────────┐                             │
│  │ Determinar token_endpoint_auth_method│                             │
│  │ • none (public)                      │                             │
│  │ • client_secret_post                 │                             │
│  │ • client_secret_basic                │                             │
│  └──────────────────┬───────────────────┘                             │
│                     │                                                 │
│                     ▼                                                 │
│  ┌──────────────────────────────────────┐                             │
│  │ Authorization Flow (PKCE)            │                             │
│  │ + Auth method para token requests    │                             │
│  └──────────────────────────────────────┘                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Consideraciones de Seguridad

1. **Encriptación**: Todos los `client_secret` se encriptan con `safeStorage` antes de persistir
2. **No logs**: Nunca loguear valores de secrets, solo indicadores booleanos (`hasSecret: true`)
3. **Memoria**: Limpiar secrets de memoria después de uso
4. **Transporte**: Solo HTTPS para endpoints de token (excepto localhost)
5. **Validación**: Verificar expiración de secrets antes de cada uso

---

## Cronograma Sugerido

| Fase | Descripción | Complejidad |
|------|-------------|-------------|
| 1 | DCR con tipo de cliente | Media |
| 2 | HTTP Basic Auth | Baja |
| 3 | Skip DCR con credenciales existentes | Media |
| 4 | Credenciales pre-configuradas desde config MCP | Baja |
| 5 | Validación de expiración | Baja |
| 6 | Documentación y tests | Media |

---

## Referencias

- [RFC 6749: OAuth 2.0 Authorization Framework](https://tools.ietf.org/html/rfc6749) - Sección 2.3 (Client Authentication)
- [RFC 7591: OAuth 2.0 Dynamic Client Registration](https://tools.ietf.org/html/rfc7591)
- [RFC 6749 Section 2.3.1: Client Password](https://tools.ietf.org/html/rfc6749#section-2.3.1)

---

**Creado**: 2025-12-28
**Versión**: 1.0.0
