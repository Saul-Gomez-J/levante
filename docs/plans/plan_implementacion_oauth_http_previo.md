# Plan de Implementación: Petición HTTP Previa para OAuth

**Fecha**: 2025-12-22
**Objetivo**: Añadir una petición HTTP manual antes de `createSession()` para obtener el header `WWW-Authenticate` y completar correctamente el flujo OAuth en servidores MCP.

---

## 📋 Resumen Ejecutivo

### Problema Identificado

Cuando se intenta conectar a un servidor MCP que requiere OAuth (como Linear):

1. **mcp-use detecta internamente** que se requiere autenticación
2. **NO hace una petición HTTP real** al servidor
3. **NO se obtiene el header `WWW-Authenticate`** del servidor
4. **El flujo OAuth se detecta pero NO se completa** porque falta información crítica

### Solución Propuesta

**Añadir una petición HTTP GET manual** al servidor MCP **ANTES** de llamar a `client.createSession()`:

- ✅ Solo se ejecuta para transportes HTTP-based (`http`, `sse`, `streamable-http`) y NO hay token OAuth
- ✅ Obtiene el header `WWW-Authenticate` real del servidor
- ✅ Usa la URL exacta del transport (misma URL que pasará a mcp-use)
- ✅ Solo DETECTA OAuth requirement, NO inicia el flujo (evita duplicación)
- ✅ El renderer/UI es el único orquestador de OAuth
- ✅ Sigue el estándar OAuth 2.0 correctamente
- ✅ Latencia adicional aceptable (solo cuando no hay token)

---

## ⚠️ Notas Importantes

### 🔧 Correcciones Críticas Aplicadas

Este plan incluye **3 correcciones críticas** para garantizar el funcionamiento correcto:

#### 1️⃣ **No limitar a transport === 'http'**
❌ **INCORRECTO**: `if (finalTransport === 'http' && !hasOAuthToken)`
✅ **CORRECTO**: `if ((finalTransport === 'http' || finalTransport === 'sse' || finalTransport === 'streamable-http') && !hasOAuthToken)`

**Razón**: El problema puede ocurrir con cualquier transport HTTP-based, no solo con 'http'.

---

#### 2️⃣ **Usar la URL exacta del transport**
❌ **INCORRECTO**: Hacer preflight a una URL diferente a la que usa mcp-use
✅ **CORRECTO**: Hacer preflight a la **misma URL exacta** que se pasa a mcp-use

**Razón**: Si el transport usa un path específico (ej: `/mcp` o `/sse`), debemos hacer preflight a esa URL exacta para recibir el mismo 401 + WWW-Authenticate.

---

#### 3️⃣ **No iniciar OAuth dos veces**
❌ **INCORRECTO**:
```typescript
await this.initiateOAuthFlow(...);  // ← En checkOAuthRequirement()
throw { code: 'OAUTH_REQUIRED' };
```

✅ **CORRECTO**:
```typescript
// checkOAuthRequirement() solo detecta y lanza error
throw { code: 'OAUTH_REQUIRED', wwwAuth };

// El renderer/UI es quien inicia OAuth (único orquestador)
```

**Razón**: Tener múltiples puntos que inician OAuth causa duplicación. El renderer/UI debe ser el **único orquestador** del flujo OAuth.

---

## 🎯 Objetivos

1. **Detectar proactivamente** si un servidor MCP requiere OAuth
2. **Obtener el header `WWW-Authenticate`** del servidor antes de intentar conectar
3. **Propagar el error `OAUTH_REQUIRED` con el header** para que el IPC handler inicie el flujo (evitando duplicación)
4. **Evitar reintentos innecesarios** del retry loop
5. **Mantener compatibilidad** con servidores que NO requieren OAuth
6. **Usar la URL exacta del transport** para el preflight check

---

## 📁 Archivos a Modificar

### 1. `src/main/services/mcp/mcpUseService.ts`

**Sección afectada**: Método `connectServer()` (líneas 85-290)

**Cambios**:
- Añadir método privado `checkOAuthRequirement()`
- Añadir llamada a este método ANTES del retry loop
- Manejar el resultado de la petición HTTP previa

---

## 🔧 Implementación Detallada

### Paso 1: Añadir método `checkOAuthRequirement()`

**Ubicación**: `src/main/services/mcp/mcpUseService.ts` (después del método `extractWWWAuthenticate()`, línea ~573)

**Código a añadir**:

```typescript
/**
 * Checks if the MCP server requires OAuth by making a preliminary HTTP GET request.
 * This is necessary because mcp-use may detect authentication requirements internally
 * without making an actual HTTP request, preventing us from obtaining the WWW-Authenticate header.
 *
 * IMPORTANT: This method only DETECTS OAuth requirements and throws OAUTH_REQUIRED error.
 * It does NOT initiate the OAuth flow itself to avoid duplication - the IPC handler
 * or retry loop will handle initiating OAuth based on the error code.
 *
 * @param serverId - Server identifier
 * @param transportUrl - Exact URL used by the transport (same URL passed to mcp-use)
 * @param baseUrl - Base MCP server URL (used in error metadata)
 * @throws Error with code 'OAUTH_REQUIRED' if OAuth flow should be initiated
 */
private async checkOAuthRequirement(
  serverId: string,
  transportUrl: string,
  baseUrl: string
): Promise<void> {
  try {
    this.logger.mcp.debug('Checking OAuth requirement with preliminary HTTP request', {
      serverId,
      transportUrl,
      baseUrl
    });

    // Make a simple GET request to the exact transport URL
    // This ensures we get the same 401 response that mcp-use would receive
    const response = await fetch(transportUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/event-stream',
        'User-Agent': 'Levante-MCP-Client/1.0'
      },
      // Don't follow redirects automatically
      redirect: 'manual'
    });

    this.logger.mcp.debug('Preliminary HTTP response received', {
      serverId,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });

    // Check if response is 401 Unauthorized
    if (response.status === 401) {
      // Extract WWW-Authenticate header
      const wwwAuth = response.headers.get('WWW-Authenticate') ||
                      response.headers.get('www-authenticate');

      this.logger.mcp.info('Server requires OAuth authentication (401 received)', {
        serverId,
        hasWWWAuth: !!wwwAuth,
        wwwAuthPreview: wwwAuth ? wwwAuth.substring(0, 100) : undefined
      });

      if (wwwAuth) {
        // Check if we can attempt OAuth
        if (!this.canAttemptOAuth(serverId)) {
          const error = new Error('Too many OAuth attempts for this server');
          (error as any).code = 'OAUTH_LIMIT_EXCEEDED';
          throw error;
        }

        // DO NOT initiate OAuth here - just throw the error with metadata
        // The IPC handler will initiate OAuth to avoid duplication
        this.logger.mcp.info('OAuth requirement detected, throwing OAUTH_REQUIRED error', {
          serverId,
          note: 'OAuth flow will be initiated by IPC handler'
        });

        // Throw error to stop connection attempt and signal OAuth requirement
        const oauthError = new Error('OAuth authorization required');
        (oauthError as any).code = 'OAUTH_REQUIRED';
        (oauthError as any).serverId = serverId;
        (oauthError as any).mcpServerUrl = baseUrl;
        (oauthError as any).wwwAuth = wwwAuth;
        throw oauthError;
      } else {
        // 401 without WWW-Authenticate - unusual but possible
        this.logger.mcp.warn('Received 401 without WWW-Authenticate header', {
          serverId
        });
      }
    } else if (response.status >= 200 && response.status < 300) {
      // Server is accessible without authentication
      this.logger.mcp.debug('Server accessible without OAuth', {
        serverId,
        status: response.status
      });
    } else if (response.status >= 300 && response.status < 400) {
      // Redirect - log but continue with normal connection attempt
      this.logger.mcp.debug('Server returned redirect', {
        serverId,
        status: response.status,
        location: response.headers.get('Location')
      });
    } else {
      // Other error status - log but continue with normal connection attempt
      this.logger.mcp.debug('Server returned non-401 error status', {
        serverId,
        status: response.status
      });
    }

    // If we reach here, no OAuth is required or detected
  } catch (error: any) {
    // If it's our OAuth error, re-throw it
    if (error.code === 'OAUTH_REQUIRED' || error.code === 'OAUTH_LIMIT_EXCEEDED') {
      throw error;
    }

    // For network errors or other issues, log and continue
    // The normal connection attempt will handle these errors
    this.logger.mcp.debug('Preliminary OAuth check failed, continuing with normal connection', {
      serverId,
      error: error.message,
      errorType: error.constructor.name
    });
  }
}
```

---

### Paso 2: Modificar método `connectServer()` para usar la petición previa

**Ubicación**: `src/main/services/mcp/mcpUseService.ts` (método `connectServer()`, línea ~85)

**Código actual** (líneas ~142-150):

```typescript
// Prepare headers
let headers: Record<string, string> = {};

// Check if OAuth token exists for this server
try {
  const oauthService = new OAuthService(this.preferencesService);
  const tokens = await oauthService.getExistingToken(config.id);

  if (tokens) {
    this.logger.core.debug("Using existing OAuth token for MCP connection", {
      serverId: config.id,
      tokenType: tokens.tokenType
    });

    headers = {
      Authorization: `${tokens.tokenType} ${tokens.accessToken}`
    };
  } else {
    this.logger.core.debug("No OAuth tokens found", {
      serverId: config.id
    });
  }
} catch (error) {
  this.logger.mcp.error("Failed to retrieve OAuth token", {
    serverId: config.id,
    error: error instanceof Error ? error.message : String(error)
  });
}
```

**Código modificado** (REEMPLAZAR desde línea ~142):

```typescript
// Prepare headers
let headers: Record<string, string> = {};
let hasOAuthToken = false;

// Check if OAuth token exists for this server
try {
  const oauthService = new OAuthService(this.preferencesService);
  const tokens = await oauthService.getExistingToken(config.id);

  if (tokens) {
    this.logger.core.debug("Using existing OAuth token for MCP connection", {
      serverId: config.id,
      tokenType: tokens.tokenType
    });

    headers = {
      Authorization: `${tokens.tokenType} ${tokens.accessToken}`
    };
    hasOAuthToken = true;
  } else {
    this.logger.core.debug("No OAuth tokens found", {
      serverId: config.id
    });
  }
} catch (error) {
  this.logger.mcp.error("Failed to retrieve OAuth token", {
    serverId: config.id,
    error: error instanceof Error ? error.message : String(error)
  });
}

// If using HTTP-based transport and no OAuth token, check if server requires OAuth
// This preliminary check allows us to obtain the WWW-Authenticate header
// which mcp-use might not provide if it detects auth requirements internally
// IMPORTANT: Use the exact same URL that will be passed to mcp-use transport
if ((finalTransport === 'http' || finalTransport === 'sse' || finalTransport === 'streamable-http') && !hasOAuthToken) {
  this.logger.mcp.debug('Performing preliminary OAuth check (no token present)', {
    serverId: config.id,
    transport: finalTransport,
    url: baseUrl
  });

  try {
    // Pass both transportUrl (exact URL for preflight) and baseUrl (for error metadata)
    await this.checkOAuthRequirement(config.id, baseUrl, baseUrl);
    // If no error thrown, OAuth is not required or check failed non-critically
    this.logger.mcp.debug('Preliminary OAuth check passed, proceeding with connection', {
      serverId: config.id
    });
  } catch (error: any) {
    // If OAuth is required, this error will be caught by the outer try-catch
    // and handled by the IPC handler which will initiate the OAuth flow
    if (error.code === 'OAUTH_REQUIRED' || error.code === 'OAUTH_LIMIT_EXCEEDED') {
      this.logger.mcp.info('OAuth required, aborting connection attempt', {
        serverId: config.id,
        errorCode: error.code
      });
      throw error;
    }
    // Other errors are logged but don't stop the connection attempt
    this.logger.mcp.debug('Preliminary OAuth check error ignored', {
      serverId: config.id,
      error: error.message
    });
  }
}
```

---

### Paso 3: Actualizar manejo de errores OAuth en el retry loop (OPCIONAL)

**Ubicación**: `src/main/services/mcp/mcpUseService.ts` (dentro del retry loop, línea ~230-250)

**Justificación**: Este paso es opcional porque con la petición HTTP previa, el flujo OAuth debería iniciarse ANTES del retry loop. Sin embargo, mantenemos el código existente como fallback.

**Código actual** (líneas ~230-265):

```typescript
if (this.is401Error(error)) {
  if (!this.canAttemptOAuth(config.id)) {
    this.logger.mcp.error('Too many OAuth attempts', { serverId: config.id });
  } else {
    this.logger.mcp.info("Received 401, initiating OAuth flow", {
      serverId: config.id,
      url: baseUrl
    });

    const wwwAuth = this.extractWWWAuthenticate(error);

    if (wwwAuth) {
      await this.initiateOAuthFlow(config.id, baseUrl, wwwAuth);

      throw {
        code: 'OAUTH_REQUIRED',
        message: 'OAuth authorization required',
        serverId: config.id,
        mcpServerUrl: baseUrl,
        wwwAuth
      };
    }
  }
}
```

**Código modificado** (MANTENER como fallback, pero añadir log):

```typescript
if (this.is401Error(error)) {
  if (!this.canAttemptOAuth(config.id)) {
    this.logger.mcp.error('Too many OAuth attempts', { serverId: config.id });
  } else {
    this.logger.mcp.info("Received 401 during connection (fallback detection)", {
      serverId: config.id,
      url: baseUrl,
      note: 'Preliminary OAuth check should have caught this'
    });

    const wwwAuth = this.extractWWWAuthenticate(error);

    if (wwwAuth) {
      await this.initiateOAuthFlow(config.id, baseUrl, wwwAuth);

      throw {
        code: 'OAUTH_REQUIRED',
        message: 'OAuth authorization required',
        serverId: config.id,
        mcpServerUrl: baseUrl,
        wwwAuth
      };
    } else {
      // If we detected 401 but no WWW-Authenticate header (should be rare now)
      this.logger.mcp.warn('Detected 401 error but no WWW-Authenticate header available', {
        serverId: config.id,
        errorMessage: error.message
      });
    }
  }
}
```

---

### Paso 4: Verificar que el IPC Handler está correctamente implementado (NO REQUIERE CAMBIOS)

**Ubicación**: `src/main/ipc/mcpHandlers/connection.ts` (líneas 44-56)

**Estado**: ✅ YA IMPLEMENTADO CORRECTAMENTE

El IPC handler ya maneja correctamente el error `OAUTH_REQUIRED`:

```typescript
// Handle OAuth required error
if (error.code === 'OAUTH_REQUIRED') {
  return {
    success: false,
    error: error.message || 'OAuth authorization required',
    errorCode: 'OAUTH_REQUIRED',
    metadata: {
      serverId: error.serverId,
      mcpServerUrl: error.mcpServerUrl,
      wwwAuth: error.wwwAuth
    }
  };
}
```

**Arquitectura de responsabilidades**:
- ✅ `checkOAuthRequirement()`: **DETECTA** OAuth requirement y lanza error con metadata
- ✅ IPC Handler: **PROPAGA** el error al renderer con toda la metadata
- ✅ Renderer/UI: **ORQUESTA** la apertura de la ventana OAuth (único orquestador)

**Ventajas de este diseño**:
1. **Evita duplicación**: Solo el renderer inicia OAuth, no hay múltiples llamadas
2. **Separación clara**: Backend detecta y propaga, Frontend orquesta UI
3. **Consistencia**: Todos los errores OAuth fluyen por el mismo camino

**IMPORTANTE**: NO añadir llamadas a `initiateOAuthFlow()` en el IPC handler, ya está correctamente diseñado.

---

## 📊 Diagrama de Flujo

### Flujo ANTES (actual)

```
Usuario pulsa switch
  ↓
Zustand Store → IPC → MCPUseService.connectServer()
  ↓
Buscar token OAuth existente → NO encontrado
  ↓
Crear MCPClient sin Authorization header
  ↓
Llamar client.createSession()
  ↓
mcp-use detecta internamente "Authentication required"
  ↓
Lanza error SIN WWW-Authenticate header
  ↓
is401Error() detecta el patrón → ✅ TRUE
  ↓
extractWWWAuthenticate() → ❌ undefined
  ↓
if (wwwAuth) → ❌ FALSE
  ↓
NO se lanza error OAUTH_REQUIRED
  ↓
Error genérico se propaga
  ↓
❌ UI no muestra feedback OAuth
```

### Flujo DESPUÉS (propuesto)

```
Usuario pulsa switch
  ↓
Zustand Store → IPC → MCPUseService.connectServer()
  ↓
Buscar token OAuth existente → NO encontrado
  ↓
✨ NUEVO: checkOAuthRequirement(serverId, baseUrl)
  ↓
Hacer HTTP GET a baseUrl
  ↓
Servidor responde 401 + WWW-Authenticate header
  ↓
Extraer WWW-Authenticate → ✅ "Bearer realm=..."
  ↓
Lanzar error { code: 'OAUTH_REQUIRED', wwwAuth: "..." }
  ↓
IPC Handler captura error.code === 'OAUTH_REQUIRED'
  ↓
Devuelve { success: false, errorCode: 'OAUTH_REQUIRED', metadata: { wwwAuth, ... } }
  ↓
Zustand Store detecta errorCode === 'OAUTH_REQUIRED'
  ↓
Re-lanza error con code: 'OAUTH_REQUIRED'
  ↓
UI captura error.code === 'OAUTH_REQUIRED'
  ↓
✅ UI orquesta OAuth: Inicia flow y abre ventana de autorización
```

---

## 🧪 Testing y Validación

### Test Manual 1: Servidor con OAuth (Linear)

**Pasos**:
1. Asegurarse de NO tener token OAuth guardado para Linear
2. Ir a Settings > MCP Configuration
3. Ir a la Store y buscar "Linear"
4. Pulsar el switch para conectar

**Resultado esperado**:
```
[MCP] [DEBUG] Performing preliminary OAuth check (no token present)
  serverId: "linear"
  transport: "streamable-http"
  url: "https://mcp.linear.app/mcp"

[MCP] [DEBUG] Preliminary HTTP response received
  serverId: "linear"
  status: 401
  headers: { "www-authenticate": "Bearer realm=...", ... }

[MCP] [INFO] Server requires OAuth authentication (401 received)
  serverId: "linear"
  hasWWWAuth: true

[MCP] [INFO] OAuth requirement detected, throwing OAUTH_REQUIRED error
  serverId: "linear"
  note: "OAuth flow will be initiated by IPC handler"

[MCP] [INFO] OAuth required, aborting connection attempt
  serverId: "linear"
  errorCode: "OAUTH_REQUIRED"

[MCP] [ERROR] Failed to connect server
  serverId: "linear"
  errorCode: "OAUTH_REQUIRED"

✅ Toast: "Linear requires OAuth authorization"
✅ Ventana de OAuth se abre automáticamente (iniciada por el renderer/UI)
```

---

### Test Manual 2: Servidor sin OAuth (Filesystem)

**Pasos**:
1. Conectar un servidor MCP que NO requiere OAuth (ej: filesystem local)
2. Observar logs

**Resultado esperado**:
```
[MCP] [DEBUG] Performing preliminary OAuth check (no token present)
  serverId: "filesystem"
  url: "http://localhost:3000"

[MCP] [DEBUG] Preliminary HTTP response received
  serverId: "filesystem"
  status: 200

[MCP] [DEBUG] Server accessible without OAuth
  serverId: "filesystem"

[MCP] [DEBUG] Preliminary OAuth check passed, proceeding with connection
  serverId: "filesystem"

✅ Conexión exitosa sin OAuth
```

---

### Test Manual 3: Servidor con OAuth y token válido

**Pasos**:
1. Tener un token OAuth válido guardado para Linear
2. Pulsar el switch para conectar

**Resultado esperado**:
```
[CORE] [DEBUG] Using existing OAuth token for MCP connection
  serverId: "linear"
  tokenType: "Bearer"

⚠️ NO se ejecuta checkOAuthRequirement() (porque hasOAuthToken = true)

✅ Conexión exitosa con token
```

---

### Test Manual 4: Error de red en preliminary check

**Pasos**:
1. Configurar un servidor MCP con URL inválida o sin conexión
2. Pulsar el switch para conectar

**Resultado esperado**:
```
[MCP] [DEBUG] Performing preliminary OAuth check (no token present)
  serverId: "test"
  url: "https://invalid.example.com"

[MCP] [DEBUG] Preliminary OAuth check failed, continuing with normal connection
  serverId: "test"
  error: "fetch failed"

⚠️ Continúa con client.createSession() normal
❌ Error de conexión manejado por retry loop
```

---

## 📝 Checklist de Implementación

### Cambios en el Backend (Main Process)

- [ ] **Paso 1**: Añadir método `checkOAuthRequirement()` en `mcpUseService.ts`
  - [ ] Acepta `serverId`, `transportUrl`, y `baseUrl`
  - [ ] Hace petición HTTP GET a `transportUrl`
  - [ ] Extrae header `WWW-Authenticate` si recibe 401
  - [ ] Lanza error con code `OAUTH_REQUIRED` (NO inicia OAuth)
  - [ ] Maneja errores de red sin bloquear conexión

- [ ] **Paso 2**: Modificar `connectServer()` en `mcpUseService.ts`
  - [ ] Añadir flag `hasOAuthToken` después de obtener token
  - [ ] Añadir condición para HTTP-based transports (`http`, `sse`, `streamable-http`)
  - [ ] Llamar a `checkOAuthRequirement()` solo si no hay token
  - [ ] Pasar URL correcta del transport
  - [ ] Capturar y propagar error `OAUTH_REQUIRED`

- [ ] **Paso 3**: Actualizar logs en el manejo de errores OAuth (fallback)
  - [ ] Añadir nota indicando que es detección fallback
  - [ ] Loguear cuando no hay header WWW-Authenticate disponible

- [ ] **Paso 4**: Verificar IPC Handler (NO REQUIERE CAMBIOS)
  - [ ] Confirmar que `connection.ts` propaga error OAUTH_REQUIRED correctamente
  - [ ] Confirmar que NO inicia OAuth (responsabilidad del renderer)

### Testing

- [ ] **Test 1**: Verificar flujo OAuth con servidor que requiere autenticación (Linear)
  - [ ] Preflight detecta 401 con WWW-Authenticate
  - [ ] Error OAUTH_REQUIRED se lanza correctamente
  - [ ] UI muestra toast y abre ventana OAuth

- [ ] **Test 2**: Verificar conexión normal sin OAuth (Filesystem)
  - [ ] Preflight recibe 200 OK
  - [ ] Conexión procede normalmente

- [ ] **Test 3**: Verificar uso de token existente
  - [ ] NO se ejecuta preflight cuando hay token
  - [ ] Conexión exitosa con token

- [ ] **Test 4**: Verificar manejo de errores de red
  - [ ] Preflight falla sin bloquear conexión
  - [ ] Retry loop maneja el error correctamente

### Documentación

- [ ] **Comentarios**: Verificar que todos los comentarios sean claros
- [ ] **Logs**: Verificar que todos los logs sean útiles para debugging
- [ ] **Arquitectura**: Confirmar separación de responsabilidades (Backend detecta, Frontend orquesta)

---

## 🎯 Resultado Final

Después de esta implementación:

1. ✅ **El flujo OAuth se detecta proactivamente** antes de intentar conectar con mcp-use
2. ✅ **Se obtiene el header `WWW-Authenticate`** necesario para OAuth discovery desde el servidor real
3. ✅ **La ventana de OAuth se abre automáticamente** (orquestada por el renderer/UI, sin duplicación)
4. ✅ **Se evitan reintentos innecesarios** del retry loop
5. ✅ **Compatibilidad total** con servidores que NO requieren OAuth
6. ✅ **Performance óptima** cuando ya hay un token guardado (no hace petición extra)
7. ✅ **Soporta todos los transportes HTTP-based** (`http`, `sse`, `streamable-http`)
8. ✅ **Arquitectura limpia** con un único orquestador de OAuth (renderer/UI)

---

## 📚 Referencias

- **Diagnóstico completo**: `diagnostico-oauth-flow.md`
- **OAuth 2.0 RFC**: https://datatracker.ietf.org/doc/html/rfc6750 (WWW-Authenticate header)
- **Archivo afectado**: `src/main/services/mcp/mcpUseService.ts`
- **IPC Handler**: `src/main/ipc/mcpHandlers/connection.ts`
- **Zustand Store**: `src/renderer/stores/mcpStore.ts`

---

**Creado por**: Claude Code
**Fecha**: 2025-12-22
**Versión**: 1.1 (Corregido)

---

## 📝 Historial de Cambios

### v1.1 (2025-12-22)
**Correcciones aplicadas**:
1. ✅ **Transporte no limitado a 'http'**: Ahora incluye `http`, `sse`, y `streamable-http`
2. ✅ **URL exacta del transport**: Preflight usa la misma URL que mcp-use
3. ✅ **Sin duplicación de OAuth**: Solo el renderer/UI orquesta OAuth (arquitectura limpia)

### v1.0 (2025-12-22)
- Versión inicial del plan
