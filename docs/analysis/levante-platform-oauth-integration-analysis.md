# Análisis de Integración OAuth - Levante Platform como Proveedor de Modelos

## Resumen Ejecutivo

Este documento analiza la viabilidad de integrar **Levante Platform** como un nuevo proveedor de modelos en la aplicación Levante, utilizando la infraestructura OAuth existente.

**Conclusión Principal**: La integración es **trivial** porque Levante Platform **ya implementa OAuth Discovery (RFC 8414)**. El flujo es **idéntico al de OAuth MCP**:

```
Levante Platform expone:
├── /.well-known/oauth-authorization-server  (RFC 8414)
└── /.well-known/openid-configuration        (OpenID Connect)
```

**Reutilización: ~98%** - Solo necesitamos añadir Levante Platform como un "servidor" más en el sistema existente de OAuth MCP. No hay código nuevo significativo.

**Razón para DCR**: Levante Desktop es una aplicación distribuida. No se puede hardcodear `client_secret` en el binario porque se filtraría. Cada instalación necesita registrarse dinámicamente para obtener sus propias credenciales.

---

## 1. Comparación de Flujos OAuth

### 1.1 Matriz Comparativa

| Característica | OAuth MCP | OAuth OpenRouter | Levante Platform |
|----------------|-----------|------------------|------------------|
| **Propósito** | Auth server-to-server | Obtener API key | Auth para API de modelos |
| **Estándar** | OAuth 2.1 completo | OAuth 2.1 simplificado | **OAuth 2.1 completo** |
| **PKCE** | ✓ Obligatorio (S256) | ✓ Obligatorio (S256) | ✓ Obligatorio (S256) |
| **Discovery** | ✓ RFC 8414 | ✗ Endpoints fijos | ✓ **RFC 8414** |
| **DCR** | ✓ RFC 7591 | ✗ No requerido | ✓ RFC 7591 |
| **Token Type** | Access + Refresh | API Key permanente | Access + Refresh |
| **Token Refresh** | ✓ Automático | N/A | ✓ Automático |
| **Token Revocation** | ✓ RFC 7009 | N/A | Por determinar |
| **Authorization Server** | Dinámico (discovery) | OpenRouter fijo | **Dinámico (discovery)** |
| **Puerto Callback** | 31337 | 3000 | Configurable |
| **Scopes** | Dinámicos | N/A | `openid email` |

> ✅ **Levante Platform ya implementa Discovery (RFC 8414)**:
> - `/.well-known/oauth-authorization-server`
> - `/.well-known/openid-configuration`
>
> Esto significa que el flujo es **idéntico a OAuth MCP**. No hay código nuevo que escribir.

### 1.2 Endpoints Comparados

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        OAUTH MCP (Dinámico)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  Discovery:     GET /.well-known/oauth-authorization-server                │
│  Resource:      GET /.well-known/oauth-protected-resource                  │
│  Registration:  POST {registration_endpoint} (RFC 7591)                    │
│  Authorization: GET {authorization_endpoint}                               │
│  Token:         POST {token_endpoint}                                      │
│  Revocation:    POST {revocation_endpoint}                                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                        OAUTH OPENROUTER (Fijo)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  Authorization: GET https://openrouter.ai/auth                             │
│  Key Exchange:  POST https://openrouter.ai/api/v1/auth/keys                │
│  API:           POST https://openrouter.ai/api/v1                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                        LEVANTE PLATFORM (Dinámico - igual que MCP)          │
├─────────────────────────────────────────────────────────────────────────────┤
│  Discovery:     GET https://platform.levante.ai/.well-known/oauth-authorization-server
│  Registration:  POST {registration_endpoint} (del discovery)               │
│  Authorization: GET {authorization_endpoint} (del discovery)               │
│  Token:         POST {token_endpoint} (del discovery)                      │
│  API:           POST https://platform.levante.ai/api/v1/chat/completions   │
└─────────────────────────────────────────────────────────────────────────────┘

> ✅ **El discovery ya está implementado** en `app/.well-known/oauth-authorization-server/route.ts`
> La lógica de `OAuthDiscoveryService` funciona sin cambios.
```

---

## 2. Análisis de Reutilización de Componentes

### 2.1 Componentes 100% Reutilizables ✓

**Todo el stack de OAuth MCP funciona sin cambios:**

| Componente | Archivo | Uso en Levante Platform |
|------------|---------|-------------------------|
| **Discovery Service** | `OAuthDiscoveryService.ts` | ✓ Idéntico: `/.well-known/oauth-authorization-server` |
| **DCR Registration** | `OAuthDiscoveryService.ts` | ✓ Idéntico: `registerClient()` |
| **PKCE Generation** | `OAuthFlowManager.ts` | ✓ Idéntico: `generatePKCE()` → S256 |
| **Token Exchange** | `OAuthFlowManager.ts` | ✓ Idéntico: `exchangeCodeForTokens()` |
| **Token Refresh** | `OAuthFlowManager.ts` | ✓ Idéntico: `refreshAccessToken()` |
| **State Management** | `OAuthStateManager.ts` | ✓ Idéntico: CSRF protection |
| **Token Storage** | `OAuthTokenStore.ts` | ✓ Idéntico: solo usar `"levante-platform"` como key |
| **SafeStorage Encryption** | `PreferencesService.ts` | ✓ Idéntico: encriptación de tokens |
| **Callback Server** | `OAuthRedirectServer.ts` | ✓ Idéntico: mismo puerto o configurable |
| **HTTP Client** | `OAuthHttpClient.ts` | ✓ Idéntico: refresh automático |

### 2.2 Código Nuevo Necesario

| Componente | Descripción |
|------------|-------------|
| **Provider en UI** | Añadir "Levante Platform" a la lista de proveedores OAuth |
| **URL base** | Configurar `https://platform.levante.ai` como servidor |

Eso es todo. No hay lógica nueva que implementar.

---

## 3. Comparación con Flujos Existentes

### 3.1 vs OAuth MCP

**El flujo es idéntico.** Levante Platform se comporta como "otro servidor MCP" desde la perspectiva del código:

```typescript
// OAuth MCP
const metadata = await discoverAuthorizationServer('https://mcp-server.example.com');

// Levante Platform - MISMO CÓDIGO
const metadata = await discoverAuthorizationServer('https://platform.levante.ai');

// Ambos retornan:
// {
//   authorization_endpoint: "...",
//   token_endpoint: "...",
//   registration_endpoint: "..."
// }
```

**No hay diferencias en el código.** Solo cambia la URL base.

### 3.2 vs OAuth OpenRouter

OpenRouter es diferente porque **no usa discovery ni DCR**:

| Aspecto | OpenRouter | Levante Platform |
|---------|------------|------------------|
| Discovery | ✗ Endpoints hardcodeados | ✓ RFC 8414 |
| DCR | ✗ Cliente público | ✓ RFC 7591 |
| Resultado | API key permanente | Access + Refresh tokens |
| Código | Flujo custom | **Mismo código que OAuth MCP** |

---

## 4. Arquitectura

### 4.1 No hay arquitectura nueva

Levante Platform usa **exactamente la misma arquitectura que OAuth MCP**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FLUJO EXISTENTE (OAuth MCP)                              │
│                    = FLUJO LEVANTE PLATFORM                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  OAuthDiscoveryService.discover("https://platform.levante.ai")             │
│         │                                                                   │
│         ▼                                                                   │
│  GET /.well-known/oauth-authorization-server                               │
│         │                                                                   │
│         ▼                                                                   │
│  { authorization_endpoint, token_endpoint, registration_endpoint }         │
│         │                                                                   │
│         ▼                                                                   │
│  OAuthDiscoveryService.registerClient() → client_id, client_secret         │
│         │                                                                   │
│         ▼                                                                   │
│  OAuthFlowManager.initiateAuth() → abre navegador                          │
│         │                                                                   │
│         ▼                                                                   │
│  OAuthFlowManager.exchangeCodeForTokens() → access_token, refresh_token    │
│         │                                                                   │
│         ▼                                                                   │
│  OAuthTokenStore.saveTokens("levante-platform", tokens)                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Almacenamiento

Usa el mismo formato que OAuth MCP. Solo cambia el identificador del servidor.

---

## 5. Implementación

### 5.1 Lo que hay que hacer

```typescript
// Pseudo-código - NO es código nuevo, es usar el existente

// 1. Añadir Levante Platform como servidor OAuth (config, no código)
const levantePlatformServer = {
  id: 'levante-platform',
  name: 'Levante Platform',
  url: 'https://platform.levante.ai'  // ← Solo esto es nuevo
};

// 2. El resto usa el código existente de OAuth MCP
const metadata = await oauthDiscoveryService.discover(levantePlatformServer.url);
const clientCredentials = await oauthDiscoveryService.registerClient(metadata);
const tokens = await oauthFlowManager.initiateAuth(metadata, clientCredentials);
await oauthTokenStore.saveTokens('levante-platform', tokens);
```

### 5.2 Uso de la API

Una vez autenticado, las llamadas a la API usan el token:

```typescript
// El access token se obtiene del store existente
const tokens = await oauthTokenStore.getTokens('levante-platform');

// Llamada a la API de completions
const response = await fetch('https://platform.levante.ai/api/v1/chat/completions', {
  headers: {
    'Authorization': `Bearer ${tokens.accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ model, messages, stream: true })
});
```

---

## 6. Estimación de Esfuerzo

### 6.1 Archivos a Crear

**Ninguno.** El código de OAuth MCP ya maneja todo.

### 6.2 Archivos a Modificar

| Archivo | Cambio | Complejidad |
|---------|--------|-------------|
| Configuración de providers | Añadir `"levante-platform"` con URL base | Trivial |
| UI de settings | Añadir botón "Conectar con Levante Platform" | Baja |

### 6.3 Resumen de Reutilización

```
Código Reutilizado:     ~98%
├── OAuthDiscoveryService                100% (discovery dinámico)
├── OAuthFlowManager                     100% (PKCE, token exchange, refresh)
├── OAuthStateManager                    100% (CSRF protection)
├── OAuthTokenStore                      100% (almacenamiento)
├── OAuthRedirectServer                  100% (callback HTTP)
├── OAuthHttpClient                      100% (refresh automático)
├── SafeStorage encryption               100%
└── Manejo de client_secret expiration   100%

Código Nuevo:           ~2%
└── Configuración: URL "https://platform.levante.ai"
```

---

## 7. Consideraciones de Seguridad

**Ya implementadas en OAuth MCP.** No hay trabajo adicional:

| Aspecto | Implementación existente |
|---------|-------------------------|
| Almacenamiento de credenciales DCR | `OAuthTokenStore` con `safeStorage` |
| Expiración de client_secret | `OAuthDiscoveryService.isClientSecretExpired()` |
| Protección CSRF | `OAuthStateManager` |
| Token rotation | `OAuthFlowManager.refreshAccessToken()` |
| Encriptación | `safeStorage` API de Electron |

---

## 8. Preguntas Pendientes

### 8.1 Verificar en Discovery Response

El discovery ya está implementado. Solo verificar que incluya:

1. **`registration_endpoint`** - Para DCR (RFC 7591)
2. **`revocation_endpoint`** - Para logout limpio (opcional)

### 8.2 API de Modelos

1. **¿Existe `/api/v1/models`?** - Para listar modelos disponibles dinámicamente
2. **¿Headers de rate limiting?** - `X-RateLimit-Remaining` para mostrar en UI

### 8.3 Decisiones de Diseño

1. **Nombre en UI**: "Levante Platform" vs "Levante Cloud"

---

## 9. Conclusión

### 9.1 Viabilidad

**TRIVIAL** - Levante Platform ya implementa OAuth Discovery (RFC 8414), igual que los servidores MCP:

| Aspecto | Evaluación |
|---------|------------|
| Reutilización de código | **~98%** |
| Complejidad de integración | **Trivial** |
| Riesgo técnico | **Mínimo** |
| Compatibilidad arquitectónica | **100%** (idéntico a OAuth MCP) |

### 9.2 Enfoque

**No hay enfoque especial.** Levante Platform es "otro servidor OAuth" desde la perspectiva del código:

```typescript
// Literalmente esto es todo lo que hay que hacer:
oauthDiscoveryService.discover('https://platform.levante.ai');
```

El resto del flujo (DCR, PKCE, tokens, refresh, storage) **ya está implementado**.

### 9.3 Próximos Pasos

1. ✅ Verificar que discovery response incluya `registration_endpoint`
2. ✅ Añadir "Levante Platform" como opción en UI de providers
3. ✅ Probar flujo E2E

---

*Análisis generado: Febrero 2026*
*Basado en: oauth-flows-analysis.md + Guía de Integración OAuth 2.1 Levante Platform*

**Revisión 1.2**:
- Corregido para incluir DCR como requisito obligatorio
- Actualizado al confirmar que Levante Platform **ya implementa OAuth Discovery (RFC 8414)**
- Reutilización actualizada de ~85% a **~98%** - el flujo es idéntico a OAuth MCP
