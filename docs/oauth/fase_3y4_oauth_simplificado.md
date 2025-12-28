# Plan Simplificado: Fases 3 y 4 - OAuth Private Client Support

> Análisis de lo que realmente se necesita implementar para las fases 3 y 4 del soporte para clientes privados OAuth.

## Estado Actual (Post Fases 1 y 2)

### ✅ Fase 1 Completada
- `OAuthDiscoveryService.registerClient()` acepta `ClientRegistrationOptions` con `preferConfidential` y `tokenEndpointAuthMethod`
- DCR puede solicitar registro como cliente confidencial con `client_secret`

### ✅ Fase 2 Completada
- Función `applyClientAuthentication()` en `OAuthFlowManager.ts` implementa:
  - `client_secret_post` (credenciales en body)
  - `client_secret_basic` (HTTP Basic Auth)
- `exchangeCodeForTokens()`, `refreshAccessToken()` y `revokeToken()` soportan ambos métodos

---

## Análisis de Fases 3 y 4

### Fase 3: Credenciales Manuales (Skip DCR)

**Objetivo original**: Permitir configurar `client_id` y `client_secret` manualmente.

**Conclusión**: ❌ **NO NECESARIO**

**Razón**: No hay UI para que el usuario introduzca credenciales manualmente, y no se planea añadir por ahora.

---

### Fase 4: Credenciales Pre-configuradas

**Objetivo original**: Detectar credenciales pre-configuradas en el archivo JSON.

**Conclusión**: ❌ **NO NECESARIO**

**Razón**: No se va a dar el caso de que el usuario edite manualmente el archivo `ui-preferences.json` para añadir credenciales.

---

## Lo Que Ya Funciona

El código actual ya soporta la **reutilización de credenciales del DCR**:

```typescript
// En OAuthService.authorize() - Ya implementado
const existingCredentials = await this.getClientCredentials(serverId);

if (existingCredentials && this.isClientSecretValid(existingCredentials)) {
    // ✅ Reutiliza credenciales del DCR anterior
    clientId = existingCredentials.clientId;
    clientSecret = existingCredentials.clientSecret;
    tokenEndpointAuthMethod = existingCredentials.tokenEndpointAuthMethod ?? 'none';
    // NO hace DCR de nuevo
}
```

### Flujo Actual

```
┌─────────────────────────────────────────────────────────────┐
│                   PRIMERA CONEXIÓN                          │
├─────────────────────────────────────────────────────────────┤
│ 1. Discovery del Authorization Server                       │
│ 2. DCR (Dynamic Client Registration)                        │
│    → Obtiene client_id + client_secret (si confidential)   │
│ 3. Guardar credenciales en preferences (encriptadas)        │
│ 4. Authorization Code Flow + PKCE                           │
│ 5. Token Exchange (usa auth method del DCR)                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  CONEXIONES SIGUIENTES                      │
├─────────────────────────────────────────────────────────────┤
│ 1. getClientCredentials() → Recupera credenciales guardadas │
│ 2. ✅ Skip DCR (ya tenemos client_id + client_secret)       │
│ 3. Authorization Code Flow + PKCE                           │
│ 4. Token Exchange (usa auth method guardado)                │
└─────────────────────────────────────────────────────────────┘
```

---

## Resumen

| Fase | Descripción | Estado |
|------|-------------|--------|
| 1 | DCR con cliente confidencial | ✅ Implementada |
| 2 | HTTP Basic Auth (`client_secret_basic`) | ✅ Implementada |
| 3 | Credenciales manuales (skip DCR) | ⏸️ No necesario (sin UI) |
| 4 | Credenciales pre-configuradas | ⏸️ No necesario (sin caso de uso) |

**No hay cambios pendientes de implementar.** Las fases 1 y 2 cubren completamente el soporte para clientes confidenciales:

1. ✅ DCR puede registrar clientes confidenciales
2. ✅ Las credenciales se guardan encriptadas
3. ✅ Las credenciales se reutilizan en conexiones futuras (skip DCR)
4. ✅ Soporta `client_secret_post` y `client_secret_basic`

---

## Trabajo Futuro (Si Se Necesita)

Si en el futuro se añade una UI para configurar credenciales manualmente:

1. Añadir campos en la UI de configuración del servidor MCP
2. Añadir handler IPC `levante/oauth/configure-credentials`
3. Implementar `getPreConfiguredCredentials()` para detectar credenciales manuales

Pero esto queda fuera del alcance actual.

---

**Creado**: 2025-12-28
**Basado en**: PLAN-private-client-support.md v1.0.0
