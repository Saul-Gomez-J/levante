# OAuth Flows Analysis - Levante

Este documento proporciona un análisis exhaustivo de los dos flujos OAuth distintos implementados en Levante:

1. **OAuth para MCPs** (Model Context Protocol): Sistema completo OAuth 2.1
2. **OAuth para OpenRouter**: Flujo híbrido para obtención de API keys

---

## Tabla de Contenidos

- [1. Resumen Ejecutivo](#1-resumen-ejecutivo)
- [2. OAuth para MCPs](#2-oauth-para-mcps)
  - [2.1 Arquitectura](#21-arquitectura)
  - [2.2 Flujo Completo](#22-flujo-completo)
  - [2.3 Implementación PKCE](#23-implementación-pkce)
  - [2.4 Dynamic Client Registration](#24-dynamic-client-registration)
  - [2.5 Token Management](#25-token-management)
  - [2.6 Almacenamiento de Credenciales](#26-almacenamiento-de-credenciales)
- [3. OAuth para OpenRouter](#3-oauth-para-openrouter)
  - [3.1 Arquitectura](#31-arquitectura)
  - [3.2 Flujo Completo](#32-flujo-completo)
  - [3.3 Endpoints Utilizados](#33-endpoints-utilizados)
  - [3.4 Almacenamiento de API Keys](#34-almacenamiento-de-api-keys)
- [4. Comparación de Flujos](#4-comparación-de-flujos)
- [5. Archivos Principales](#5-archivos-principales)
- [6. Interfaces TypeScript](#6-interfaces-typescript)
- [7. Seguridad](#7-seguridad)

---

## 1. Resumen Ejecutivo

### OAuth para MCPs
- **Propósito**: Autenticación server-to-server con servidores MCP protegidos
- **Estándar**: OAuth 2.1 completo con PKCE obligatorio
- **Características**:
  - Discovery automático (RFC 9728, RFC 8414)
  - Dynamic Client Registration (RFC 7591)
  - Token refresh automático
  - Token revocation al desconectar (RFC 7009)
  - Manejo de expiración de client_secret

### OAuth para OpenRouter
- **Propósito**: Obtención de API keys del usuario mediante OAuth
- **Estándar**: OAuth 2.1 simplificado (solo obtención de key)
- **Características**:
  - PKCE para seguridad del código
  - Servidor callback local (localhost:3000)
  - Sin DCR (OpenRouter es proveedor público)
  - Uso posterior con Bearer authentication simple

---

## 2. OAuth para MCPs

### 2.1 Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                        RENDERER (UI)                            │
│                    oauthStore (Zustand)                         │
│           IPC Handlers: authorize, disconnect, etc              │
└──────────────────────────┬──────────────────────────────────────┘
                           │ IPC levante/oauth/*
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     MAIN PROCESS (Node.js)                      │
│                                                                 │
│  ┌──────────────────┐   ┌──────────────────────────────┐       │
│  │  OAuthService    │   │   IPC Handlers               │       │
│  │  (Orchestrator)  │◄──┤   - handleAuthorize()        │       │
│  └────────┬─────────┘   │   - handleDisconnect()       │       │
│           │             │   - handleStatus()           │       │
│    ┌──────┴─────────────┤   - handleRefresh()          │       │
│    │                    └──────────────────────────────┘       │
│    ▼                                                            │
│  ┌───────────────────────────────────────┐                     │
│  │      Discovery Services               │                     │
│  ├───────────────────────────────────────┤                     │
│  │ • OAuthDiscoveryService               │                     │
│  │   - discoverFromUnauthorized()        │                     │
│  │   - fetchServerMetadata()             │                     │
│  │   - parseWWWAuthenticate()            │                     │
│  │   - registerClient() [RFC 7591]       │                     │
│  └───────────────────────────────────────┘                     │
│    │                                                            │
│    ▼                                                            │
│  ┌───────────────────────────────────────┐                     │
│  │      Flow Management                  │                     │
│  ├───────────────────────────────────────┤                     │
│  │ • OAuthFlowManager                    │                     │
│  │   - generatePKCE() [S256]             │                     │
│  │   - createAuthorizationUrl()          │                     │
│  │   - exchangeCodeForTokens()           │                     │
│  │   - refreshAccessToken()              │                     │
│  │   - revokeToken()                     │                     │
│  │                                       │                     │
│  │ • OAuthRedirectServer                 │                     │
│  │   - start() [Puerto 31337]            │                     │
│  │   - waitForCallback()                 │                     │
│  │                                       │                     │
│  │ • OAuthStateManager                   │                     │
│  │   - generateState()                   │                     │
│  │   - validateAndRetrieveState()        │                     │
│  └───────────────────────────────────────┘                     │
│    │                                                            │
│    ▼                                                            │
│  ┌───────────────────────────────────────┐                     │
│  │    HTTP & Token Management            │                     │
│  ├───────────────────────────────────────┤                     │
│  │ • OAuthHttpClient                     │                     │
│  │   - ensureValidToken()                │                     │
│  │   - handleUnauthorized()              │                     │
│  │                                       │                     │
│  │ • OAuthTokenStore                     │                     │
│  │   - saveTokens() [Encriptado]         │                     │
│  │   - getTokens() [Desencriptado]       │                     │
│  │   - isTokenExpired()                  │                     │
│  └───────────────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
                           │
                           │ HTTPS
                           ▼
        ┌──────────────────────────────────┐
        │  Authorization Server (AS)       │
        │  - /authorize                    │
        │  - /token                        │
        │  - /revoke                       │
        │  - /.well-known/...              │
        └──────────────────────────────────┘
```

### 2.2 Flujo Completo

#### Paso 1: Inicio del Flujo
**Archivo**: `src/main/ipc/oauthHandlers.ts`

```typescript
// El renderer detecta 401 Unauthorized y dispara
ipcMain.handle('levante/oauth/authorize', handleAuthorize);

// Parámetros de entrada:
{
  serverId: string;              // ID único del servidor MCP
  mcpServerUrl: string;          // URL del servidor MCP
  scopes?: string[];             // Scopes solicitados
  clientId?: string;             // Opcional: client_id conocido
  wwwAuthHeader?: string;        // WWW-Authenticate: Bearer realm="..."
}
```

#### Paso 2: Discovery del Authorization Server
**Archivo**: `src/main/services/oauth/OAuthDiscoveryService.ts`

1. **Parse WWW-Authenticate header**: Extrae `as_uri`, `resource_metadata`, `scope`
2. **Descubrimiento por prioridades**:
   - Prioridad 1: Usar `as_uri` del header
   - Prioridad 2: Usar `resource_metadata`
   - Prioridad 3: RFC 9728 - `/.well-known/oauth-protected-resource`
   - Prioridad 4: Fallback - origin del MCP URL

3. **Fetch Authorization Server Metadata** (RFC 8414):
   ```
   GET https://auth-server/.well-known/oauth-authorization-server
   ```

#### Paso 3: Puerto Fijo para Callback
**Archivo**: `src/main/services/oauth/OAuthRedirectServer.ts`

```typescript
// Constantes en src/main/services/oauth/constants.ts
OAUTH_LOOPBACK_PORT = 31337;
OAUTH_LOOPBACK_HOST = '127.0.0.1';
OAUTH_REDIRECT_URI = 'http://127.0.0.1:31337/callback';
OAUTH_CALLBACK_TIMEOUT = 5 * 60 * 1000; // 5 minutos
```

#### Paso 4: Client Credentials (DCR o existentes)
**Archivo**: `src/main/services/oauth/OAuthService.ts`

- Si existen credenciales válidas: usarlas
- Si client_secret está por expirar: intentar renovar via `registration_client_uri`
- Si no hay credenciales: Dynamic Client Registration (RFC 7591)

#### Paso 5: Generación PKCE
**Archivo**: `src/main/services/oauth/OAuthFlowManager.ts`

```typescript
generatePKCE(): PKCEParams {
  // Code Verifier: 32 bytes aleatorios = 43 chars en base64url
  const verifier = crypto.randomBytes(32).toString('base64url');

  // Code Challenge: BASE64URL(SHA256(verifier))
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');

  return { verifier, challenge, method: 'S256' };
}
```

#### Paso 6: State Management (CSRF Protection)
**Archivo**: `src/main/services/oauth/OAuthStateManager.ts`

```typescript
// State: 16 bytes = 32 chars hex (128 bits entropía)
const state = crypto.randomBytes(16).toString('hex');

// Almacenamiento temporal (5 minutos)
stateManager.storeState(state, serverId, codeVerifier, redirectUri);

// Validación one-time use en callback
const stored = stateManager.validateAndRetrieveState(state);
```

#### Paso 7: Abrir Navegador
**Archivo**: `src/main/services/oauth/OAuthFlowManager.ts`

```typescript
const authUrl = new URL(metadata.authorization_endpoint);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', 'http://127.0.0.1:31337/callback');
authUrl.searchParams.set('scope', scopes.join(' '));
authUrl.searchParams.set('state', state);
authUrl.searchParams.set('code_challenge', challenge);
authUrl.searchParams.set('code_challenge_method', 'S256');
authUrl.searchParams.set('resource', mcpServerUrl);  // RFC 8707

await shell.openExternal(authUrl.toString());
```

#### Paso 8: Callback HTTP
**Archivo**: `src/main/services/oauth/OAuthRedirectServer.ts`

```
GET http://127.0.0.1:31337/callback?code=AUTH_CODE&state=STATE&iss=ISSUER
```

Validaciones:
- Path exacto `/callback`
- Parámetros `code` y `state` presentes
- State válido (CSRF check)

#### Paso 9: Token Exchange
**Archivo**: `src/main/services/oauth/OAuthFlowManager.ts`

```typescript
const body = new URLSearchParams({
  grant_type: 'authorization_code',
  code: authorizationCode,
  redirect_uri: 'http://127.0.0.1:31337/callback',
  code_verifier: verifier,  // PKCE
});

// Autenticación del cliente según método soportado
// - client_secret_basic: Authorization header
// - client_secret_post: Body params
// - none: Solo client_id (public client)

const response = await fetch(metadata.token_endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: body.toString(),
});
```

#### Paso 10: Almacenamiento de Tokens
**Archivo**: `src/main/services/oauth/OAuthTokenStore.ts`

```typescript
// Encriptación con electron.safeStorage
const encrypted = safeStorage.encryptString(accessToken);
const base64 = encrypted.toString('base64');

// Guardar con prefijo ENCRYPTED:
const stored: StoredOAuthTokens = {
  accessToken: `ENCRYPTED:${base64}`,
  refreshToken: refreshToken ? `ENCRYPTED:${...}` : undefined,
  expiresAt: tokens.expiresAt,
  tokenType: 'Bearer',
  scope: tokens.scope,
};

await preferencesService.set(`oauthTokens.${serverId}`, stored);
```

### 2.3 Implementación PKCE

OAuth 2.1 requiere PKCE obligatorio. Levante implementa S256:

| Componente | Especificación |
|------------|----------------|
| **Verifier** | 32 bytes random = 43 chars base64url |
| **Challenge** | SHA-256(verifier) en base64url |
| **Method** | Siempre 'S256' (plain prohibido en OAuth 2.1) |

### 2.4 Dynamic Client Registration

**Archivo**: `src/main/services/oauth/OAuthDiscoveryService.ts`

#### Request (RFC 7591):
```typescript
{
  client_name: 'Levante',
  client_uri: 'https://github.com/levante-hub/levante',
  application_type: 'native',
  redirect_uris: ['http://127.0.0.1:31337/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',  // Public client PKCE
}
```

#### Response:
```typescript
{
  client_id: string;
  client_secret?: string;
  client_secret_expires_at?: number;      // 0 = nunca expira
  registration_access_token?: string;     // Para renovar
  registration_client_uri?: string;       // Para actualizar
}
```

### 2.5 Token Management

#### Auto-Refresh
**Archivo**: `src/main/services/oauth/OAuthHttpClient.ts`

```typescript
async ensureValidToken(serverId: string): Promise<OAuthTokens> {
  let tokens = await this.tokenStore.getTokens(serverId);

  // Validación con 60s buffer
  if (this.tokenStore.isTokenExpired(tokens)) {
    tokens = await this.refreshToken(serverId, tokens);
  }

  return tokens;
}
```

#### Token Revocation (RFC 7009)
**Archivo**: `src/main/services/oauth/OAuthService.ts`

Al desconectar un servidor MCP:
1. Revoca refresh_token (invalida también access_token)
2. Revoca access_token
3. Elimina tokens locales
4. Limpia configuración OAuth

### 2.6 Almacenamiento de Credenciales

**Ubicación**: `~/levante/ui-preferences.json`

```json
{
  "oauthTokens": {
    "{serverId}": {
      "accessToken": "ENCRYPTED:{base64}",
      "refreshToken": "ENCRYPTED:{base64}",
      "expiresAt": 1704067200000,
      "tokenType": "Bearer",
      "scope": "mcp:read mcp:write"
    }
  },
  "mcpServers": {
    "{serverId}": {
      "oauth": {
        "enabled": true,
        "authServerId": "https://auth.example.com",
        "clientCredentials": {
          "clientId": "client-id",
          "clientSecret": "ENCRYPTED:{base64}",
          "registrationMetadata": {
            "client_secret_expires_at": 0,
            "registration_access_token": "ENCRYPTED:{base64}"
          }
        }
      }
    }
  }
}
```

---

## 3. OAuth para OpenRouter

### 3.1 Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                    RENDERER (React/TypeScript)                   │
├─────────────────────────────────────────────────────────────────┤
│  useOpenRouterOAuth Hook → ProviderConfigs Component            │
│  (src/renderer/hooks/useOpenRouterOAuth.ts)                     │
└──────────────────────┬──────────────────────────────────────────┘
                       │ IPC
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MAIN PROCESS (Node.js)                       │
├─────────────────────────────────────────────────────────────────┤
│  ipcMain Handlers                                               │
│         ├─ levante/oauth/start-server                           │
│         └─ levante/oauth/stop-server                            │
│                                                                 │
│  OAuthCallbackServer (src/main/services/oauthCallbackServer.ts) │
│         └─ HTTP callback receiver (localhost:3000)              │
│                                                                 │
│  ModelFetchService                                              │
│         └─ fetchOpenRouterModels(apiKey?)                       │
└─────────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                     OPENROUTER SERVERS                          │
├─────────────────────────────────────────────────────────────────┤
│  Authorization: https://openrouter.ai/auth                      │
│  Token Exchange: POST /api/v1/auth/keys                         │
│  Models API: GET /api/v1/models                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Flujo Completo

#### Paso 1: Iniciar Flujo OAuth
**Archivo**: `src/renderer/hooks/useOpenRouterOAuth.ts`

```typescript
const initiateOAuthFlow = async () => {
  // 1. Inicia servidor callback local
  const serverResult = await window.levante.oauth.startServer();
  // { success: true, port: 3000, callbackUrl: "http://localhost:3000" }

  // 2. Genera PKCE
  const codeVerifier = generateCodeVerifier();  // 32 bytes random, base64url
  const codeChallenge = await generateCodeChallenge(codeVerifier);  // SHA-256

  // 3. Almacena verifier temporalmente
  sessionStorage.setItem('openrouter_code_verifier', codeVerifier);

  // 4. Construye URL de autorización
  const authUrl = new URL('https://openrouter.ai/auth');
  authUrl.searchParams.set('callback_url', 'http://localhost:3000');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  // 5. Abre navegador
  await window.levante.openExternal(authUrl.toString());
};
```

#### Paso 2: Servidor Callback Recibe Código
**Archivo**: `src/main/services/oauthCallbackServer.ts`

```typescript
async start(): Promise<{ port: number; callbackUrl: string }> {
  // Puerto 3000 preferido (recomendado por OpenRouter)
  this.server = createServer((req, res) => {
    const url = new URL(req.url || '', `http://localhost:${this.port}`);

    if (url.pathname === '/callback' || url.pathname === '/') {
      const code = url.searchParams.get('code');

      if (code) {
        mainWindow.webContents.send('levante/oauth/callback', {
          success: true,
          provider: 'openrouter',
          code: code
        });
      }
    }
  });
}
```

#### Paso 3: Intercambio de Código por API Key
**Archivo**: `src/renderer/hooks/useOpenRouterOAuth.ts`

```typescript
const exchangeCodeForApiKey = async (code: string) => {
  const codeVerifier = sessionStorage.getItem('openrouter_code_verifier');

  const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: codeVerifier,
      code_challenge_method: 'S256'
    })
  });

  const data = await response.json();
  const newApiKey = data.key;  // "sk_live_..."

  onSuccess(newApiKey);
};
```

#### Paso 4: Almacenamiento del API Key
**Archivo**: `src/main/services/preferencesService.ts`

```typescript
// El API key se guarda en el array de providers
{
  providers: [{
    id: "openrouter",
    apiKey: "ENCRYPTED:{base64}",  // Encriptado con safeStorage
    models: [...]
  }]
}
```

### 3.3 Endpoints Utilizados

| Endpoint | Método | Propósito | Auth | Respuesta |
|----------|--------|-----------|------|-----------|
| `https://openrouter.ai/auth` | GET | Autorización OAuth | Browser | Redirect con code |
| `/api/v1/auth/keys` | POST | Code → API key | PKCE | `{ key: "sk_live_..." }` |
| `/api/v1/auth/key` | GET | Validar API key | Bearer | Metadata |
| `/api/v1/models` | GET | Listar modelos | Bearer (opcional) | Array modelos |
| `/api/v1` | POST | Inferencia | Bearer | Stream/Response |

### 3.4 Almacenamiento de API Keys

**Ubicación**: `~/levante/ui-preferences.json`

```json
{
  "providers": [
    {
      "id": "openrouter",
      "name": "OpenRouter",
      "apiKey": "ENCRYPTED:AgEhNjpQU...",
      "models": [...],
      "selectedModelIds": ["openai/gpt-4", "anthropic/claude-3"],
      "isActive": true
    }
  ]
}
```

**Encriptación**:
- Usa `electron.safeStorage` (Keychain/DPAPI/libsecret)
- Prefijo `ENCRYPTED:` para identificar valores encriptados
- Toggle en settings: `security.encryptApiKeys`

---

## 4. Comparación de Flujos

| Aspecto | OAuth MCP | OAuth OpenRouter |
|---------|-----------|------------------|
| **Propósito** | Auth server-to-server | Obtener API key |
| **Estándar** | OAuth 2.1 completo | OAuth 2.1 simplificado |
| **PKCE** | Obligatorio (S256) | Obligatorio (S256) |
| **Puerto callback** | 31337 (fijo) | 3000 (preferido) |
| **DCR** | Sí (RFC 7591) | No requerido |
| **Token refresh** | Automático | N/A (API key permanente) |
| **Token revocation** | Sí (RFC 7009) | N/A |
| **Discovery** | RFC 9728, RFC 8414 | N/A (endpoints fijos) |
| **Almacenamiento** | oauthTokens.{serverId} | providers[].apiKey |
| **Client credentials** | Dinámicas (registradas) | N/A |
| **Expiración secret** | Manejada | N/A |

---

## 5. Archivos Principales

### OAuth MCP

| Archivo | Responsabilidad |
|---------|-----------------|
| `src/main/services/oauth/OAuthService.ts` | Orquestador principal |
| `src/main/services/oauth/OAuthFlowManager.ts` | PKCE, token exchange, refresh, revoke |
| `src/main/services/oauth/OAuthDiscoveryService.ts` | Discovery, DCR |
| `src/main/services/oauth/OAuthTokenStore.ts` | Almacenamiento encriptado |
| `src/main/services/oauth/OAuthHttpClient.ts` | Auto-refresh, manejo 401 |
| `src/main/services/oauth/OAuthRedirectServer.ts` | Servidor loopback :31337 |
| `src/main/services/oauth/OAuthStateManager.ts` | CSRF state management |
| `src/main/ipc/oauthHandlers.ts` | IPC handlers |
| `src/renderer/stores/oauthStore.ts` | Zustand store UI |

### OAuth OpenRouter

| Archivo | Responsabilidad |
|---------|-----------------|
| `src/renderer/hooks/useOpenRouterOAuth.ts` | Hook React para flujo OAuth |
| `src/main/services/oauthCallbackServer.ts` | Servidor callback :3000 |
| `src/main/ipc/oauthHandlers.ts` | IPC handlers start/stop server |
| `src/main/services/modelFetchService.ts` | Fetch modelos con API key |
| `src/main/services/apiValidation/providers/openrouter.ts` | Validación API key |
| `src/renderer/stores/modelStore.ts` | Estado modelos/proveedores |

---

## 6. Interfaces TypeScript

### OAuth MCP

```typescript
// src/main/services/oauth/types.ts

interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;      // milliseconds
  tokenType: 'Bearer';
  scope?: string;
}

interface PKCEParams {
  verifier: string;       // 43-128 chars, base64url
  challenge: string;      // SHA-256(verifier)
  method: 'S256';
}

interface OAuthClientCredentials {
  clientId: string;
  clientSecret?: string;
  registeredAt: number;
  authServerId: string;
  tokenEndpointAuthMethod?: 'none' | 'client_secret_post' | 'client_secret_basic';
  registrationMetadata?: {
    client_secret_expires_at?: number;
    registration_access_token?: string;
    registration_client_uri?: string;
  };
}

interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  code_challenge_methods_supported: string[];
  // ... más campos RFC 8414
}
```

### OAuth OpenRouter / Modelos

```typescript
// src/types/models.ts

interface Model {
  id: string;
  name: string;
  provider: string;
  contextLength: number;
  pricing?: { input: number; output: number };
  capabilities: string[];
  isAvailable: boolean;
}

interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  apiKey?: string;           // Encriptable
  models: Model[];
  selectedModelIds?: string[];
  isActive: boolean;
  modelSource: 'dynamic' | 'user-defined';
}
```

---

## 7. Seguridad

### Protecciones Comunes

| Protección | OAuth MCP | OpenRouter |
|------------|-----------|------------|
| **PKCE S256** | ✓ | ✓ |
| **State param (CSRF)** | ✓ | - |
| **Loopback redirect** | ✓ (127.0.0.1:31337) | ✓ (localhost:3000) |
| **Encriptación safeStorage** | ✓ | ✓ |
| **HTTPS obligatorio** | ✓ (excepto localhost) | ✓ |

### Encriptación

Ambos flujos usan `electron.safeStorage` para encriptar credenciales:

| Plataforma | Backend |
|------------|---------|
| macOS | Keychain |
| Windows | DPAPI |
| Linux | libsecret |

### Almacenamiento Seguro

```
~/levante/
├── ui-preferences.json
│   ├── oauthTokens.{serverId}     → Tokens MCP (encriptados)
│   ├── mcpServers.{serverId}.oauth → Config OAuth MCP (secrets encriptados)
│   └── providers[].apiKey          → API keys proveedores (encriptados)
└── .config-version
```

### Principios de Seguridad

1. **Separación de procesos**: Credenciales solo en main process
2. **IPC seguro**: Renderer solicita operaciones, no accede a secrets
3. **One-time use**: State params se invalidan después de uso
4. **Buffer de expiración**: 60s para tokens, 5min para client_secret
5. **Cleanup al desconectar**: Revocación + eliminación local

---

## Diagrama de Flujo Completo

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           OAUTH MCP FLOW                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [User] → Conectar MCP Server protegido                                │
│           ↓                                                             │
│  [App] → Detecta 401 + WWW-Authenticate                                │
│           ↓                                                             │
│  [Discovery] → Fetch /.well-known/oauth-authorization-server           │
│           ↓                                                             │
│  [DCR] → POST /register (si no hay client credentials)                 │
│           ↓                                                             │
│  [PKCE] → Generate verifier + challenge (S256)                         │
│           ↓                                                             │
│  [Browser] → Open authorization_endpoint + params                      │
│           ↓                                                             │
│  [User] → Autoriza en navegador                                        │
│           ↓                                                             │
│  [Callback] → Recibe code en :31337/callback                           │
│           ↓                                                             │
│  [Token] → POST /token con code + verifier                             │
│           ↓                                                             │
│  [Store] → Encriptar + guardar access_token, refresh_token             │
│           ↓                                                             │
│  [Use] → Bearer auth en requests a MCP Server                          │
│           ↓                                                             │
│  [Refresh] → Auto-refresh cuando token expira                          │
│           ↓                                                             │
│  [Disconnect] → Revoke tokens + cleanup local                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                        OAUTH OPENROUTER FLOW                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [User] → Click "Login with OpenRouter"                                │
│           ↓                                                             │
│  [Server] → Start callback server en :3000                             │
│           ↓                                                             │
│  [PKCE] → Generate verifier + challenge (S256)                         │
│           ↓                                                             │
│  [Browser] → Open openrouter.ai/auth + params                          │
│           ↓                                                             │
│  [User] → Login + autoriza en OpenRouter                               │
│           ↓                                                             │
│  [Callback] → Recibe code en :3000                                     │
│           ↓                                                             │
│  [Exchange] → POST /api/v1/auth/keys → API key                         │
│           ↓                                                             │
│  [Store] → Encriptar + guardar API key en providers                    │
│           ↓                                                             │
│  [Use] → Bearer auth en /api/v1/models, /api/v1                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

*Documentación generada: Febrero 2026*
*Basada en análisis del código fuente de Levante*
