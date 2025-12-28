# Plan de Implementación: Fases 1 y 2 - Soporte Private Clients OAuth

> Plan detallado paso a paso para implementar soporte de clientes confidenciales en el sistema OAuth de Levante

## Resumen

Este documento detalla la implementación de las Fases 1 y 2 del plan de soporte para Private Clients:

| Fase | Descripción | Complejidad |
|------|-------------|-------------|
| **Fase 1** | Soporte de Client Secret en DCR | Media |
| **Fase 2** | Soporte para HTTP Basic Auth (`client_secret_basic`) | Baja |

---

## Estado Actual del Código

### Archivos Principales

| Archivo | Líneas Clave | Estado Actual |
|---------|--------------|---------------|
| `src/main/services/oauth/types.ts` | 172-190, 195-210, 505-529, 594-609 | Tipos existentes sin `tokenEndpointAuthMethod` |
| `src/main/services/oauth/OAuthDiscoveryService.ts` | 813-944 | `registerClient()` usa `token_endpoint_auth_method: 'none'` fijo |
| `src/main/services/oauth/OAuthFlowManager.ts` | 220-314, 319-413, 427-497 | Solo soporta `client_secret_post` |
| `src/main/services/oauth/OAuthService.ts` | 71-279 | Orquestador, pasa parámetros a DCR |

---

## Fase 1: Soporte de Client Secret en DCR

### Objetivo

Permitir que DCR (Dynamic Client Registration) solicite registro como cliente confidencial cuando sea apropiado.

### 1.1 Modificar Tipos en `types.ts`

**Archivo**: `src/main/services/oauth/types.ts`

#### Cambio 1.1.1: Añadir tipo `TokenEndpointAuthMethod`

**Ubicación**: Después de la línea 28 (después de `OAuthTokens`)

```typescript
/**
 * Método de autenticación para el token endpoint
 * RFC 6749 Section 2.3.1
 */
export type TokenEndpointAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic';
```

#### Cambio 1.1.2: Actualizar `TokenExchangeParams`

**Ubicación**: Líneas 172-190

**Antes**:
```typescript
export interface TokenExchangeParams {
    tokenEndpoint: string;
    code: string;
    redirectUri: string;
    clientId: string;
    codeVerifier: string;
    clientSecret?: string;
}
```

**Después**:
```typescript
export interface TokenExchangeParams {
    /** Token endpoint del AS */
    tokenEndpoint: string;

    /** Authorization code recibido */
    code: string;

    /** Redirect URI usado en authorization */
    redirectUri: string;

    /** Client ID */
    clientId: string;

    /** PKCE code verifier */
    codeVerifier: string;

    /** Client secret (solo confidential clients) */
    clientSecret?: string;

    /** Método de autenticación para el token endpoint */
    tokenEndpointAuthMethod?: TokenEndpointAuthMethod;
}
```

#### Cambio 1.1.3: Actualizar `TokenRefreshParams`

**Ubicación**: Líneas 195-210

**Antes**:
```typescript
export interface TokenRefreshParams {
    tokenEndpoint: string;
    refreshToken: string;
    clientId: string;
    clientSecret?: string;
    scopes?: string[];
}
```

**Después**:
```typescript
export interface TokenRefreshParams {
    /** Token endpoint del AS */
    tokenEndpoint: string;

    /** Refresh token */
    refreshToken: string;

    /** Client ID */
    clientId: string;

    /** Client secret (solo confidential clients) */
    clientSecret?: string;

    /** Scopes a solicitar (opcional) */
    scopes?: string[];

    /** Método de autenticación para el token endpoint */
    tokenEndpointAuthMethod?: TokenEndpointAuthMethod;
}
```

#### Cambio 1.1.4: Actualizar `TokenRevocationParams`

**Ubicación**: Líneas 594-609

**Antes**:
```typescript
export interface TokenRevocationParams {
    revocationEndpoint: string;
    token: string;
    tokenTypeHint?: 'access_token' | 'refresh_token';
    clientId: string;
    clientSecret?: string;
}
```

**Después**:
```typescript
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

    /** Método de autenticación para el token endpoint */
    tokenEndpointAuthMethod?: TokenEndpointAuthMethod;
}
```

#### Cambio 1.1.5: Añadir interfaz `ClientRegistrationOptions`

**Ubicación**: Después de `OAuthClientRegistrationRequest` (línea 529)

```typescript
/**
 * Opciones para registro dinámico de cliente
 */
export interface ClientRegistrationOptions {
    /** URIs de redirección */
    redirectUris?: string[];

    /** Si es true, intenta registrarse como cliente confidencial */
    preferConfidential?: boolean;

    /** Método de autenticación preferido para el token endpoint */
    tokenEndpointAuthMethod?: TokenEndpointAuthMethod;
}
```

#### Cambio 1.1.6: Actualizar `OAuthClientCredentials`

**Ubicación**: Líneas 565-575

**Antes**:
```typescript
export interface OAuthClientCredentials {
    clientId: string;
    clientSecret?: string;
    registeredAt: number;
    authServerId: string;
    registrationMetadata?: {
        client_secret_expires_at?: number;
        registration_access_token?: string;
        registration_client_uri?: string;
    };
}
```

**Después**:
```typescript
export interface OAuthClientCredentials {
    clientId: string;
    clientSecret?: string;
    registeredAt: number;
    authServerId: string;

    /** Método de autenticación configurado para este cliente */
    tokenEndpointAuthMethod?: TokenEndpointAuthMethod;

    registrationMetadata?: {
        client_secret_expires_at?: number;
        registration_access_token?: string;
        registration_client_uri?: string;
    };
}
```

---

### 1.2 Modificar `OAuthDiscoveryService.registerClient()`

**Archivo**: `src/main/services/oauth/OAuthDiscoveryService.ts`

**Ubicación**: Líneas 813-944

#### Cambio 1.2.1: Actualizar firma del método

**Antes** (líneas 813-817):
```typescript
async registerClient(
    registrationEndpoint: string,
    authServerId: string,
    redirectUris?: string[]
): Promise<OAuthClientCredentials>
```

**Después**:
```typescript
async registerClient(
    registrationEndpoint: string,
    authServerId: string,
    options?: ClientRegistrationOptions
): Promise<OAuthClientCredentials>
```

#### Cambio 1.2.2: Actualizar imports

**Ubicación**: Líneas 1-12

Añadir `ClientRegistrationOptions` al import:

```typescript
import type {
    ProtectedResourceMetadata,
    AuthorizationServerMetadata,
    WWWAuthenticateParams,
    CachedMetadata,
    DiscoveryResult,
    OAuthClientRegistrationRequest,
    OAuthClientRegistrationResponse,
    OAuthClientCredentials,
    ClientRegistrationOptions,  // NUEVO
} from './types';
```

#### Cambio 1.2.3: Actualizar logging inicial

**Antes** (líneas 818-822):
```typescript
this.logger.mcp.info('Attempting Dynamic Client Registration', {
    registrationEndpoint,
    authServerId,
    redirectUris,
});
```

**Después**:
```typescript
this.logger.mcp.info('Attempting Dynamic Client Registration', {
    registrationEndpoint,
    authServerId,
    redirectUris: options?.redirectUris,
    preferConfidential: options?.preferConfidential ?? false,
    requestedAuthMethod: options?.tokenEndpointAuthMethod ?? 'none',
});
```

#### Cambio 1.2.4: Actualizar construcción del request

**Antes** (líneas 837-856):
```typescript
const registrationRequest: OAuthClientRegistrationRequest = {
    client_name: 'Levante',
    client_uri: 'https://github.com/levante-hub/levante',
    redirect_uris: redirectUris || ['http://127.0.0.1/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'mcp:read mcp:write',
};
```

**Después**:
```typescript
// Determinar método de autenticación
const authMethod = options?.preferConfidential
    ? (options.tokenEndpointAuthMethod ?? 'client_secret_post')
    : 'none';

const registrationRequest: OAuthClientRegistrationRequest = {
    client_name: 'Levante',
    client_uri: 'https://github.com/levante-hub/levante',
    redirect_uris: options?.redirectUris || ['http://127.0.0.1/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: authMethod,
    scope: 'mcp:read mcp:write',
};

this.logger.mcp.debug('Registration request prepared', {
    authMethod,
    redirectUris: registrationRequest.redirect_uris,
});
```

#### Cambio 1.2.5: Actualizar construcción de credentials

**Antes** (líneas 914-926):
```typescript
const credentials: OAuthClientCredentials = {
    clientId: data.client_id,
    clientSecret: data.client_secret,
    registeredAt: Date.now(),
    authServerId,
    registrationMetadata: {
        client_secret_expires_at: data.client_secret_expires_at,
        registration_access_token: data.registration_access_token,
        registration_client_uri: data.registration_client_uri,
    },
};
```

**Después**:
```typescript
// Determinar el auth method efectivo basado en si recibimos client_secret
const effectiveAuthMethod = data.client_secret
    ? (options?.tokenEndpointAuthMethod ?? 'client_secret_post')
    : 'none';

const credentials: OAuthClientCredentials = {
    clientId: data.client_id,
    clientSecret: data.client_secret,
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
```

---

### 1.3 Actualizar `OAuthService.authorize()`

**Archivo**: `src/main/services/oauth/OAuthService.ts`

#### Cambio 1.3.1: Añadir variable para auth method

**Ubicación**: Después de la línea 130 (donde se declara `clientSecret`)

**Antes**:
```typescript
let clientId = providedClientId;
let clientSecret: string | undefined;
```

**Después**:
```typescript
let clientId = providedClientId;
let clientSecret: string | undefined;
let tokenEndpointAuthMethod: 'none' | 'client_secret_post' | 'client_secret_basic' = 'none';
```

#### Cambio 1.3.2: Actualizar llamada a `registerClient()`

**Ubicación**: Líneas 144-149

**Antes**:
```typescript
const credentials =
    await this.discoveryService.registerClient(
        metadata.registration_endpoint!,
        authServerId,
        [redirectUri]
    );
```

**Después**:
```typescript
const credentials =
    await this.discoveryService.registerClient(
        metadata.registration_endpoint!,
        authServerId,
        {
            redirectUris: [redirectUri],
            // Por ahora, seguimos como public client
            // En fases futuras, esto podría venir de configuración
            preferConfidential: false,
        }
    );
```

#### Cambio 1.3.3: Capturar auth method de credentials

**Ubicación**: Después de línea 151 (donde se asigna `clientSecret`)

**Antes**:
```typescript
clientId = credentials.clientId;
clientSecret = credentials.clientSecret;
```

**Después**:
```typescript
clientId = credentials.clientId;
clientSecret = credentials.clientSecret;
tokenEndpointAuthMethod = credentials.tokenEndpointAuthMethod ?? 'none';
```

#### Cambio 1.3.4: Pasar auth method a `exchangeCodeForTokens()`

**Ubicación**: Líneas 228-235

**Antes**:
```typescript
const tokens = await this.flowManager.exchangeCodeForTokens({
    tokenEndpoint: metadata.token_endpoint,
    code: authResult.code,
    redirectUri: authResult.redirectUri,
    clientId,
    codeVerifier: authResult.verifier,
    clientSecret,
});
```

**Después**:
```typescript
const tokens = await this.flowManager.exchangeCodeForTokens({
    tokenEndpoint: metadata.token_endpoint,
    code: authResult.code,
    redirectUri: authResult.redirectUri,
    clientId,
    codeVerifier: authResult.verifier,
    clientSecret,
    tokenEndpointAuthMethod,
});
```

---

## Fase 2: Soporte para HTTP Basic Auth (`client_secret_basic`)

### Objetivo

Implementar el método de autenticación `client_secret_basic` según RFC 6749 Section 2.3.1.

### 2.1 Crear función helper para autenticación

**Archivo**: `src/main/services/oauth/OAuthFlowManager.ts`

**Ubicación**: Añadir después de las importaciones (línea 14), antes de la clase

```typescript
import type { TokenEndpointAuthMethod } from './types';

/**
 * Aplica autenticación de cliente a un request según el método especificado
 * RFC 6749 Section 2.3.1
 *
 * @param headers - Headers del request (se modifican in-place)
 * @param body - URLSearchParams del body (se modifican in-place)
 * @param clientId - Client ID
 * @param clientSecret - Client secret (opcional para public clients)
 * @param authMethod - Método de autenticación
 */
function applyClientAuthentication(
    headers: Record<string, string>,
    body: URLSearchParams,
    clientId: string,
    clientSecret: string | undefined,
    authMethod: TokenEndpointAuthMethod = 'none'
): void {
    switch (authMethod) {
        case 'client_secret_basic':
            // RFC 6749 Section 2.3.1: HTTP Basic Authentication
            // client_id y client_secret deben ser URL-encoded antes de Base64
            if (!clientSecret) {
                throw new OAuthFlowError(
                    'client_secret_basic requires a client secret',
                    'TOKEN_EXCHANGE_FAILED',
                    { authMethod }
                );
            }
            const credentials = Buffer.from(
                `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`
            ).toString('base64');
            headers['Authorization'] = `Basic ${credentials}`;
            // NO incluir client_id/client_secret en el body
            break;

        case 'client_secret_post':
            // RFC 6749 Section 2.3.1: Client credentials in request body
            body.set('client_id', clientId);
            if (clientSecret) {
                body.set('client_secret', clientSecret);
            }
            break;

        case 'none':
        default:
            // Public client: solo client_id en el body
            body.set('client_id', clientId);
            break;
    }
}
```

### 2.2 Actualizar import de tipos

**Archivo**: `src/main/services/oauth/OAuthFlowManager.ts`

**Ubicación**: Líneas 6-14

**Antes**:
```typescript
import type {
    PKCEParams,
    AuthorizationUrlParams,
    TokenExchangeParams,
    TokenRefreshParams,
    OAuthTokens,
    TokenRevocationParams,
} from './types';
import { OAuthFlowError } from './types';
```

**Después**:
```typescript
import type {
    PKCEParams,
    AuthorizationUrlParams,
    TokenExchangeParams,
    TokenRefreshParams,
    OAuthTokens,
    TokenRevocationParams,
    TokenEndpointAuthMethod,
} from './types';
import { OAuthFlowError } from './types';
```

### 2.3 Modificar `exchangeCodeForTokens()`

**Archivo**: `src/main/services/oauth/OAuthFlowManager.ts`

**Ubicación**: Líneas 220-314

**Antes** (líneas 228-250):
```typescript
// Construir body
const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.codeVerifier,
});

// Client secret (solo confidential clients)
if (params.clientSecret) {
    body.set('client_secret', params.clientSecret);
}

// Hacer request
const response = await fetch(params.tokenEndpoint, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
    },
    body: body.toString(),
});
```

**Después**:
```typescript
// Construir body base (sin credenciales de cliente)
const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
});

// Preparar headers
const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
};

// Aplicar autenticación de cliente según método configurado
applyClientAuthentication(
    headers,
    body,
    params.clientId,
    params.clientSecret,
    params.tokenEndpointAuthMethod ?? (params.clientSecret ? 'client_secret_post' : 'none')
);

this.logger.oauth.debug('Token exchange request prepared', {
    authMethod: params.tokenEndpointAuthMethod ?? 'auto',
    hasBasicAuth: !!headers['Authorization'],
});

// Hacer request
const response = await fetch(params.tokenEndpoint, {
    method: 'POST',
    headers,
    body: body.toString(),
});
```

### 2.4 Modificar `refreshAccessToken()`

**Archivo**: `src/main/services/oauth/OAuthFlowManager.ts`

**Ubicación**: Líneas 319-413

**Antes** (líneas 325-350):
```typescript
// Construir body
const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
});

// Client secret (solo confidential clients)
if (params.clientSecret) {
    body.set('client_secret', params.clientSecret);
}

// Scopes (opcional)
if (params.scopes && params.scopes.length > 0) {
    body.set('scope', params.scopes.join(' '));
}

// Hacer request
const response = await fetch(params.tokenEndpoint, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
    },
    body: body.toString(),
});
```

**Después**:
```typescript
// Construir body base (sin credenciales de cliente)
const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
});

// Scopes (opcional)
if (params.scopes && params.scopes.length > 0) {
    body.set('scope', params.scopes.join(' '));
}

// Preparar headers
const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
};

// Aplicar autenticación de cliente según método configurado
applyClientAuthentication(
    headers,
    body,
    params.clientId,
    params.clientSecret,
    params.tokenEndpointAuthMethod ?? (params.clientSecret ? 'client_secret_post' : 'none')
);

this.logger.oauth.debug('Token refresh request prepared', {
    authMethod: params.tokenEndpointAuthMethod ?? 'auto',
    hasBasicAuth: !!headers['Authorization'],
});

// Hacer request
const response = await fetch(params.tokenEndpoint, {
    method: 'POST',
    headers,
    body: body.toString(),
});
```

### 2.5 Modificar `revokeToken()`

**Archivo**: `src/main/services/oauth/OAuthFlowManager.ts`

**Ubicación**: Líneas 427-497

**Antes** (líneas 434-458):
```typescript
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
```

**Después**:
```typescript
// Construir body base según RFC 7009 (sin credenciales de cliente)
const body = new URLSearchParams({
    token: params.token,
});

// Token type hint (opcional pero recomendado)
if (params.tokenTypeHint) {
    body.set('token_type_hint', params.tokenTypeHint);
}

// Preparar headers
const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
};

// Aplicar autenticación de cliente según método configurado
applyClientAuthentication(
    headers,
    body,
    params.clientId,
    params.clientSecret,
    params.tokenEndpointAuthMethod ?? (params.clientSecret ? 'client_secret_post' : 'none')
);

this.logger.oauth.debug('Token revocation request prepared', {
    tokenTypeHint: params.tokenTypeHint,
    authMethod: params.tokenEndpointAuthMethod ?? 'auto',
    hasBasicAuth: !!headers['Authorization'],
});

// Hacer request
const response = await fetch(params.revocationEndpoint, {
    method: 'POST',
    headers,
    body: body.toString(),
});
```

---

## Resumen de Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `src/main/services/oauth/types.ts` | 6 cambios: nuevo tipo, 4 interfaces actualizadas, 1 interface nueva |
| `src/main/services/oauth/OAuthDiscoveryService.ts` | 5 cambios: firma, imports, logging, request, credentials |
| `src/main/services/oauth/OAuthFlowManager.ts` | 4 cambios: helper function, imports, 3 métodos actualizados |
| `src/main/services/oauth/OAuthService.ts` | 4 cambios: variable, llamada DCR, captura auth method, token exchange |

---

## Orden de Implementación Recomendado

1. **types.ts** - Primero los tipos para que el resto compile
2. **OAuthFlowManager.ts** - Helper function y métodos actualizados
3. **OAuthDiscoveryService.ts** - Actualizar registerClient()
4. **OAuthService.ts** - Integrar todo en el orquestador

---

## Tests Sugeridos

### Tests Fase 1

```typescript
// OAuthDiscoveryService.test.ts
describe('registerClient with confidential client options', () => {
    it('should request none when preferConfidential is false', async () => {
        await discoveryService.registerClient(endpoint, authServerId, {
            preferConfidential: false,
        });

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.token_endpoint_auth_method).toBe('none');
    });

    it('should request client_secret_post when preferConfidential is true', async () => {
        await discoveryService.registerClient(endpoint, authServerId, {
            preferConfidential: true,
        });

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.token_endpoint_auth_method).toBe('client_secret_post');
    });

    it('should request client_secret_basic when specified', async () => {
        await discoveryService.registerClient(endpoint, authServerId, {
            preferConfidential: true,
            tokenEndpointAuthMethod: 'client_secret_basic',
        });

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.token_endpoint_auth_method).toBe('client_secret_basic');
    });

    it('should include tokenEndpointAuthMethod in returned credentials', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                client_id: 'test-client',
                client_secret: 'test-secret',
            }),
        });

        const credentials = await discoveryService.registerClient(endpoint, authServerId, {
            preferConfidential: true,
            tokenEndpointAuthMethod: 'client_secret_basic',
        });

        expect(credentials.tokenEndpointAuthMethod).toBe('client_secret_basic');
    });
});
```

### Tests Fase 2

```typescript
// OAuthFlowManager.test.ts
describe('client authentication methods', () => {
    describe('client_secret_basic', () => {
        it('should use Basic Auth header', async () => {
            await flowManager.exchangeCodeForTokens({
                tokenEndpoint: 'https://auth.example.com/token',
                code: 'test-code',
                redirectUri: 'http://127.0.0.1:8080/callback',
                clientId: 'my-client',
                codeVerifier: 'verifier',
                clientSecret: 'my-secret',
                tokenEndpointAuthMethod: 'client_secret_basic',
            });

            const [, options] = fetchMock.mock.calls[0];
            const expectedAuth = Buffer.from('my-client:my-secret').toString('base64');
            expect(options.headers['Authorization']).toBe(`Basic ${expectedAuth}`);

            // Verificar que client_id/client_secret NO están en el body
            expect(options.body).not.toContain('client_id');
            expect(options.body).not.toContain('client_secret');
        });

        it('should URL-encode special characters', async () => {
            await flowManager.exchangeCodeForTokens({
                tokenEndpoint: 'https://auth.example.com/token',
                code: 'test-code',
                redirectUri: 'http://127.0.0.1:8080/callback',
                clientId: 'client:id',
                codeVerifier: 'verifier',
                clientSecret: 'secret/pass',
                tokenEndpointAuthMethod: 'client_secret_basic',
            });

            const [, options] = fetchMock.mock.calls[0];
            const expectedAuth = Buffer.from(
                `${encodeURIComponent('client:id')}:${encodeURIComponent('secret/pass')}`
            ).toString('base64');
            expect(options.headers['Authorization']).toBe(`Basic ${expectedAuth}`);
        });

        it('should throw error if no client_secret provided', async () => {
            await expect(
                flowManager.exchangeCodeForTokens({
                    tokenEndpoint: 'https://auth.example.com/token',
                    code: 'test-code',
                    redirectUri: 'http://127.0.0.1:8080/callback',
                    clientId: 'my-client',
                    codeVerifier: 'verifier',
                    tokenEndpointAuthMethod: 'client_secret_basic',
                })
            ).rejects.toThrow('client_secret_basic requires a client secret');
        });
    });

    describe('client_secret_post', () => {
        it('should include credentials in body', async () => {
            await flowManager.exchangeCodeForTokens({
                tokenEndpoint: 'https://auth.example.com/token',
                code: 'test-code',
                redirectUri: 'http://127.0.0.1:8080/callback',
                clientId: 'my-client',
                codeVerifier: 'verifier',
                clientSecret: 'my-secret',
                tokenEndpointAuthMethod: 'client_secret_post',
            });

            const [, options] = fetchMock.mock.calls[0];
            expect(options.body).toContain('client_id=my-client');
            expect(options.body).toContain('client_secret=my-secret');
            expect(options.headers['Authorization']).toBeUndefined();
        });
    });

    describe('none (public client)', () => {
        it('should only include client_id in body', async () => {
            await flowManager.exchangeCodeForTokens({
                tokenEndpoint: 'https://auth.example.com/token',
                code: 'test-code',
                redirectUri: 'http://127.0.0.1:8080/callback',
                clientId: 'my-client',
                codeVerifier: 'verifier',
                tokenEndpointAuthMethod: 'none',
            });

            const [, options] = fetchMock.mock.calls[0];
            expect(options.body).toContain('client_id=my-client');
            expect(options.body).not.toContain('client_secret');
            expect(options.headers['Authorization']).toBeUndefined();
        });
    });

    describe('auto-detection', () => {
        it('should use client_secret_post when secret provided without explicit method', async () => {
            await flowManager.exchangeCodeForTokens({
                tokenEndpoint: 'https://auth.example.com/token',
                code: 'test-code',
                redirectUri: 'http://127.0.0.1:8080/callback',
                clientId: 'my-client',
                codeVerifier: 'verifier',
                clientSecret: 'my-secret',
                // No tokenEndpointAuthMethod specified
            });

            const [, options] = fetchMock.mock.calls[0];
            expect(options.body).toContain('client_secret=my-secret');
        });
    });
});
```

---

## Consideraciones de Seguridad

1. **URL Encoding en Basic Auth**: Los caracteres especiales en `client_id` y `client_secret` DEBEN ser URL-encoded antes de la codificación Base64 (RFC 6749 Section 2.3.1)

2. **No loguear secrets**: Solo loguear indicadores booleanos (`hasSecret: true`) nunca valores

3. **Validación de método**: Si se especifica `client_secret_basic` pero no hay `clientSecret`, lanzar error inmediatamente

4. **Backward compatibility**: El comportamiento por defecto (`tokenEndpointAuthMethod` no especificado) mantiene la lógica actual: usar `client_secret_post` si hay secret, `none` si no

---

## Referencias

- [RFC 6749 Section 2.3.1: Client Authentication](https://tools.ietf.org/html/rfc6749#section-2.3.1)
- [RFC 7591: OAuth 2.0 Dynamic Client Registration](https://tools.ietf.org/html/rfc7591)

---

**Creado**: 2025-12-28
**Versión**: 1.0.0
