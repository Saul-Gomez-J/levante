# Diagnóstico: OAuth Connection Issue - Linear MCP Server

**Fecha:** 2025-12-23 10:51
**Servidor:** linear
**Estado:** OAuth exitoso, pero conexión MCP falla con 401

## Resumen

La autenticación OAuth con Linear se completó exitosamente:
- ✅ Authorization flow completado
- ✅ Tokens recibidos y guardados
- ✅ Token no expirado
- ✅ Refresh token disponible

Sin embargo, cuando `mcp-use` intenta conectarse al servidor MCP usando HTTP transport, obtiene error 401 "Authentication required".

## Logs Relevantes

### 1. OAuth Exitoso
```
[10:50:36] [CORE] [INFO] Tokens received
  serverId: "linear"
  expiresAt: "2025-12-30T09:50:36.977Z"

[10:50:37] [CORE] [INFO] OAuth authorization flow completed successfully
  serverId: "linear"
```

### 2. Token Recuperado Correctamente
```
[10:50:37] [CORE] [DEBUG] OAuth tokens retrieved
  serverId: "linear"
  hasRefreshToken: true
  isExpired: false
```

### 3. Conexión MCP Falla con 401
```
[10:50:45] [MCP] [INFO] Attempting to connect to server (mcp-use)
  serverId: "linear"
  transport: "http"
  codeMode: true
  executor: "vm"

[10:50:45] [MCP] [DEBUG] Using existing OAuth token
  serverId: "linear"

10:50:45 [mcp-use] info: 🔄 Attempting streamable HTTP transport...
10:50:45 [mcp-use] info: Authentication required - skipping SSE fallback

[10:50:45] [MCP] [DEBUG] Connection error caught
  serverId: "linear"
  errorType: "object"
  errorMessage: "Authentication required"
  errorKeys: ["code"]

[10:50:45] [MCP] [ERROR] Too many OAuth attempts
  serverId: "linear"

[10:50:45] [MCP] [ERROR] Failed to connect to MCP server (mcp-use)
  serverId: "linear"
  error: "Authentication required"
  attempt: 1
  maxRetries: 3
```

## Análisis del Problema

### Síntomas
1. OAuth tokens se guardan y recuperan correctamente
2. Log dice "Using existing OAuth token" - sugiere que se detecta el token
3. Pero `mcp-use` reporta "Authentication required" - sugiere que el token NO se está pasando en la request HTTP
4. El error ocurre inmediatamente (sin retries efectivos)

### Causa Probable
El token OAuth no se está pasando correctamente como header de autenticación al hacer la request HTTP al servidor MCP de Linear.

**Posibles causas específicas:**
1. Los headers OAuth no se están configurando en el HTTPClient de mcp-use
2. El formato del header `Authorization` es incorrecto
3. mcp-use no está recibiendo la configuración de OAuth headers
4. El token está en formato incorrecto (debería ser `Bearer <token>`)

### Próximos Pasos

1. **Verificar configuración de headers OAuth en mcpUseService.ts**
   - Revisar cómo se pasan los headers OAuth a mcp-use
   - Confirmar que se usa el formato `Authorization: Bearer <access_token>`

2. **Añadir logging detallado**
   - Log de los headers que se están enviando (sin mostrar el token completo)
   - Log del formato del token antes de enviarlo

3. **Verificar integración con mcp-use**
   - Revisar documentación de mcp-use para OAuth headers
   - Confirmar que mcp-use soporta OAuth para HTTP transport

4. **Test manual con curl**
   - Probar request manual al endpoint de Linear con el token
   - Verificar que el token sea válido fuera de la aplicación

## Ubicación del Código Relevante

- `src/main/services/mcp/mcpUseService.ts` - Configuración de conexión y headers
- `src/main/services/oauth/OAuthHttpClient.ts` - Obtención de auth headers
- `src/main/services/oauth/OAuthService.ts` - Gestión de tokens

## Notas Adicionales

- El mensaje "Too many OAuth attempts" sugiere que hay una lógica de retry que detecta OAuth failures
- Sin embargo, solo hace 1 intento antes de fallar (attempt: 1, maxRetries: 3)
- Esto sugiere que el código detecta que es un problema de OAuth y evita hacer retries innecesarios
