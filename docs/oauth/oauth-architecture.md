# Arquitectura OAuth 2.1 en Levante

> Documentación técnica completa del sistema OAuth implementado en Levante

## Tabla de Contenidos

1. [Visión General](#visión-general)
2. [Arquitectura General](#arquitectura-general)
3. [Flujos OAuth](#flujos-oauth)
4. [Servicios Principales](#servicios-principales)
5. [IPC Handlers](#ipc-handlers)
6. [Estado y Almacenamiento](#estado-y-almacenamiento)
7. [Servidor de Callback](#servidor-de-callback)
8. [Discovery Process](#discovery-process)
9. [HTTP Client Auto-Refresh](#http-client-auto-refresh)
10. [Integración con Renderer](#integración-con-renderer)
11. [Características Avanzadas](#características-avanzadas)

---

## Visión General

### Casos de Uso

El sistema OAuth en Levante soporta dos casos de uso principales:

1. **OAuth para MCP Servers**: Autenticación con servidores MCP que requieren OAuth 2.1
2. **OAuth para OpenRouter**: Autenticación con el servicio OpenRouter para acceso a modelos de IA

### Estándares Implementados

- **RFC 6749**: OAuth 2.0 Authorization Framework
- **RFC 7636**: Proof Key for Code Exchange (PKCE)
- **RFC 8414**: OAuth 2.0 Authorization Server Metadata
- **RFC 9728**: OAuth 2.0 Protected Resource Metadata
- **RFC 7591**: OAuth 2.0 Dynamic Client Registration (DCR)
- **RFC 7009**: OAuth 2.0 Token Revocation
- **RFC 8707**: Resource Indicators for OAuth 2.0
- **RFC 6750**: Bearer Token Usage

### Características Principales

- ✅ OAuth 2.1 con PKCE obligatorio (S256)
- ✅ Dynamic Client Registration automático
- ✅ Token Revocation en desconexión
- ✅ Protected Resource Discovery automático
- ✅ Auto-refresh de tokens con clock skew tolerance
- ✅ Manejo automático de respuestas 401
- ✅ Encriptación de tokens con electron.safeStorage
- ✅ Cache de metadata con TTL de 1 hora
- ✅ Soporte multi-AS (múltiples Authorization Servers)
- ✅ Loopback server seguro (127.0.0.1)
- ✅ State validation (anti-CSRF)

---

## Arquitectura General

### Diagrama de Capas

```
┌─────────────────────────────────────────────────────────────┐
│                    RENDERER PROCESS (UI)                     │
│  - oauthStore.ts (Zustand)                                  │
│  - IPC calls via window.levante.oauth.*                     │
└─────────────────────────────────────────────────────────────┘
                           ↕ IPC
┌─────────────────────────────────────────────────────────────┐
│                  MAIN PROCESS - IPC Layer                    │
│  - oauthHandlers.ts (IPC handlers)                          │
│    * levante/oauth/authorize                                 │
│    * levante/oauth/disconnect                                │
│    * levante/oauth/status                                    │
│    * levante/oauth/refresh                                   │
│    * levante/oauth/list                                      │
│    * levante/oauth/start-server (OpenRouter)                │
│    * levante/oauth/stop-server (OpenRouter)                 │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│              MAIN PROCESS - Service Orchestrator             │
│  - OAuthService (High-level orchestrator)                   │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│             MAIN PROCESS - Core Services Layer               │
│  ┌─────────────────────┬──────────────────────────────────┐ │
│  │ OAuthDiscoveryService│  OAuthFlowManager               │ │
│  │ - RFC 9728          │  - PKCE generation               │ │
│  │ - RFC 8414          │  - Authorization flow            │ │
│  │ - RFC 7591 (DCR)    │  - Token exchange                │ │
│  └─────────────────────┴──────────────────────────────────┘ │
│  ┌─────────────────────┬──────────────────────────────────┐ │
│  │ OAuthTokenStore     │  OAuthHttpClient                 │ │
│  │ - Token encryption  │  - Auto-refresh                  │ │
│  │ - Secure storage    │  - 401 handling                  │ │
│  └─────────────────────┴──────────────────────────────────┘ │
│  ┌─────────────────────┬──────────────────────────────────┐ │
│  │OAuthRedirectServer  │  OAuthStateManager               │ │
│  │ - Loopback server   │  - State validation              │ │
│  │ - Callback handling │  - CSRF prevention               │ │
│  └─────────────────────┴──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                  Storage & External APIs                     │
│  - PreferencesService (config storage)                      │
│  - electron.safeStorage (token encryption)                  │
│  - External Authorization Servers                           │
└─────────────────────────────────────────────────────────────┘
```

### Módulos y Ubicaciones

| Módulo | Ubicación | Propósito |
|--------|-----------|-----------|
| OAuthService | `/src/main/services/oauth/OAuthService.ts` | Orchestrador principal |
| OAuthDiscoveryService | `/src/main/services/oauth/OAuthDiscoveryService.ts` | Discovery y DCR |
| OAuthFlowManager | `/src/main/services/oauth/OAuthFlowManager.ts` | Flujo PKCE y tokens |
| OAuthTokenStore | `/src/main/services/oauth/OAuthTokenStore.ts` | Almacenamiento seguro |
| OAuthHttpClient | `/src/main/services/oauth/OAuthHttpClient.ts` | Auto-refresh y 401 |
| OAuthRedirectServer | `/src/main/services/oauth/OAuthRedirectServer.ts` | Loopback callback |
| OAuthStateManager | `/src/main/services/oauth/OAuthStateManager.ts` | State validation |
| oauthCallbackServer | `/src/main/services/oauthCallbackServer.ts` | OpenRouter callback |
| oauthHandlers | `/src/main/ipc/oauthHandlers.ts` | IPC handlers |
| oauthStore | `/src/renderer/stores/oauthStore.ts` | UI state (Zustand) |

---

## Flujos OAuth

### Flujo Completo de Autorización (MCP Servers)

El flujo implementado en `OAuthService.authorize()` sigue 6 pasos principales:

```
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: Discovery (OAuthDiscoveryService)                       │
│ ─────────────────────────────────────────────────────────────── │
│ Input: mcpServerUrl, wwwAuthHeader (opcional)                   │
│                                                                  │
│ 1.1. Parse WWW-Authenticate header (si existe)                  │
│      → Extrae: as_uri, resource_metadata, realm, error          │
│                                                                  │
│ 1.2. Determinar Authorization Server URL:                       │
│      a) Si as_uri existe → usar directamente (RFC 6750)         │
│      b) Si resource_metadata existe → fetch y extraer AS        │
│      c) Fallback: GET /.well-known/oauth-protected-resource     │
│         (RFC 9728 - Protected Resource Metadata)                │
│      d) Último fallback: AS well-known en origin                │
│                                                                  │
│ 1.3. Fetch Authorization Server Metadata:                       │
│      GET /.well-known/oauth-authorization-server (RFC 8414)     │
│      → Valida: issuer, endpoints, PKCE support (S256)           │
│                                                                  │
│ Output: AuthorizationServerMetadata + authServerId              │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: Pre-allocate Redirect Server Port                       │
│ ─────────────────────────────────────────────────────────────── │
│ - Start OAuthRedirectServer (loopback HTTP server)              │
│ - Port: Random available (default: 0)                           │
│ - Hostname: 127.0.0.1                                            │
│ - Path: /callback                                                │
│ - Timeout: 5 minutes                                             │
│                                                                  │
│ Output: redirectUri = "http://127.0.0.1:<port>/callback"        │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: Dynamic Client Registration (DCR) - RFC 7591            │
│ ─────────────────────────────────────────────────────────────── │
│ IF no clientId provided:                                         │
│                                                                  │
│ 3.1. Check if AS supports DCR:                                   │
│      → metadata.registration_endpoint exists?                   │
│                                                                  │
│ 3.2. POST to registration_endpoint:                             │
│      Body: {                                                     │
│        client_name: "Levante",                                   │
│        client_uri: "https://github.com/levante-hub/levante",    │
│        redirect_uris: [redirectUri],  // Pre-allocated port     │
│        grant_types: ["authorization_code", "refresh_token"],    │
│        response_types: ["code"],                                 │
│        token_endpoint_auth_method: "none", // Public client     │
│        scope: "mcp:read mcp:write"                               │
│      }                                                           │
│                                                                  │
│ 3.3. Response: { client_id, client_secret?, ... }               │
│      → Save credentials (encrypted) to preferences              │
│                                                                  │
│ IF registration not supported or fails:                          │
│      → Return error (manual configuration required)              │
│                                                                  │
│ Output: clientId, clientSecret (optional)                        │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 4: Authorization Flow (OAuthFlowManager)                    │
│ ─────────────────────────────────────────────────────────────── │
│ 4.1. Generate PKCE:                                              │
│      verifier = randomBytes(32).toString('base64url')           │
│      challenge = SHA256(verifier).toString('base64url')         │
│                                                                  │
│ 4.2. Generate state (anti-CSRF):                                │
│      state = randomBytes(16).toString('hex')                    │
│      → Store in OAuthStateManager (5 min TTL)                   │
│                                                                  │
│ 4.3. Build Authorization URL:                                   │
│      <authorization_endpoint>?                                   │
│        response_type=code&                                       │
│        client_id=<clientId>&                                     │
│        redirect_uri=<redirectUri>&                               │
│        scope=<scopes>&                                           │
│        state=<state>&                                            │
│        code_challenge=<challenge>&                               │
│        code_challenge_method=S256&                               │
│        resource=<mcpServerUrl>  // RFC 8707                      │
│                                                                  │
│ 4.4. Open browser: shell.openExternal(authUrl)                  │
│                                                                  │
│ 4.5. Wait for callback on redirect server:                      │
│      → Receives: ?code=...&state=...                             │
│      → Validates state matches stored                            │
│      → Displays success/error HTML page                          │
│                                                                  │
│ 4.6. Stop redirect server                                        │
│                                                                  │
│ Output: { code, verifier, redirectUri }                          │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 5: Token Exchange (OAuthFlowManager)                        │
│ ─────────────────────────────────────────────────────────────── │
│ POST to token_endpoint:                                          │
│   Headers: Content-Type: application/x-www-form-urlencoded      │
│   Body:                                                          │
│     grant_type=authorization_code                                │
│     code=<auth_code>                                             │
│     redirect_uri=<redirectUri>  // Must match exactly            │
│     client_id=<clientId>                                         │
│     code_verifier=<verifier>  // PKCE                            │
│     client_secret=<secret>  // Only if confidential client       │
│                                                                  │
│ Response: {                                                      │
│   access_token: "...",                                           │
│   refresh_token: "...",  // Optional                             │
│   expires_in: 3600,                                              │
│   token_type: "Bearer",                                          │
│   scope: "..."                                                   │
│ }                                                                │
│                                                                  │
│ Calculate expiresAt = Date.now() + expires_in * 1000            │
│                                                                  │
│ Output: OAuthTokens                                              │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 6: Save Tokens & Config                                    │
│ ─────────────────────────────────────────────────────────────── │
│ 6.1. Save tokens (OAuthTokenStore):                             │
│      → Encrypt accessToken using electron.safeStorage           │
│      → Encrypt refreshToken (if exists)                         │
│      → Store at: oauthTokens.<serverId>                         │
│      Format: "ENCRYPTED:<base64(encrypted_data)>"               │
│                                                                  │
│ 6.2. Save OAuth config (PreferencesService):                    │
│      mcpServers.<serverId>.oauth = {                            │
│        enabled: true,                                            │
│        authServerId: "<authServerId>",                           │
│        clientId: "<clientId>",                                   │
│        clientSecret: "<encrypted_secret>",  // If exists         │
│        scopes: ["mcp:read", "mcp:write"],                       │
│        redirectUri: "<redirectUri>"                              │
│      }                                                           │
│                                                                  │
│ Output: Success with tokens and metadata                         │
└─────────────────────────────────────────────────────────────────┘
```

### Flujo de Refresh de Token

```
┌─────────────────────────────────────────────────────────────────┐
│ Token Refresh Flow (Automatic)                                  │
│ ─────────────────────────────────────────────────────────────── │
│ Triggered when:                                                  │
│   - ensureValidToken() detects expired token                    │
│   - handleUnauthorized() receives 401                            │
│   - Manual refresh via IPC                                       │
│                                                                  │
│ 1. Get stored tokens (decrypt)                                   │
│ 2. Verify refresh token exists                                   │
│ 3. Get OAuth config from preferences                             │
│ 4. Fetch AS metadata (cached)                                    │
│                                                                  │
│ 5. POST to token_endpoint:                                       │
│    Body:                                                         │
│      grant_type=refresh_token                                    │
│      refresh_token=<refresh_token>                               │
│      client_id=<clientId>                                        │
│      client_secret=<secret>  // If exists                        │
│                                                                  │
│ 6. Response: new access_token (+ optional new refresh_token)    │
│ 7. Update stored tokens (encrypted)                              │
│ 8. Return new tokens                                             │
│                                                                  │
│ On failure:                                                      │
│   → Delete invalid tokens                                        │
│   → Throw error requiring re-authorization                       │
└─────────────────────────────────────────────────────────────────┘
```

### Flujo de Desconexión con Revocación

```
┌─────────────────────────────────────────────────────────────────┐
│ Disconnect Flow (OAuthService.disconnect)                       │
│ ─────────────────────────────────────────────────────────────── │
│ Input: serverId, revokeTokens (default: true)                   │
│                                                                  │
│ IF revokeTokens = true:                                          │
│   1. Get stored tokens                                           │
│   2. Get OAuth config (for authServerId)                         │
│   3. Fetch AS metadata                                           │
│   4. Check if AS supports revocation:                            │
│      → metadata.revocation_endpoint exists?                      │
│                                                                  │
│   5. IF supported:                                               │
│      5a. Revoke refresh_token (RFC 7009):                        │
│          POST revocation_endpoint:                               │
│            token=<refresh_token>                                 │
│            token_type_hint=refresh_token                         │
│            client_id=<clientId>                                  │
│            client_secret=<secret>  // If exists                  │
│                                                                  │
│      5b. Revoke access_token:                                    │
│          POST revocation_endpoint:                               │
│            token=<access_token>                                  │
│            token_type_hint=access_token                          │
│            client_id=<clientId>                                  │
│            client_secret=<secret>                                │
│                                                                  │
│   6. On revocation error: Log but continue                       │
│                                                                  │
│ 7. Delete tokens from storage (always)                           │
│ 8. Remove OAuth config from preferences                          │
│                                                                  │
│ Output: Success                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Servicios Principales

### 1. OAuthService (Orchestrador)

**Ubicación**: `/src/main/services/oauth/OAuthService.ts`

**Propósito**: Orquestador de alto nivel que coordina todos los servicios OAuth.

**Dependencias**:
- `OAuthDiscoveryService`: Discovery de AS y metadata
- `OAuthFlowManager`: Flujo de autorización y token exchange
- `OAuthTokenStore`: Almacenamiento seguro de tokens
- `OAuthHttpClient`: Cliente HTTP con auto-refresh
- `PreferencesService`: Almacenamiento de configuración

**Métodos Principales**:

```typescript
async authorize(params: AuthorizeParams): Promise<AuthorizeResult>
```
Ejecuta el flujo completo de autorización en 6 pasos:
- Discovery → DCR → Authorization → Token Exchange → Save
- Abre navegador para login del usuario
- Retorna tokens y metadata

```typescript
async getExistingToken(serverId: string): Promise<OAuthTokens | null>
```
Obtiene token existente sin forzar autorización. Auto-refresh si está expirado.

```typescript
async ensureValidToken(serverId: string): Promise<OAuthTokens>
```
Garantiza token válido o lanza error. Útil antes de hacer requests HTTP.

```typescript
async getAuthHeaders(serverId: string): Promise<Record<string, string>>
```
Retorna headers `Authorization: Bearer <token>` para HTTP requests.

```typescript
async handleUnauthorized(serverId, response): Promise<boolean>
```
Maneja respuestas 401, intenta refresh, retorna si retry es posible.

```typescript
async disconnect(params: DisconnectParams): Promise<void>
```
Desconexión con revocación opcional de tokens (RFC 7009).

```typescript
async hasValidConfig(serverId: string): Promise<boolean>
async hasValidTokens(serverId: string): Promise<boolean>
```
Verificaciones de estado de configuración y tokens.

---

### 2. OAuthDiscoveryService

**Ubicación**: `/src/main/services/oauth/OAuthDiscoveryService.ts`

**Propósito**: Implementar discovery automático de OAuth 2.1 según RFCs.

**Estándares**:
- RFC 9728: OAuth 2.0 Protected Resource Metadata
- RFC 8414: OAuth 2.0 Authorization Server Metadata
- RFC 7591: OAuth 2.0 Dynamic Client Registration
- RFC 6750: WWW-Authenticate header parsing

**Métodos Principales**:

```typescript
async discoverAuthServer(resourceUrl: string): Promise<ProtectedResourceMetadata>
```
RFC 9728: Descubre AS desde `/.well-known/oauth-protected-resource`

```typescript
async fetchServerMetadata(authServerUrl: string): Promise<AuthorizationServerMetadata>
```
RFC 8414: Fetch `/.well-known/oauth-authorization-server`
Valida: issuer, endpoints, PKCE support (S256)
Cache: 1 hora TTL

```typescript
parseWWWAuthenticate(header: string): WWWAuthenticateParams
```
RFC 6750: Parse Bearer challenges
Extrae: scheme, realm, as_uri, resource_metadata, error, scope

```typescript
async discoverFromUnauthorized(resourceUrl, wwwAuthHeader?): Promise<DiscoveryResult>
```
Flujo completo desde 401. Prioridades:
1. as_uri del header (directo)
2. resource_metadata del header
3. RFC 9728 discovery
4. Fallback a origin AS well-known

```typescript
async registerClient(registrationEndpoint, authServerId, redirectUris?): Promise<OAuthClientCredentials>
```
RFC 7591: Dynamic Client Registration
- Registra "Levante" como cliente automáticamente
- Soporta confidential clients (con client_secret)
- Guarda credentials encriptadas

**Cache Management**:
- Metadata de AS: TTL 1 hora
- Metadata de recursos: TTL 1 hora
- Auto-cleanup con setTimeout
- Métodos: `cleanExpiredCache()`, `clearCache()`, `getCacheStats()`

---

### 3. OAuthFlowManager

**Ubicación**: `/src/main/services/oauth/OAuthFlowManager.ts`

**Propósito**: Gestionar el flujo OAuth 2.1 con PKCE (RFC 7636).

**Dependencias**:
- `OAuthRedirectServer`: Servidor loopback para callback
- `OAuthStateManager`: Gestión de state parameters

**Métodos Principales**:

```typescript
generatePKCE(): PKCEParams
```
- verifier: randomBytes(32).toString('base64url') → 256 bits entropía
- challenge: SHA256(verifier).toString('base64url')
- method: 'S256'

```typescript
createAuthorizationUrl(params: AuthorizationUrlParams): string
```
Construye URL con parámetros OAuth 2.1:
- response_type=code
- client_id, redirect_uri, scope, state
- code_challenge, code_challenge_method=S256
- resource (RFC 8707)

```typescript
async authorize(params): Promise<{ code, verifier, redirectUri }>
```
Flujo completo:
1. Generate PKCE
2. Generate state
3. Start loopback server
4. Store state (5 min TTL)
5. Create authorization URL
6. Open browser
7. Wait for callback
8. Validate state
9. Return code + verifier

```typescript
async exchangeCodeForTokens(params: TokenExchangeParams): Promise<OAuthTokens>
```
POST token_endpoint con grant_type=authorization_code
Retorna: access_token, refresh_token, expires_in, scope

```typescript
async refreshAccessToken(params: TokenRefreshParams): Promise<OAuthTokens>
```
POST token_endpoint con grant_type=refresh_token
Maneja refresh_token rotation (usa nuevo si existe)

```typescript
async revokeToken(params: TokenRevocationParams): Promise<void>
```
RFC 7009: Token Revocation
POST revocation_endpoint con token y token_type_hint

---

### 4. OAuthTokenStore

**Ubicación**: `/src/main/services/oauth/OAuthTokenStore.ts`

**Propósito**: Gestión segura de tokens OAuth con encriptación.

**Encriptación**:
- Método: `electron.safeStorage` (Keychain/DPAPI/libsecret)
- Formato: `ENCRYPTED:<base64(encrypted_data)>`
- Campos encriptados: `accessToken`, `refreshToken`
- Campos en claro: `expiresAt`, `tokenType`, `scope`, `issuedAt`

**Métodos Principales**:

```typescript
async saveTokens(serverId: string, tokens: OAuthTokens): Promise<void>
```
Encripta y guarda tokens en `oauthTokens.<serverId>`

```typescript
async getTokens(serverId: string): Promise<OAuthTokens | null>
```
Fetch y desencripta tokens. Retorna null si no existe.

```typescript
async deleteTokens(serverId: string): Promise<void>
```
Elimina tokens del storage. Usado en disconnect y refresh fallido.

```typescript
isTokenExpired(tokens: OAuthTokens): boolean
```
Clock skew buffer: 60 segundos
Considera expirado si: `now >= (expiresAt - 60000)`

```typescript
async cleanExpiredTokens(): Promise<number>
```
Limpia tokens expirados sin refresh_token. Mantenimiento periódico.

```typescript
isEncryptionAvailable(): boolean
```
Verifica disponibilidad de safeStorage. Lanza error si no disponible.

---

### 5. OAuthHttpClient

**Ubicación**: `/src/main/services/oauth/OAuthHttpClient.ts`

**Propósito**: Cliente HTTP con auto-refresh de tokens OAuth.

**Dependencias**:
- `OAuthTokenStore`: Gestión de tokens
- `OAuthFlowManager`: Refresh de tokens
- `OAuthDiscoveryService`: Metadata de AS
- `PreferencesService`: Configuración OAuth

**Métodos Principales**:

```typescript
async ensureValidToken(serverId: string): Promise<OAuthTokens>
```
- Get current tokens
- Si expirados: auto-refresh
- Si no existen: lanza NO_TOKENS
- Retorna tokens válidos

```typescript
async getAuthHeaders(serverId: string): Promise<Record<string, string>>
```
Llama `ensureValidToken()` y retorna:
```typescript
{ Authorization: "Bearer <token>" }
```

```typescript
async handleUnauthorized(serverId, response): Promise<boolean>
```
- Parse WWW-Authenticate header
- Intenta refresh si hay refresh_token
- Retorna `true` si retry posible
- Retorna `false` si no hay refresh_token o falla

```typescript
async refreshToken(serverId, oldTokens?): Promise<OAuthTokens>
```
- Get OAuth config
- Fetch AS metadata
- Call `flowManager.refreshAccessToken()`
- Save new tokens
- On failure: delete tokens + lanza error

**Flujo de Auto-Refresh**:
```
HTTP Request → getAuthHeaders() → ensureValidToken()
→ isExpired? → YES → refreshToken() → POST token_endpoint
→ Save new tokens → Return headers
```

---

### 6. OAuthRedirectServer (MCP)

**Ubicación**: `/src/main/services/oauth/OAuthRedirectServer.ts`

**Propósito**: Servidor HTTP loopback (127.0.0.1) para recibir callback OAuth.

**Configuración**:
- **Hostname**: 127.0.0.1 (fijo)
- **Puerto**: Aleatorio disponible (default: 0)
- **Path**: /callback (fijo)
- **Timeout**: 5 minutos

**Métodos Principales**:

```typescript
async start(config?: LoopbackServerConfig): Promise<LoopbackServerResult>
```
- Encuentra puerto disponible
- Inicia servidor HTTP
- Configura timeout (5 min)
- Retorna: `{ port, redirectUri }`

```typescript
async waitForCallback(): Promise<AuthorizationCallback>
```
- Promise que se resuelve cuando llega callback
- Timeout de 5 minutos
- Retorna: `{ code, state }` o error

```typescript
async stop(): Promise<void>
```
Cierra servidor HTTP y limpia timeout.

**Páginas HTML**:
1. **Success**: Verde, checkmark, "Authorization Successful!"
2. **Error**: Rojo, cruz, mensaje de error detallado

**Seguridad**:
- Solo escucha en 127.0.0.1 (loopback)
- Timeout automático (5 min)
- Validación de state (anti-CSRF)
- Un solo callback permitido (one-time use)

---

### 7. OAuthStateManager

**Ubicación**: `/src/main/services/oauth/OAuthStateManager.ts`

**Propósito**: Gestión de state parameters para prevenir CSRF.

**Métodos Principales**:

```typescript
generateState(): string
```
- randomBytes(16).toString('hex')
- 128 bits de entropía (RFC 6749)

```typescript
storeState(state, serverId, codeVerifier, redirectUri, timeout = 5min): void
```
- Almacena en Map con expiración
- Auto-cleanup con setTimeout
- Asocia: serverId, codeVerifier, redirectUri

```typescript
validateAndRetrieveState(state: string): StoredState
```
- Valida existencia
- Valida no expirado
- Elimina después de validación (one-time use)
- Lanza: `INVALID_STATE` o `STATE_EXPIRED`

**Storage**:
- In-memory: `Map<state, StoredState>`
- TTL: 5 minutos (configurable)
- Auto-cleanup: setTimeout individual por state

---

### 8. oauthCallbackServer (OpenRouter)

**Ubicación**: `/src/main/services/oauthCallbackServer.ts`

**Propósito**: Servidor de callback específico para OAuth de OpenRouter.

**Configuración**:
- **Hostname**: localhost
- **Puerto Preferido**: 3000 (fallback a aleatorio)
- **Paths**: /callback y / (ambos aceptados)
- **Timeout**: Manual (5 segundos después de callback)

**Diferencias con OAuthRedirectServer**:
- Puerto preferido 3000 (recomendado por OpenRouter)
- Acepta múltiples paths (/, /callback)
- IPC events en lugar de Promise
- Auto-focus de ventana principal
- Delay antes de stop (5 seg vs inmediato)

**Métodos**:

```typescript
setMainWindow(window: BrowserWindow): void
```
Configura referencia a ventana principal.

```typescript
async start(): Promise<{ port, callbackUrl }>
```
- Intenta puerto 3000 primero
- Fallback a puerto aleatorio si 3000 ocupado
- Retorna: `{ port, callbackUrl: "http://localhost:<port>" }`

```typescript
async stop(): Promise<void>
```
Cierra servidor HTTP.

**IPC Event Format**:
```typescript
// Success
{ success: true, provider: 'openrouter', code: '...' }

// Error
{ success: false, error: '...' }
```

---

## IPC Handlers

### Ubicación

**Archivo**: `/src/main/ipc/oauthHandlers.ts`

### Handlers Registrados

```typescript
export function setupOAuthHandlers(): void {
  // MCP OAuth
  ipcMain.handle('levante/oauth/authorize', handleAuthorize);
  ipcMain.handle('levante/oauth/disconnect', handleDisconnect);
  ipcMain.handle('levante/oauth/status', handleStatus);
  ipcMain.handle('levante/oauth/refresh', handleRefresh);
  ipcMain.handle('levante/oauth/list', handleList);

  // OpenRouter OAuth
  ipcMain.handle('levante/oauth/start-server', handleStartServer);
  ipcMain.handle('levante/oauth/stop-server', handleStopServer);
}
```

### 1. levante/oauth/authorize

**Input**:
```typescript
{
  serverId: string;
  mcpServerUrl: string;
  scopes?: string[];
  clientId?: string;
  wwwAuthHeader?: string;
}
```

**Output**:
```typescript
{
  success: boolean;
  error?: string;
  tokens?: {
    expiresAt: number;
    scope: string;
  };
}
```

**Flujo**:
1. Initialize services (PreferencesService, OAuthService)
2. Call `oauthService.authorize(params)`
3. Return success/error

---

### 2. levante/oauth/disconnect

**Input**:
```typescript
{
  serverId: string;
  revokeTokens?: boolean;  // Default: true
}
```

**Output**:
```typescript
{
  success: boolean;
  error?: string;
}
```

**Flujo**:
1. Initialize services
2. Call `oauthService.disconnect({ serverId, revokeTokens })`
3. Revokes tokens en AS (si supported)
4. Deletes local tokens
5. Removes OAuth config

---

### 3. levante/oauth/status

**Input**:
```typescript
{
  serverId: string;
}
```

**Output**:
```typescript
{
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
}
```

**Flujo**:
1. Check `hasValidConfig()`
2. Check `hasValidTokens()`
3. Get token details (expiresAt)
4. Get OAuth config (scopes, authServerId)
5. Return aggregated status

---

### 4. levante/oauth/refresh

**Input**:
```typescript
{
  serverId: string;
}
```

**Output**:
```typescript
{
  success: boolean;
  error?: string;
  tokens?: {
    expiresAt: number;
    scope: string;
  };
}
```

**Flujo**:
1. Call `oauthService.ensureValidToken(serverId)`
2. Forces refresh si expired
3. Return new token info

---

### 5. levante/oauth/list

**Input**: (none)

**Output**:
```typescript
{
  success: boolean;
  data?: Array<{
    serverId: string;
    hasConfig: boolean;
    hasTokens: boolean;
    isTokenValid: boolean;
  }>;
  error?: string;
}
```

**Flujo**:
1. Get all mcpServers from preferences
2. Filter servers with `oauth.enabled = true`
3. For each: get status (config, tokens, validity)
4. Return array of server statuses

---

### 6. levante/oauth/start-server (OpenRouter)

**Input**: (none)

**Output**:
```typescript
{
  success: boolean;
  port?: number;
  callbackUrl?: string;
  error?: string;
}
```

**Flujo**:
1. Call `oauthCallbackServer.start()`
2. Tries port 3000, fallback to random
3. Return port and callback URL

---

### 7. levante/oauth/stop-server (OpenRouter)

**Input**: (none)

**Output**:
```typescript
{
  success: boolean;
  error?: string;
}
```

**Flujo**:
1. Call `oauthCallbackServer.stop()`
2. Closes HTTP server

---

## Estado y Almacenamiento

### PreferencesService Storage

**Ubicación**: `~/levante/ui-preferences.json`

**Estructura OAuth**:
```json
{
  "mcpServers": {
    "<serverId>": {
      "id": "server1",
      "transport": "http",
      "baseUrl": "https://mcp.example.com",
      "oauth": {
        "enabled": true,
        "authServerId": "https://auth.example.com",
        "clientId": "levante_abc123",
        "clientSecret": "ENCRYPTED:dGhpc2lzYXNlY3JldA==",
        "scopes": ["mcp:read", "mcp:write"],
        "redirectUri": "http://127.0.0.1:54321/callback",
        "clientCredentials": {
          "clientId": "levante_abc123",
          "clientSecret": "ENCRYPTED:...",
          "registeredAt": 1735000000000,
          "authServerId": "https://auth.example.com",
          "registrationMetadata": {
            "client_secret_expires_at": 0,
            "registration_access_token": "ENCRYPTED:...",
            "registration_client_uri": "https://auth.example.com/clients/123"
          }
        }
      }
    }
  },
  "oauthTokens": {
    "<serverId>": {
      "accessToken": "ENCRYPTED:YWNjZXNzX3Rva2VuX2hlcmU=",
      "refreshToken": "ENCRYPTED:cmVmcmVzaF90b2tlbl9oZXJl",
      "expiresAt": 1735003600000,
      "tokenType": "Bearer",
      "scope": "mcp:read mcp:write",
      "issuedAt": 1735000000000
    }
  }
}
```

### Encriptación con safeStorage

**Método**: `electron.safeStorage`
- **macOS**: Keychain
- **Windows**: DPAPI
- **Linux**: libsecret

**Proceso de Encriptación**:
```typescript
// Encrypt
const encrypted = safeStorage.encryptString(plaintext);
const base64 = encrypted.toString('base64');
const stored = `ENCRYPTED:${base64}`;

// Decrypt
const base64Data = stored.replace('ENCRYPTED:', '');
const buffer = Buffer.from(base64Data, 'base64');
const decrypted = safeStorage.decryptString(buffer);
```

**Campos Encriptados**:
1. `oauthTokens.<serverId>.accessToken`
2. `oauthTokens.<serverId>.refreshToken`
3. `mcpServers.<serverId>.oauth.clientSecret`
4. `mcpServers.<serverId>.oauth.clientCredentials.clientSecret`
5. `mcpServers.<serverId>.oauth.clientCredentials.registrationMetadata.registration_access_token`

### In-Memory State

**OAuthStateManager**:
```typescript
Map<state: string, StoredState> {
  "abc123def456": {
    serverId: "server1",
    codeVerifier: "dGhpc2lzY29kZXZlcmlmaWVy",
    expiresAt: 1735000300000,  // 5 min desde generación
    redirectUri: "http://127.0.0.1:54321/callback"
  }
}
```
- TTL: 5 minutos
- Auto-cleanup: setTimeout individual
- One-time use: Eliminado después de validación

**OAuthDiscoveryService Cache**:
```typescript
// Metadata Cache
Map<authServerUrl: string, CachedMetadata<AuthorizationServerMetadata>> {
  "https://auth.example.com": {
    data: { issuer, authorization_endpoint, ... },
    cachedAt: 1735000000000,
    expiresAt: 1735003600000  // 1 hora
  }
}

// Resource Cache
Map<resourceUrl: string, CachedMetadata<ProtectedResourceMetadata>> {
  "https://mcp.example.com": {
    data: { resource, authorization_servers: [...] },
    cachedAt: 1735000000000,
    expiresAt: 1735003600000  // 1 hora
  }
}
```
- TTL: 1 hora
- Auto-cleanup: setTimeout individual
- Métodos: `cleanExpiredCache()`, `clearCache()`

---

## Servidor de Callback

### OAuthRedirectServer Lifecycle

```
1. start() → Encuentra puerto libre → Inicia HTTP server
   → Retorna redirectUri

2. waitForCallback() → Promise espera hasta callback/timeout

3. handleRequest() → Recibe GET /callback?code=...&state=...

4. Validación → Resuelve/rechaza promise

5. stop() → Cierra servidor HTTP
```

### Request Handling Flow

```
GET /callback?code=ABC&state=XYZ
  ↓
Validate path = /callback
  ↓
Extract: code, state, error, error_description
  ↓
IF error:
  → Display error HTML
  → Reject promise
  → Stop server
  ↓
IF missing code/state:
  → Display error HTML
  → Reject promise
  ↓
ELSE:
  → Display success HTML
  → Resolve promise({ code, state })
  → Stop server
```

### HTML Responses

**Success Page**:
- Icon verde con checkmark
- Mensaje: "Authorization Successful!"
- Instrucción: cerrar ventana
- Gradient background (purple)

**Error Page**:
- Icon rojo con cruz
- Mensaje de error detallado
- Gradient background (red)

---

## Discovery Process

### Discovery Cascade

```
Input: resourceUrl, wwwAuthHeader?

┌─────────────────────────────────────────────┐
│ Priority 1: WWW-Authenticate as_uri         │
│ IF wwwAuthHeader contains "as_uri":         │
│   → Use as_uri directly (RFC 6750)          │
└─────────────────────────────────────────────┘
                 ↓ (no as_uri)
┌─────────────────────────────────────────────┐
│ Priority 2: resource_metadata hint          │
│ IF wwwAuthHeader contains "resource_metadata│
│   → Fetch metadata from hint URL            │
│   → Extract authorization_servers[0]        │
└─────────────────────────────────────────────┘
                 ↓ (no hint)
┌─────────────────────────────────────────────┐
│ Priority 3: RFC 9728 Discovery              │
│ Try path-aware metadata:                    │
│   GET /.well-known/oauth-protected-resource │
│       + /path/from/resourceUrl              │
│                                             │
│ If 404/410, try root metadata:              │
│   GET /.well-known/oauth-protected-resource │
└─────────────────────────────────────────────┘
                 ↓ (discovery failed)
┌─────────────────────────────────────────────┐
│ Priority 4: Fallback to Origin AS           │
│ Extract origin from resourceUrl             │
│ Assume AS is at origin (same domain)        │
└─────────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────┐
│ Fetch Authorization Server Metadata         │
│ GET <authServerUrl>/.well-known/           │
│     oauth-authorization-server              │
│                                             │
│ Validations:                                │
│   ✓ Required fields present                 │
│   ✓ PKCE S256 supported                     │
│   ✓ HTTPS endpoints (except localhost)      │
│                                             │
│ Cache for 1 hour                            │
└─────────────────────────────────────────────┘
```

### WWW-Authenticate Parsing

**Formato**:
```
WWW-Authenticate: Bearer realm="mcp",
                  as_uri="https://auth.example.com",
                  resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource",
                  error="invalid_token",
                  error_description="The access token expired",
                  scope="mcp:read mcp:write"
```

**Extracción**:
- `scheme`: "Bearer"
- `realm`: "mcp"
- `as_uri`: URL del Authorization Server (prioridad máxima)
- `resource_metadata`: URL de metadata del resource
- `error`: Código de error OAuth
- `error_description`: Descripción del error
- `scope`: Scopes requeridos

---

## HTTP Client Auto-Refresh

### Flujo Completo

```
Application wants to make HTTP request
                 ↓
Call: oauthHttpClient.getAuthHeaders(serverId)
                 ↓
ensureValidToken(serverId)
  1. Get tokens from TokenStore (decrypt)
  2. Check if exists → IF NOT: Throw NO_TOKENS
  3. Check expiration: isExpired = now >= (expiresAt - 60s)
  4. IF expired: Call refreshToken(serverId)
  5. Return valid tokens
                 ↓
Return: { Authorization: "Bearer <access_token>" }
                 ↓
Make HTTP request with headers
                 ↓
Receive response
                 ↓
        ┌────────┴────────┐
        │                 │
   Status 200          Status 401
        │                 │
        ↓                 ↓
     Success    handleUnauthorized()
                  1. Parse WWW-Authenticate
                  2. Get current tokens
                  3. IF no refresh_token: Return false
                  4. Try refreshToken()
                  5. IF success: Return true (retry)
                  6. IF failed: Delete tokens, Return false
                         ↓
                  ┌──────┴──────┐
                  │             │
            Retry=true    Retry=false
                  │             │
                  ↓             ↓
       Retry request    Re-authorization
       with new token    required
```

### Clock Skew Handling

**Buffer**: 60 segundos antes de expiración real

```typescript
const CLOCK_SKEW_BUFFER = 60000; // 60 seconds
const now = Date.now();
const expiresWithBuffer = tokens.expiresAt - CLOCK_SKEW_BUFFER;
const expired = now >= expiresWithBuffer;
```

**Razón**: Prevenir race conditions donde el token expira durante un request HTTP.

---

## Integración con Renderer

### oauthStore (Zustand)

**Ubicación**: `/src/renderer/stores/oauthStore.ts`

**Estado**:
```typescript
interface OAuthState {
  servers: Record<serverId, OAuthServerStatus>;
  loading: Record<serverId, boolean>;
  errors: Record<serverId, string | null>;
  pendingAuth: {
    serverId: string;
    mcpServerUrl: string;
    wwwAuth: string;
  } | null;
}
```

**Actions**:

```typescript
// Autorizar servidor
authorize(params: {
  serverId, mcpServerUrl, scopes?, clientId?, wwwAuthHeader?
}): Promise<void>

// Desconectar servidor
disconnect(serverId, revokeTokens = true): Promise<void>

// Refrescar estado
refreshStatus(serverId): Promise<void>

// Refrescar token manualmente
refreshToken(serverId): Promise<void>

// Cargar todos los servidores
loadAllServers(): Promise<void>

// Manejar OAuth requerido (evento)
handleOAuthRequired(params: {
  serverId, mcpServerUrl, wwwAuth
}): void

// Limpiar
clearError(serverId): void
clearPendingAuth(): void
```

### IPC Bridge (Preload)

**Definición** (asumida):
```typescript
window.levante.oauth = {
  // MCP OAuth
  authorize: (params) => ipcRenderer.invoke('levante/oauth/authorize', params),
  disconnect: (params) => ipcRenderer.invoke('levante/oauth/disconnect', params),
  status: (params) => ipcRenderer.invoke('levante/oauth/status', params),
  refresh: (params) => ipcRenderer.invoke('levante/oauth/refresh', params),
  list: () => ipcRenderer.invoke('levante/oauth/list'),

  // OpenRouter OAuth
  startServer: () => ipcRenderer.invoke('levante/oauth/start-server'),
  stopServer: () => ipcRenderer.invoke('levante/oauth/stop-server'),

  // Event listeners
  onOAuthRequired: (callback) => {
    ipcRenderer.on('levante/oauth/required', (_, data) => callback(data));
  },
  onOAuthCallback: (callback) => {
    ipcRenderer.on('levante/oauth/callback', (_, data) => callback(data));
  }
};
```

### Eventos IPC

#### OAuth Required Event

**Main Process**:
```typescript
// Cuando se detecta 401 que requiere OAuth
mainWindow.webContents.send('levante/oauth/required', {
  serverId: 'server1',
  mcpServerUrl: 'https://mcp.example.com',
  wwwAuth: 'Bearer realm="mcp", as_uri="..."'
});
```

**Renderer Process**:
```typescript
// Listener registrado en oauthStore
window.levante.oauth.onOAuthRequired((data) => {
  useOAuthStore.getState().handleOAuthRequired(data);
});

// En el store
handleOAuthRequired(data) {
  set({ pendingAuth: data });
  // UI muestra modal: "OAuth required for server1, authorize?"
}
```

#### OAuth Callback Event (OpenRouter)

**Main Process**:
```typescript
mainWindow.webContents.send('levante/oauth/callback', {
  success: true,
  provider: 'openrouter',
  code: 'ABC123XYZ'
});
```

**Renderer Process**:
```typescript
window.levante.oauth.onOAuthCallback((data) => {
  if (data.success && data.provider === 'openrouter') {
    exchangeCodeForToken(data.code);
  } else {
    showError(data.error);
  }
});
```

### UI Flow Example

**Caso de Uso: MCP Server requiere OAuth**

```
1. User intenta conectar a MCP server
   ↓
2. Backend intenta conexión HTTP
   ↓
3. Recibe 401 con WWW-Authenticate
   ↓
4. Main process envía evento: levante/oauth/required
   ↓
5. Renderer oauthStore.handleOAuthRequired()
   → set({ pendingAuth: { serverId, mcpServerUrl, wwwAuth } })
   ↓
6. UI muestra modal:
   "Server 'server1' requires OAuth authentication"
   [Authorize] [Cancel]
   ↓
7. User clicks [Authorize]
   → oauthStore.authorize({ serverId, mcpServerUrl, wwwAuthHeader })
   ↓
8. IPC call → Main process → OAuthService.authorize()
   → Discovery → DCR → Auth Flow → Token Exchange
   → Browser se abre para login
   ↓
9. User completa login en browser
   ↓
10. Callback a loopback server → código recibido
   ↓
11. Token exchange completo → tokens guardados
   ↓
12. IPC response → Renderer
   → oauthStore actualiza: servers[serverId] = { hasTokens: true, ... }
   → clearPendingAuth()
   ↓
13. UI muestra success: "Successfully authorized!"
   ↓
14. Backend reintenta conexión MCP con token → Success!
```

---

## Características Avanzadas

### 1. Dynamic Client Registration (DCR)

**RFC 7591** implementado en `OAuthDiscoveryService.registerClient()`.

**Flujo**:
```
1. Check metadata.registration_endpoint exists
2. Validate endpoint HTTPS (except localhost)
3. Build registration request:
   {
     client_name: "Levante",
     client_uri: "https://github.com/levante-hub/levante",
     redirect_uris: [redirectUri],  // Pre-allocated port
     grant_types: ["authorization_code", "refresh_token"],
     response_types: ["code"],
     token_endpoint_auth_method: "none",  // Public client
     scope: "mcp:read mcp:write"
   }
4. POST to registration_endpoint
5. Response: { client_id, client_secret?, ... }
6. Save credentials (encrypted) to preferences
```

**Ventajas**:
- No requiere configuración manual de cliente
- Cada instalación de Levante obtiene su propio client_id
- Soporta confidential clients (con client_secret)
- Permite actualización dinámica de configuración

**Fallback**:
- Si AS no soporta DCR → Error: "Manual client configuration required"

---

### 2. Token Revocation (RFC 7009)

**Implementado en**: `OAuthFlowManager.revokeToken()` y `OAuthService.disconnect()`

**Flujo**:
```
1. User triggers disconnect
2. Get stored tokens and OAuth config
3. Fetch AS metadata → Check revocation_endpoint
4. IF supported:
   a. Revoke refresh_token first (invalidates both)
   b. Revoke access_token
5. IF revocation fails: Log error but continue
6. Delete tokens from storage (always)
7. Remove OAuth config
```

**RFC 7009 Compliance**:
- Server MUST respond 200 OK even if token invalid
- `token_type_hint` is optional but recommended
- Revoke refresh_token first (best practice)
- Continue disconnect even if revocation fails

---

### 3. Resource Indicators (RFC 8707)

**Implementado en**: `OAuthFlowManager.createAuthorizationUrl()`

**Authorization URL**:
```
<authorization_endpoint>?
  response_type=code&
  client_id=<clientId>&
  redirect_uri=<redirectUri>&
  scope=mcp:read+mcp:write&
  state=<state>&
  code_challenge=<challenge>&
  code_challenge_method=S256&
  resource=https://mcp.example.com  ← RFC 8707
```

**Ventaja**:
- Access token emitido específicamente para ese recurso
- Mejora seguridad (tokens con scope limitado)
- Cumple con principio de least privilege

---

### 4. Multi-AS Support

El sistema soporta múltiples Authorization Servers simultáneamente:

```json
{
  "mcpServers": {
    "server1": {
      "oauth": {
        "authServerId": "https://auth-provider-a.com"
      }
    },
    "server2": {
      "oauth": {
        "authServerId": "https://auth-provider-b.com"
      }
    }
  }
}
```

**Características**:
- Cache separado por AS
- Tokens independientes por servidor
- Refresh independiente
- Revocación independiente

---

### 5. Security Features

1. **PKCE (RFC 7636)**:
   - Obligatorio (S256)
   - Code verifier: 256 bits entropía
   - Code challenge: SHA-256

2. **State Parameter (CSRF)**:
   - 128 bits entropía
   - One-time use
   - 5 minutos TTL
   - Validación estricta

3. **Token Encryption**:
   - electron.safeStorage (OS keychain)
   - Access & refresh tokens encriptados
   - Client secrets encriptados
   - Registration tokens encriptados

4. **Loopback Server**:
   - Solo 127.0.0.1 (localhost)
   - Puerto aleatorio
   - Timeout 5 minutos
   - Un solo callback permitido

5. **HTTPS Enforcement**:
   - Validación de endpoints HTTPS
   - Excepto localhost (desarrollo)
   - Warnings en logs

6. **Clock Skew Tolerance**:
   - 60 segundos buffer
   - Previene expiración durante request

---

## Resumen Ejecutivo

### Arquitectura

Sistema OAuth 2.1 modular y en capas basado en múltiples RFCs estándar.

### Casos de Uso

1. **MCP Servers**: Autenticación OAuth para servidores MCP
2. **OpenRouter**: Autenticación para servicios de IA

### Servicios Core

| Servicio | Responsabilidad |
|----------|----------------|
| OAuthService | Orchestración principal |
| OAuthDiscoveryService | Discovery automático + DCR |
| OAuthFlowManager | Flujo PKCE + Token exchange |
| OAuthTokenStore | Almacenamiento encriptado |
| OAuthHttpClient | Auto-refresh + 401 handling |
| OAuthRedirectServer | Callback loopback (MCP) |
| OAuthStateManager | Validación anti-CSRF |
| oauthCallbackServer | Callback OpenRouter |

### Flujo Típico (MCP)

```
Discovery → DCR → Authorization → Token Exchange → Save → Auto-Refresh
```

### Storage

- **Config**: `~/levante/ui-preferences.json`
- **Tokens**: Encriptados con safeStorage
- **Cache**: In-memory (1 hora TTL)

### IPC

- **7 handlers**: authorize, disconnect, status, refresh, list, start-server, stop-server
- **2 eventos**: oauth/required, oauth/callback

### Características Destacadas

- ✅ OAuth 2.1 compliance completo
- ✅ Dynamic Client Registration automático
- ✅ Token Revocation en disconnect
- ✅ Auto-refresh con clock skew tolerance
- ✅ Encriptación OS-level (Keychain/DPAPI/libsecret)
- ✅ Multi-AS support
- ✅ Cache inteligente con TTL

### Estado de Producción

**Production-ready**: Cumple con los estándares OAuth más recientes y sigue las mejores prácticas de seguridad.

---

## Referencias

- [RFC 6749: OAuth 2.0 Authorization Framework](https://tools.ietf.org/html/rfc6749)
- [RFC 7636: PKCE](https://tools.ietf.org/html/rfc7636)
- [RFC 8414: Authorization Server Metadata](https://tools.ietf.org/html/rfc8414)
- [RFC 9728: Protected Resource Metadata](https://tools.ietf.org/html/rfc9728)
- [RFC 7591: Dynamic Client Registration](https://tools.ietf.org/html/rfc7591)
- [RFC 7009: Token Revocation](https://tools.ietf.org/html/rfc7009)
- [RFC 8707: Resource Indicators](https://tools.ietf.org/html/rfc8707)
- [RFC 6750: Bearer Token Usage](https://tools.ietf.org/html/rfc6750)

---

**Última actualización**: 2025-12-23
**Versión**: 1.0.0
