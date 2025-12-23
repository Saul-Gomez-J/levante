# Diagnóstico: Flujo OAuth en Levante - MCP Linear

**Fecha**: 2025-12-22
**Problema**: Cuando se intenta conectar un MCP (Linear) que requiere OAuth, el flujo OAuth se detecta pero no se completa correctamente.

---

## 📋 Logs Observados

```
[2025-12-22 18:48:59] [CORE] [DEBUG] No OAuth tokens found
  serverId: "linear"

18:48:59 [mcp-use] info: 🔄 Attempting streamable HTTP transport...
18:48:59 [mcp-use] info: Authentication required - skipping SSE fallback

[2025-12-22 18:48:59] [MCP] [DEBUG] Connection error caught
  serverId: "linear"
  errorType: "object"
  errorMessage: "Authentication required"
  errorStatus: undefined
  errorStatusCode: undefined
  errorResponseStatus: undefined
  errorKeys: ["code"]

[2025-12-22 18:48:59] [MCP] [INFO] Received 401, initiating OAuth flow
  serverId: "linear"
  url: "https://mcp.linear.app/mcp"

[2025-12-22 18:48:59] [MCP] [ERROR] Failed to connect to MCP server (mcp-use)
  serverId: "linear"
  error: "Authentication required"
  attempt: 1
  maxRetries: 3
```

---

## 🔄 Flujo Completo (Paso a Paso)

### 1. Usuario Pulsa el Switch en la Store UI

**Archivo**: `src/renderer/components/mcp/store-page/store-layout.tsx:144-195`

```typescript
const handleToggleServer = async (serverId: string) => {
  const server = activeServers.find(s => s.id === serverId);

  if (server) {
    try {
      await connectServer(server); // ← Llama al Zustand store
      toast.success(t('messages.connected', { name: server.name }));
    } catch (error: any) {
      if (error.code === 'OAUTH_REQUIRED') {
        toast.info(t('messages.oauth_required', { name: server.name }));
        return;
      }
      // ...
    }
  }
};
```

**Estado**: ✅ Funciona correctamente

---

### 2. Zustand Store llama a IPC

**Archivo**: `src/renderer/stores/mcpStore.ts:104-206`

```typescript
connectServer: async (config: MCPServerConfig) => {
  set({ isLoading: true, error: null });

  try {
    const result = await window.levante.mcp.connectServer(config); // ← IPC call

    if (result.success) {
      // Actualizar estado
    } else {
      // Verificar errorCode === 'OAUTH_REQUIRED'
      if ((result as any).errorCode === 'OAUTH_REQUIRED') {
        const enrichedError = new Error('OAuth authorization required');
        (enrichedError as any).code = 'OAUTH_REQUIRED';
        throw enrichedError; // ← Re-lanza para UI
      }
    }
  } catch (error) {
    if ((error as any).code === 'OAUTH_REQUIRED') {
      throw error; // ← Propaga a UI
    }
  }
}
```

**Estado**: ✅ Funciona correctamente (modificado en este fix)

---

### 3. IPC Handler recibe la petición

**Archivo**: `src/main/ipc/mcpHandlers/connection.ts:12-70`

```typescript
ipcMain.handle("levante/mcp/connect-server", async (_, config: MCPServerConfig) => {
  try {
    await mcpService.connectServer(config); // ← Llama al servicio MCP
    return { success: true };
  } catch (error: any) {
    logger.mcp.error("Failed to connect server", {
      serverId: config.id,
      error: error.message,
      errorCode: error.code,
    });

    // Manejar error OAuth
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

    return { success: false, error: error.message };
  }
});
```

**Estado**: ✅ Funciona correctamente (modificado en este fix)

---

### 4. Servicio MCP intenta conectar

**Archivo**: `src/main/services/mcp/mcpUseService.ts:85-290`

#### 4.1. Preparación de la conexión

```typescript
async connectServer(config: MCPServerConfig): Promise<void> {
  // 1. Normalizar configuración
  const transport = config.transport || 'http';
  const baseUrl = config.baseUrl || config.url;

  // 2. Intentar obtener token OAuth existente
  try {
    const oauthService = new OAuthService(preferencesService);
    const tokens = await oauthService.getExistingToken(config.id);

    if (tokens) {
      headers = {
        Authorization: `${tokens.tokenType} ${tokens.accessToken}`
      };
    }
  } catch (error) {
    // No hay token, continuar sin autenticación
    logger.mcp.debug("No OAuth token available");
  }

  // 3. Crear configuración del servidor
  const serverConfig = {
    transport: 'http',
    url: baseUrl,
    headers: headers
  };

  // ...
}
```

**Log observado**:
```
[CORE] [DEBUG] No OAuth tokens found
  serverId: "linear"
```

**Estado**: ✅ Funciona - No hay token, continúa sin autenticación

---

#### 4.2. Creación del cliente mcp-use

```typescript
// Retry loop para cold starts
for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
    // Crear cliente
    const clientConfig = {
      mcpServers: {
        [config.id]: serverConfig
      }
    };
    const client = new MCPClient(clientConfig, clientOptions);

    // Crear sesión con timeout
    const createSessionWithTimeout = async (timeoutMs: number) => {
      return Promise.race([
        client.createSession(config.id, true),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout - authentication may be required')), timeoutMs)
        )
      ]);
    };

    const session = await createSessionWithTimeout(10000); // 10s timeout

    // Éxito
    return;
  } catch (error) {
    // Manejo de errores...
  }
}
```

**Log observado (de mcp-use)**:
```
18:48:59 [mcp-use] info: 🔄 Attempting streamable HTTP transport...
18:48:59 [mcp-use] info: Authentication required - skipping SSE fallback
```

**Estado**: ⚠️ mcp-use detecta que se requiere autenticación internamente

---

#### 4.3. Captura del error

```typescript
} catch (error) {
  // DEBUG: Log completo del error
  this.logger.mcp.debug("Connection error caught", {
    serverId: config.id,
    errorType: typeof error,
    errorMessage: error instanceof Error ? error.message : String(error),
    errorStatus: (error as any)?.status,
    errorStatusCode: (error as any)?.statusCode,
    errorResponseStatus: (error as any)?.response?.status,
    errorKeys: error && typeof error === 'object' ? Object.keys(error) : [],
  });

  // Verificar si es error 401
  if (this.is401Error(error)) {
    // ...
  }
}
```

**Log observado**:
```
[MCP] [DEBUG] Connection error caught
  serverId: "linear"
  errorType: "object"
  errorMessage: "Authentication required"
  errorStatus: undefined
  errorStatusCode: undefined
  errorResponseStatus: undefined
  errorKeys: ["code"]
```

**Estado**: ✅ Error capturado correctamente

**Análisis**:
- El error es un objeto simple con solo una propiedad: `code`
- NO tiene `status`, `statusCode`, ni `response.status`
- El mensaje es "Authentication required"

---

#### 4.4. Detección de error 401

**Archivo**: `src/main/services/mcp/mcpUseService.ts:543-559`

```typescript
private is401Error(error: any): boolean {
  const message = error?.message && typeof error.message === 'string'
    ? error.message.toLowerCase()
    : '';

  return (
    error?.status === 401 ||                          // ❌ undefined
    error?.statusCode === 401 ||                      // ❌ undefined
    error?.response?.status === 401 ||                // ❌ undefined
    message.includes('401') ||                        // ❌ "authentication required"
    message.includes('unauthorized') ||               // ❌ "authentication required"
    // Detect mcp-use authentication patterns
    (message.includes('authentication') && (          // ✅ "authentication" found
      message.includes('required') ||                 // ✅ "required" found
      message.includes('timeout') ||
      message.includes('may be required')
    ))
  );
}
```

**Log observado**:
```
[MCP] [INFO] Received 401, initiating OAuth flow
  serverId: "linear"
  url: "https://mcp.linear.app/mcp"
```

**Estado**: ✅ Error detectado correctamente como 401

**Análisis**:
- La nueva lógica detecta el patrón "authentication" + "required"
- Se considera un error de autenticación

---

#### 4.5. Extracción del header WWW-Authenticate

**Archivo**: `src/main/services/mcp/mcpUseService.ts:564-573`

```typescript
private extractWWWAuthenticate(error: any): string | undefined {
  return (
    error?.headers?.['www-authenticate'] ||
    error?.headers?.['WWW-Authenticate'] ||
    error?.response?.headers?.['www-authenticate'] ||
    error?.response?.headers?.['WWW-Authenticate'] ||
    undefined
  );
}
```

**Problema**: El error solo tiene la propiedad `code`, NO tiene:
- `error.headers`
- `error.response.headers`

**Resultado**: `wwwAuth = undefined`

---

#### 4.6. Intento de iniciar flujo OAuth

```typescript
if (this.is401Error(error)) {
  if (!this.canAttemptOAuth(config.id)) {
    this.logger.mcp.error('Too many OAuth attempts', { serverId: config.id });
  } else {
    this.logger.mcp.info("Received 401, initiating OAuth flow", {
      serverId: config.id,
      url: baseUrl
    });

    const wwwAuth = this.extractWWWAuthenticate(error); // ← undefined

    if (wwwAuth) {  // ← ❌ FALSE
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

**Estado**: ❌ **AQUÍ ESTÁ EL PROBLEMA**

**Análisis**:
1. ✅ Se detecta que es un error 401
2. ✅ Se llama a `initiateOAuthFlow` (que emite el evento IPC)
3. ✅ Se loggea "Received 401, initiating OAuth flow"
4. ❌ **PERO** `wwwAuth` es `undefined`
5. ❌ **POR LO TANTO** NO se entra en el `if (wwwAuth)`
6. ❌ **NO SE LANZA** el error con `code: 'OAUTH_REQUIRED'`
7. ❌ El error original se propaga y se trata como un error genérico

---

#### 4.7. Propagación del error original

```typescript
lastError = error instanceof Error ? error : new Error(String(error));
const errorMessage = lastError.message; // "Authentication required"

// Retry logic
if (attempt < maxRetries && isRetryable) {
  // Reintentar...
} else {
  this.logger.mcp.error("Failed to connect to MCP server (mcp-use)", {
    serverId: config.id,
    error: errorMessage,
    attempt,
    maxRetries,
  });
  throw lastError; // ← Lanza error original, NO el error OAuth
}
```

**Log observado**:
```
[MCP] [ERROR] Failed to connect to MCP server (mcp-use)
  serverId: "linear"
  error: "Authentication required"
  attempt: 1
  maxRetries: 3
```

**Estado**: ❌ Error original se propaga sin información de OAuth

---

### 5. El error vuelve al IPC Handler

**Archivo**: `src/main/ipc/mcpHandlers/connection.ts:37-68`

```typescript
} catch (error: any) {
  logger.mcp.error("Failed to connect server", {
    serverId: config.id,
    error: error.message,
    errorCode: error.code,  // ← ¿Qué valor tiene?
  });

  if (error.code === 'OAUTH_REQUIRED') {  // ← ❌ NO se cumple
    return {
      success: false,
      errorCode: 'OAUTH_REQUIRED',
      metadata: { ... }
    };
  }

  // Error genérico
  return { success: false, error: error.message };
}
```

**Problema**: El error NO tiene `code: 'OAUTH_REQUIRED'` porque nunca se lanzó ese error en el servicio MCP.

---

## 🔍 Resumen del Problema

### Flujo Actual

```
Usuario pulsa switch
  ↓
Zustand Store → window.levante.mcp.connectServer()
  ↓
IPC Handler → mcpService.connectServer()
  ↓
MCPUseService:
  1. ✅ No hay token OAuth → continúa sin auth
  2. ✅ Crea MCPClient y llama createSession()
  3. ⚠️  mcp-use detecta internamente "Authentication required"
  4. ✅ mcp-use lanza error { message: "Authentication required", code: "..." }
  5. ✅ Error es capturado en catch
  6. ✅ is401Error() detecta el patrón "authentication required"
  7. ✅ Se loggea "Received 401, initiating OAuth flow"
  8. ✅ Se llama initiateOAuthFlow() (emite evento IPC al renderer)
  9. ❌ extractWWWAuthenticate() devuelve undefined
  10. ❌ if (wwwAuth) → FALSE
  11. ❌ NO se lanza error { code: 'OAUTH_REQUIRED' }
  12. ❌ Se propaga error original sin código OAuth
  ↓
IPC Handler:
  13. ❌ error.code !== 'OAUTH_REQUIRED'
  14. ❌ Devuelve { success: false, error: "Authentication required" }
  ↓
Zustand Store:
  15. ❌ errorCode no está presente en respuesta
  16. ❌ NO se re-lanza como error OAuth
  ↓
UI Handler:
  17. ❌ NO recibe ningún error (se swallowea en el store)
  18. ❌ Usuario no ve feedback
```

---

## 🐛 Causas Identificadas

### Causa Principal

**El error de mcp-use NO incluye el header `WWW-Authenticate`**, por lo que:
1. `extractWWWAuthenticate()` devuelve `undefined`
2. El código NO lanza el error `{ code: 'OAUTH_REQUIRED' }`
3. El flujo OAuth se detecta pero NO se completa

### Causa Secundaria: ¿Por qué no hay header?

**mcp-use está detectando que se requiere autenticación ANTES de hacer la petición HTTP real al servidor**:

```
18:48:59 [mcp-use] info: 🔄 Attempting streamable HTTP transport...
18:48:59 [mcp-use] info: Authentication required - skipping SSE fallback
```

Esto significa que:
- mcp-use NO está haciendo una petición HTTP GET al servidor
- Por lo tanto, el servidor NUNCA responde con un 401 + header WWW-Authenticate
- mcp-use está siendo "inteligente" y detectando la falta de autenticación internamente

**¿Cómo lo detecta?**
- Probablemente revisa la configuración del servidor
- Ve que el servidor requiere OAuth (basado en metadata del registry o configuración)
- Decide NO intentar SSE porque sabe que fallará
- Lanza un error genérico sin los headers HTTP reales

---

## 💡 Posibles Soluciones

### Solución 1: Hacer petición HTTP manual para obtener el header

**Antes de llamar a `client.createSession()`**, hacer una petición HTTP GET manual al servidor:

```typescript
// En mcpUseService.ts, antes del retry loop
if (finalTransport === 'http' && !headers.Authorization) {
  // Hacer petición manual para forzar 401 con WWW-Authenticate
  try {
    const response = await fetch(baseUrl, { method: 'GET' });
    if (response.status === 401) {
      const wwwAuth = response.headers.get('WWW-Authenticate');
      if (wwwAuth) {
        // Tenemos el header, iniciar OAuth
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
  } catch (error) {
    // Si es error de red, continuar con createSession()
  }
}
```

**Pros**:
- Obtenemos el header WWW-Authenticate real del servidor
- OAuth discovery funciona correctamente
- Sigue el estándar OAuth 2.0

**Contras**:
- Petición HTTP adicional (latencia)
- Duplica lógica de detección de autenticación

---

### Solución 2: Iniciar OAuth sin el header WWW-Authenticate

**Modificar el código para iniciar OAuth incluso sin el header**, asumiendo que el mcpServerUrl es también el servidor de autorización:

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

    // Iniciar OAuth SIEMPRE, incluso sin header
    await this.initiateOAuthFlow(config.id, baseUrl, wwwAuth);

    throw {
      code: 'OAUTH_REQUIRED',
      message: 'OAuth authorization required',
      serverId: config.id,
      mcpServerUrl: baseUrl,
      wwwAuth: wwwAuth || undefined
    };
  }
}
```

**Pros**:
- Sin latencia adicional
- Funciona para servidores MCP modernos (donde mcpServerUrl === authServerUrl)

**Contras**:
- NO sigue el estándar OAuth 2.0 estrictamente
- Podría iniciar OAuth para errores que NO son de autenticación
- El discovery service debe manejar casos sin WWW-Authenticate

---

### Solución 3: Configurar mcp-use para intentar conexión completa

**Investigar si mcp-use tiene alguna opción de configuración** para forzar el intento de conexión HTTP completo en lugar de "skip SSE fallback".

**Pros**:
- Sigue el flujo estándar
- Obtenemos el 401 real con headers

**Contras**:
- Requiere investigar documentación/código de mcp-use
- Puede que no exista tal configuración

---

## 📊 Archivos Involucrados

### Backend (Main Process)

1. **`src/main/services/mcp/mcpUseService.ts`**
   - Líneas 85-290: Método `connectServer()`
   - Líneas 543-559: Método `is401Error()`
   - Líneas 564-573: Método `extractWWWAuthenticate()`
   - **Problema**: No lanza error `OAUTH_REQUIRED` sin header WWW-Authenticate

2. **`src/main/ipc/mcpHandlers/connection.ts`**
   - Líneas 12-70: Handler `levante/mcp/connect-server`
   - **Estado**: Funciona correctamente (modificado)

3. **`src/main/services/oauth/OAuthService.ts`**
   - Método `getExistingToken()`: Busca tokens existentes
   - **Estado**: Funciona correctamente

### Frontend (Renderer Process)

4. **`src/renderer/stores/mcpStore.ts`**
   - Líneas 104-206: Método `connectServer()`
   - **Estado**: Funciona correctamente (modificado)

5. **`src/renderer/components/mcp/store-page/store-layout.tsx`**
   - Líneas 144-195: Handler `handleToggleServer()`
   - **Estado**: Funciona correctamente (modificado)

### Librería Externa

6. **`mcp-use` (node_modules)**
   - Detecta internamente "Authentication required"
   - Lanza error sin headers HTTP
   - **Problema**: No hace petición HTTP real para obtener 401 + WWW-Authenticate

---

## 🎯 Recomendación

**Opción recomendada**: **Solución 1** (Petición HTTP manual)

**Razones**:
1. ✅ Sigue el estándar OAuth 2.0
2. ✅ Obtenemos el header WWW-Authenticate real
3. ✅ OAuth discovery funciona correctamente
4. ✅ Distingue entre errores de auth OAuth vs otros errores
5. ⚠️  Latencia adicional aceptable (solo cuando no hay token)

**Implementación**:
- Agregar petición HTTP manual ANTES del retry loop
- Solo si `transport === 'http'` y NO hay `Authorization` header
- Si devuelve 401 con WWW-Authenticate, iniciar flujo OAuth inmediatamente
- Si no, continuar con `client.createSession()` normal

---

## 📝 Conclusión

El flujo OAuth se está detectando correctamente, pero **se interrumpe porque el error de mcp-use no incluye el header `WWW-Authenticate`**, que es necesario para:
1. Extraer la URL del servidor de autorización
2. Completar el OAuth discovery
3. Iniciar el flujo de autorización correctamente

La solución requiere **forzar una petición HTTP real al servidor** para obtener el 401 con el header completo, en lugar de confiar en la detección interna de mcp-use.
