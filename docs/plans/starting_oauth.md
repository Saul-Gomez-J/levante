# Plan de Implementación: OAuth Automático basado en 401

## Versión: 1.0
## Fecha: 2025-12-22
## Estado: Propuesta

---

## 📋 Resumen Ejecutivo

### Objetivo Principal
Transformar el flujo OAuth de Levante para que sea **completamente automático y transparente**, eliminando toda configuración manual y activándose únicamente cuando el servidor MCP responde con un error 401 que incluye información OAuth en el header `WWW-Authenticate`.

### Cambios Clave

1. ✅ **Eliminar configuración manual de OAuth**: No más campos `oauth` en la configuración de MCPs
2. ✅ **Activación automática por 401**: El flujo OAuth se inicia solo cuando se detecta autenticación requerida
3. ✅ **Formato unificado**: MCPs con y sin OAuth tienen el mismo formato de configuración
4. ✅ **Experiencia sin fricción**: El usuario no necesita saber si un MCP requiere OAuth hasta que se necesite

---

## 🎯 Flujo Propuesto

### Estado Actual (A Eliminar)
```
Usuario instala MCP → Detecta oauth.enabled = true → Abre dialog → Usuario configura → Autoriza
```

### Nuevo Flujo (A Implementar)
```
Usuario instala MCP → Conexión directa → ¿401 con WWW-Authenticate?
                                                    ↓
                                                  [SÍ]
                                                    ↓
1. Extraer URL OAuth del header
2. Guardar contexto (serverId, mcpServerUrl)
3. Notificar al frontend (via IPC event)
4. Frontend abre OAuthConnectionDialog automáticamente
5. Usuario autoriza en el navegador
6. Token guardado → Reconexión automática
```

---

## 📁 Archivos a Modificar

### **FASE 1: Backend - Interceptación de 401**

#### 1.1. `src/main/services/mcp/mcpUseService.ts`

**Líneas afectadas**: 84-177 (método `connectServer`)

**Cambios necesarios**:

```typescript
// ❌ ELIMINAR (líneas 137-150):
// Phase 4: Handle OAuth
if (config.oauth?.enabled) {
  try {
    this.logger.mcp.debug("Ensuring valid OAuth token for mcp-use", {
      serverId: config.id,
    });
    const oauthService = new OAuthService(new PreferencesService());
    const tokens = await oauthService.ensureValidToken(config.id);

    headers = {
      ...headers,
      Authorization: `${tokens.tokenType} ${tokens.accessToken}`,
    };
  } catch (error) {
    // ...
  }
}

// ✅ AGREGAR:
// Phase 4 (NUEVO): Intentar obtener token OAuth si existe (sin forzar)
try {
  const preferencesService = new PreferencesService();
  await preferencesService.initialize();
  const oauthService = new OAuthService(preferencesService);

  // Solo si ya existe un token válido, inyectarlo
  const tokens = await oauthService.getExistingToken(config.id);
  if (tokens) {
    this.logger.mcp.debug("Using existing OAuth token", { serverId: config.id });
    headers = {
      ...headers,
      Authorization: `${tokens.tokenType} ${tokens.accessToken}`,
    };
  }
} catch (error) {
  // No hay token, continuar sin OAuth (el 401 lo activará si es necesario)
  this.logger.mcp.debug("No OAuth token available, will connect without auth", {
    serverId: config.id
  });
}
```

**Agregar manejo de 401 en `connectServer`**:

```typescript
// ✅ AGREGAR después de línea 177:
try {
  const client = new MCPClient(serverConfig, clientOptions);
  await client.connect();

  this.clients.set(config.id, client);
  this.sessions.set(config.id, client.session);

  this.logger.mcp.info("Successfully connected to server (mcp-use)", {
    serverId: config.id,
  });

} catch (error: any) {
  // ✅ NUEVO: Detectar 401 y activar flujo OAuth
  if (this.is401Error(error)) {
    this.logger.mcp.info("Received 401, initiating OAuth flow", {
      serverId: config.id,
      url: baseUrl
    });

    // Extraer WWW-Authenticate header del error
    const wwwAuth = this.extractWWWAuthenticate(error);

    if (wwwAuth) {
      // Emitir evento para que el frontend abra el dialog
      await this.initiateOAuthFlow(config.id, baseUrl, wwwAuth);

      // Lanzar error específico para que el frontend sepa que OAuth está en proceso
      throw {
        code: 'OAUTH_REQUIRED',
        message: 'OAuth authorization required',
        serverId: config.id,
        mcpServerUrl: baseUrl,
        wwwAuth
      };
    }
  }

  // Re-throw otros errores
  throw error;
}
```

**Nuevos métodos a agregar**:

```typescript
/**
 * Detecta si un error es un 401 Unauthorized
 */
private is401Error(error: any): boolean {
  // Verificar diferentes formatos de error según transporte
  return (
    error?.status === 401 ||
    error?.statusCode === 401 ||
    error?.response?.status === 401 ||
    (error?.message && error.message.includes('401')) ||
    (error?.message && error.message.toLowerCase().includes('unauthorized'))
  );
}

/**
 * Extrae el header WWW-Authenticate del error
 */
private extractWWWAuthenticate(error: any): string | undefined {
  // Intentar extraer de diferentes ubicaciones según el transporte
  return (
    error?.headers?.['www-authenticate'] ||
    error?.headers?.['WWW-Authenticate'] ||
    error?.response?.headers?.['www-authenticate'] ||
    error?.response?.headers?.['WWW-Authenticate'] ||
    undefined
  );
}

/**
 * Inicia el flujo OAuth notificando al frontend
 */
private async initiateOAuthFlow(
  serverId: string,
  mcpServerUrl: string,
  wwwAuth: string
): Promise<void> {
  const { BrowserWindow } = await import('electron');
  const mainWindow = BrowserWindow.getAllWindows()[0];

  if (mainWindow) {
    // Enviar evento al renderer para abrir el dialog
    mainWindow.webContents.send('levante/oauth/required', {
      serverId,
      mcpServerUrl,
      wwwAuth
    });
  }
}
```

---

#### 1.2. `src/main/services/mcp/mcpLegacyService.ts`

**Cambios similares** a mcpUseService.ts para mantener paridad entre ambas implementaciones.

**Ubicación**: Método `connectServer` (buscar línea similar a la configuración de OAuth)

**Aplicar los mismos cambios**:
- Eliminar verificación de `config.oauth?.enabled`
- Agregar lógica de detección de 401
- Agregar métodos `is401Error`, `extractWWWAuthenticate`, `initiateOAuthFlow`

---

#### 1.3. `src/main/services/oauth/OAuthService.ts`

**Nuevo método a agregar** (después de línea 100):

```typescript
/**
 * Obtiene un token existente sin forzar autorización
 * Retorna null si no hay token o está expirado
 */
async getExistingToken(serverId: string): Promise<OAuthTokens | null> {
  try {
    const tokens = await this.tokenStore.getTokens(serverId);

    if (!tokens) {
      return null;
    }

    // Si está expirado pero tiene refresh token, intentar refrescar
    if (this.tokenStore.isTokenExpired(tokens) && tokens.refreshToken) {
      this.logger.core.debug('Token expired, attempting refresh', { serverId });
      return await this.httpClient.refreshToken(serverId);
    }

    return tokens;
  } catch (error) {
    this.logger.core.debug('No existing token available', {
      serverId,
      error: error instanceof Error ? error.message : error
    });
    return null;
  }
}

/**
 * Obtiene el token válido o lanza error (usado internamente)
 */
async ensureValidToken(serverId: string): Promise<OAuthTokens> {
  const token = await this.getExistingToken(serverId);

  if (!token) {
    throw new Error(`No valid OAuth token for server: ${serverId}`);
  }

  return token;
}
```

**Modificar método `authorize`** (línea 70-145):

```typescript
// ✅ AGREGAR parámetro opcional wwwAuthHeader
async authorize(params: AuthorizeParams & { wwwAuthHeader?: string }): Promise<AuthorizeResult> {
  const {
    serverId,
    mcpServerUrl,
    scopes = ['mcp:read', 'mcp:write'],
    clientId: providedClientId,
    wwwAuthHeader, // ✅ NUEVO
  } = params;

  logger.core.info('Starting OAuth authorization flow', {
    serverId,
    mcpServerUrl,
    hasProvidedClientId: !!providedClientId,
    hasWWWAuth: !!wwwAuthHeader,
  });

  try {
    // Step 1: Discovery of Authorization Server
    logger.core.debug('Step 1: Discovering authorization server', {
      serverId,
    });

    // ✅ MODIFICAR: Pasar wwwAuthHeader al discovery
    const { authorizationServer: authServerId, metadata } =
      await this.discoveryService.discoverFromUnauthorized(
        mcpServerUrl,
        wwwAuthHeader // ✅ NUEVO parámetro
      );

    // ... resto del método sin cambios
  }
}
```

---

#### 1.4. `src/main/services/oauth/OAuthHttpClient.ts`

**Hacer público el método `refreshToken`** (línea 134):

```typescript
// ❌ CAMBIAR de:
private async refreshToken(

// ✅ A:
async refreshToken(
  serverId: string,
  oldTokens?: OAuthTokens // ✅ Hacer opcional para uso externo
): Promise<OAuthTokens> {
  // ✅ AGREGAR al inicio:
  if (!oldTokens) {
    oldTokens = await this.tokenStore.getTokens(serverId);
    if (!oldTokens) {
      throw this.createError(
        'NO_TOKENS',
        'No tokens available to refresh',
        { serverId }
      );
    }
  }

  // ... resto del método sin cambios
}
```

---

#### 1.5. `src/main/ipc/oauthHandlers.ts`

**Modificar `handleAuthorize`** (línea 77-110):

```typescript
async function handleAuthorize(
  _event: any,
  params: {
    serverId: string;
    mcpServerUrl: string;
    scopes?: string[];
    clientId?: string;
    wwwAuthHeader?: string; // ✅ NUEVO
  }
) {
  await initializeServices();

  try {
    logger.core.info('IPC: Starting OAuth authorization', {
      serverId: params.serverId,
      url: params.mcpServerUrl,
      hasWWWAuth: !!params.wwwAuthHeader,
    });

    const result = await oauthService.authorize({
      serverId: params.serverId,
      mcpServerUrl: params.mcpServerUrl,
      scopes: params.scopes || ['mcp:read', 'mcp:write'],
      clientId: params.clientId,
      wwwAuthHeader: params.wwwAuthHeader, // ✅ NUEVO
    });

    if (result.success) {
      return {
        success: true,
        data: result.tokens,
      };
    } else {
      return {
        success: false,
        error: result.error || 'Authorization failed',
      };
    }
  } catch (error) {
    logger.core.error('OAuth authorization failed', {
      serverId: params.serverId,
      error: error instanceof Error ? error.message : error,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

---

### **FASE 2: Frontend - Manejo de Eventos 401**

#### 2.1. `src/preload/api/app.ts`

**Agregar nuevo listener** (después de las definiciones existentes):

```typescript
// ✅ AGREGAR:
export const oauth = {
  // Métodos existentes...
  authorize: (params: {
    serverId: string;
    mcpServerUrl: string;
    scopes?: string[];
    clientId?: string;
    wwwAuthHeader?: string; // ✅ NUEVO
  }) =>
    ipcRenderer.invoke('levante/oauth/authorize', params),

  // ... otros métodos sin cambios

  // ✅ NUEVO: Escuchar evento de OAuth requerido
  onOAuthRequired: (
    callback: (data: {
      serverId: string;
      mcpServerUrl: string;
      wwwAuth: string;
    }) => void
  ) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('levante/oauth/required', handler);

    // Retornar función de cleanup
    return () => {
      ipcRenderer.removeListener('levante/oauth/required', handler);
    };
  }
};
```

---

#### 2.2. `src/preload/preload.ts`

**Verificar exportación** del nuevo método `onOAuthRequired`:

```typescript
// Asegurar que oauth esté expuesto en el contextBridge
contextBridge.exposeInMainWorld('levante', {
  // ... otros métodos
  oauth: {
    authorize: appApi.oauth.authorize,
    disconnect: appApi.oauth.disconnect,
    status: appApi.oauth.status,
    refresh: appApi.oauth.refresh,
    list: appApi.oauth.list,
    onOAuthRequired: appApi.oauth.onOAuthRequired, // ✅ AGREGAR
    // ... OpenRouter methods
  }
});
```

---

#### 2.3. `src/renderer/stores/oauthStore.ts`

**Agregar método para manejar OAuth requerido** (después de línea 230):

```typescript
// ✅ AGREGAR nuevo método en el store:
export const useOAuthStore = create<OAuthState>((set, get) => ({
  // ... estado y métodos existentes

  /**
   * Handle OAuth required event from backend (401 detected)
   */
  handleOAuthRequired: async (params: {
    serverId: string;
    mcpServerUrl: string;
    wwwAuth: string;
  }) => {
    const { serverId, mcpServerUrl, wwwAuth } = params;

    console.log('[OAuth] OAuth required for server:', serverId);

    // Disparar el authorize directamente con el wwwAuth header
    await get().authorize({
      serverId,
      mcpServerUrl,
      wwwAuthHeader: wwwAuth,
    });
  },
}));

// ✅ AGREGAR listener global fuera del store
if (typeof window !== 'undefined' && window.levante?.oauth) {
  // Configurar listener global para eventos de OAuth requerido
  window.levante.oauth.onOAuthRequired((data) => {
    // Obtener el store y llamar al handler
    useOAuthStore.getState().handleOAuthRequired(data);
  });
}
```

**Modificar método `authorize`** para aceptar `wwwAuthHeader`:

```typescript
authorize: async (params: {
  serverId: string;
  mcpServerUrl: string;
  scopes?: string[];
  clientId?: string;
  wwwAuthHeader?: string; // ✅ AGREGAR
}) => {
  const { serverId } = params;

  set((state) => ({
    loading: { ...state.loading, [serverId]: true },
    errors: { ...state.errors, [serverId]: null },
  }));

  try {
    const result = await window.levante.oauth.authorize(params); // ✅ Pasa wwwAuthHeader

    if (!result.success) {
      throw new Error(result.error || 'Authorization failed');
    }

    // Refresh status after authorization
    await get().refreshStatus(serverId);
  } catch (error) {
    // ... manejo de errores
  }
},
```

---

#### 2.4. `src/renderer/components/mcp/store-page/store-layout.tsx`

**ELIMINAR toda lógica de OAuth en instalación** (líneas 111-121, 282-310):

```typescript
// ❌ ELIMINAR estado oauthDialogState (líneas 111-121):
const [oauthDialogState, setOauthDialogState] = useState<{
  isOpen: boolean;
  serverId: string;
  mcpServerUrl: string;
  clientId?: string;
  scopes?: string[];
}>({
  isOpen: false,
  serverId: '',
  mcpServerUrl: '',
});

// ❌ ELIMINAR verificación de OAuth (líneas 281-310):
// Check for OAuth configuration
if (registryEntry.configuration?.template?.oauth) {
  serverConfig.oauth = {
    enabled: registryEntry.configuration.template.oauth.enabled,
    clientId: registryEntry.configuration.template.oauth.clientId,
    clientSecret: registryEntry.configuration.template.oauth.clientSecret,
    scopes: registryEntry.configuration.template.oauth.scopes,
  };
}

// ... guardar servidor

// Check if OAuth is required and supported (HTTP-based)
if (serverConfig.oauth?.enabled && transportType !== 'stdio') {
  setOauthDialogState({
    isOpen: true,
    serverId: entryId,
    mcpServerUrl: serverConfig.url || '',
    clientId: serverConfig.oauth.clientId,
    scopes: serverConfig.oauth.scopes
  });

  setInstallingServerId(null);
  return;
}

// ❌ ELIMINAR componente OAuthConnectionDialog del render (líneas 818-841):
<OAuthConnectionDialog
  open={oauthDialogState.isOpen}
  onOpenChange={(open) => setOauthDialogState(prev => ({ ...prev, isOpen: open }))}
  serverId={oauthDialogState.serverId}
  mcpServerUrl={oauthDialogState.mcpServerUrl}
  onSuccess={async () => {
    // ...
  }}
/>
```

**Simplificar instalación**:

```typescript
// ✅ SIMPLIFICAR handleAddToActive (eliminar lógica OAuth):
const handleAddToActive = async (entryId: string, apiKeyValues?: Record<string, string>) => {
  const registryEntry = getRegistryEntryById(entryId);
  if (!registryEntry) return;

  // ... lógica existente de campos y construcción de serverConfig

  // ❌ ELIMINAR todo el bloque de OAuth (líneas 281-310)

  // ✅ Guardar directo y conectar
  await addServer(serverConfig);
  await loadActiveServers();

  // Intentar conectar (si falla con 401, el flujo OAuth se activará automáticamente)
  const toastId = toast.loading(t('messages.connecting', { name: registryEntry.name }));

  try {
    await connectServer(serverConfig);
    toast.success(t('messages.added', { name: registryEntry.name }), { id: toastId });
  } catch (connectError: any) {
    // ✅ NUEVO: Manejar error de OAuth requerido
    if (connectError.code === 'OAUTH_REQUIRED') {
      toast.info('OAuth authorization required. Please check the authorization dialog.', {
        id: toastId
      });
      // El flujo OAuth ya se activó automáticamente
      return;
    }

    // Otros errores
    logger.mcp.warn('Server added but connection failed', {
      serverId: entryId,
      error: connectError.message
    });

    toast.warning(t('messages.added_not_connected', { name: registryEntry.name }), {
      id: toastId
    });
  } finally {
    setInstallingServerId(null);
  }
};
```

---

#### 2.5. `src/renderer/components/oauth/OAuthConnectionDialog.tsx`

**Modificar para usar el evento automático**:

El componente se mantiene casi igual, pero ahora:
- Se abre automáticamente desde el `oauthStore` cuando se recibe el evento
- Ya no se abre manualmente desde la instalación de MCPs

**Agregar integración con el store** (al inicio del componente):

```typescript
export function OAuthConnectionDialog() {
  // ✅ CAMBIAR: Ya no recibe props, todo viene del store
  const { servers, authorize, clearError } = useOAuthStore();

  // ✅ NUEVO: Estado local para controlar el dialog
  const [pendingAuth, setPendingAuth] = useState<{
    serverId: string;
    mcpServerUrl: string;
    wwwAuth?: string;
  } | null>(null);

  // ✅ NUEVO: Escuchar eventos de OAuth requerido
  useEffect(() => {
    const cleanup = window.levante.oauth.onOAuthRequired((data) => {
      setPendingAuth({
        serverId: data.serverId,
        mcpServerUrl: data.mcpServerUrl,
        wwwAuth: data.wwwAuth
      });
    });

    return cleanup;
  }, []);

  // ... resto del componente adaptado para usar pendingAuth
}
```

---

### **FASE 3: Tipos y Configuración**

#### 3.1. `src/renderer/types/mcp.ts`

**ELIMINAR campo `oauth`** de las interfaces:

```typescript
// ❌ ELIMINAR de MCPRegistryEntry (líneas 105-110):
oauth?: {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
};

// ❌ ELIMINAR de MCPServerConfig (líneas 161-167):
oauth?: {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  authServerId?: string;
  scopes?: string[];
};
```

**Nota**: Los campos OAuth internos del backend (en preferences y token store) se mantienen, solo se eliminan de las interfaces de configuración de usuario.

---

#### 3.2. `src/types/preferences.ts`

**Mantener estructura interna de OAuth** (no modificar):

```typescript
// ✅ MANTENER - estructura interna para tokens y config
export interface OAuthServerConfig {
  authServerId: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
}

// Esta estructura NO es visible para el usuario en la configuración de MCPs
```

---

### **FASE 4: Componentes de UI**

#### 4.1. `src/renderer/components/oauth/OAuthStatusIndicator.tsx`

**Sin cambios** - Sigue funcionando igual mostrando el estado de servidores con OAuth activo.

---

#### 4.2. `src/renderer/components/oauth/OAuthPermissionsView.tsx`

**Sin cambios** - Sigue mostrando permisos y permitiendo gestión de tokens.

---

#### 4.3. `src/renderer/components/settings/MCPSection.tsx`

**Mantener sección de OAuth** para gestión, pero simplificar:

```typescript
// ✅ MANTENER la vista de permisos OAuth
{oauthServerIds.length > 0 && (
  <div className="space-y-4 border-t pt-4">
    <h3 className="text-lg font-semibold">OAuth Connections</h3>
    <p className="text-sm text-muted-foreground">
      Manage OAuth connections for MCP servers that require authentication.
      These connections are created automatically when needed.
    </p>
    {oauthServerIds.map(serverId => (
      <OAuthPermissionsView key={serverId} serverId={serverId} />
    ))}
  </div>
)}
```

---

## 🔄 Orden de Implementación

### Paso 1: Backend - Servicios OAuth (Semana 1)
1. ✅ Modificar `OAuthService.ts` - Agregar `getExistingToken` y `ensureValidToken`
2. ✅ Modificar `OAuthHttpClient.ts` - Hacer público `refreshToken`
3. ✅ Modificar `OAuthService.authorize` - Aceptar `wwwAuthHeader`
4. ✅ Testing: Probar que los métodos nuevos funcionan correctamente

### Paso 2: Backend - MCP Services (Semana 1)
5. ✅ Modificar `mcpUseService.ts` - Implementar detección de 401 y emisión de eventos
6. ✅ Modificar `mcpLegacyService.ts` - Aplicar mismos cambios
7. ✅ Modificar `oauthHandlers.ts` - Agregar soporte para `wwwAuthHeader`
8. ✅ Testing: Simular 401 y verificar que se emite el evento correcto

### Paso 3: Frontend - Preload y Store (Semana 2)
9. ✅ Modificar `src/preload/api/app.ts` - Agregar `onOAuthRequired`
10. ✅ Modificar `src/preload/preload.ts` - Exponer nuevo método
11. ✅ Modificar `oauthStore.ts` - Agregar handler y listener global
12. ✅ Testing: Verificar que el evento llega al store correctamente

### Paso 4: Frontend - UI Components (Semana 2)
13. ✅ Modificar `OAuthConnectionDialog.tsx` - Integrar con eventos automáticos
14. ✅ Modificar `store-layout.tsx` - Eliminar lógica manual de OAuth
15. ✅ Limpiar `MCPSection.tsx` - Mantener solo gestión
16. ✅ Testing: Flujo end-to-end de instalación con 401

### Paso 5: Tipos y Limpieza (Semana 3)
17. ✅ Modificar `src/renderer/types/mcp.ts` - Eliminar campos `oauth`
18. ✅ Limpiar referencias obsoletas en toda la codebase
19. ✅ Actualizar documentación
20. ✅ Testing completo del sistema

---

## ✅ Testing Necesario

### Tests Unitarios

#### Backend
- [ ] `OAuthService.getExistingToken` - Retorna token válido, null si expirado, null si no existe
- [ ] `OAuthService.ensureValidToken` - Lanza error si no hay token
- [ ] `OAuthHttpClient.refreshToken` - Funciona con y sin parámetro oldTokens
- [ ] `mcpUseService.is401Error` - Detecta correctamente diferentes formatos de 401
- [ ] `mcpUseService.extractWWWAuthenticate` - Extrae header de diferentes fuentes
- [ ] `mcpUseService.initiateOAuthFlow` - Emite evento correctamente

#### Frontend
- [ ] `oauthStore.handleOAuthRequired` - Procesa evento y llama authorize
- [ ] `oauthStore.authorize` - Pasa correctamente el wwwAuthHeader
- [ ] Listener global se registra correctamente en mount

### Tests de Integración

- [ ] **Flujo completo sin OAuth**: Instalar MCP → Conexión exitosa sin token
- [ ] **Flujo completo con 401**: Instalar MCP → 401 → Dialog automático → Autorización → Reconexión exitosa
- [ ] **Token existente**: MCP con OAuth ya autorizado → Usa token automáticamente
- [ ] **Token expirado**: MCP con token expirado → Auto-refresh → Conexión exitosa
- [ ] **401 durante operación**: MCP conectado → Operación → 401 → Refresh automático o re-autorización

### Tests E2E (Playwright)

```typescript
test('OAuth flow is triggered automatically on 401', async ({ page }) => {
  // 1. Instalar MCP mock que retorna 401 con WWW-Authenticate
  await page.goto('/mcp/store');
  await page.click('[data-testid="install-oauth-mcp"]');

  // 2. Verificar que NO se abre dialog inmediatamente
  await expect(page.locator('[data-testid="oauth-dialog"]')).not.toBeVisible();

  // 3. Esperar a que backend intente conectar y reciba 401
  await page.waitForTimeout(1000);

  // 4. Verificar que el dialog se abre automáticamente
  await expect(page.locator('[data-testid="oauth-dialog"]')).toBeVisible();

  // 5. Completar autorización
  await page.click('[data-testid="authorize-button"]');

  // 6. Verificar reconexión exitosa
  await expect(page.locator('[data-testid="mcp-connected"]')).toBeVisible();
});
```

---

## 🚨 Consideraciones de Seguridad

1. **No exponer wwwAuth al frontend sin sanitizar**: El header puede contener información sensible
2. **Validar formato de WWW-Authenticate**: Prevenir inyección de código
3. **Rate limiting**: Evitar bucles infinitos de 401 → authorize → 401
4. **Timeout en autorización**: Si el usuario no completa OAuth, no intentar reconectar indefinidamente

### Implementar Rate Limiting

```typescript
// En mcpUseService.ts
private oauthAttempts: Map<string, { count: number; lastAttempt: number }> = new Map();

private canAttemptOAuth(serverId: string): boolean {
  const now = Date.now();
  const attempt = this.oauthAttempts.get(serverId);

  if (!attempt) {
    this.oauthAttempts.set(serverId, { count: 1, lastAttempt: now });
    return true;
  }

  // Reset después de 5 minutos
  if (now - attempt.lastAttempt > 5 * 60 * 1000) {
    this.oauthAttempts.set(serverId, { count: 1, lastAttempt: now });
    return true;
  }

  // Máximo 3 intentos en 5 minutos
  if (attempt.count >= 3) {
    this.logger.mcp.error('Too many OAuth attempts', { serverId });
    return false;
  }

  attempt.count++;
  attempt.lastAttempt = now;
  return true;
}
```

---

## 📊 Métricas de Éxito

- ✅ 0% de MCPs requieren configuración manual de OAuth
- ✅ 100% de flujos OAuth iniciados por 401 (no por config)
- ✅ Tiempo de instalación de MCPs reducido en 50% (sin pasos manuales de OAuth)
- ✅ 0 errores de "OAuth not configured" para MCPs con OAuth habilitado

---

## 🔄 Migración de Datos Existentes

### MCPs ya instalados con campo `oauth`

```typescript
// Script de migración a ejecutar en próximo arranque
async function migrateOAuthConfig(): Promise<void> {
  const preferencesService = new PreferencesService();
  await preferencesService.initialize();

  const servers = await preferencesService.get('mcpServers') as Record<string, MCPServerConfig>;

  for (const [serverId, config] of Object.entries(servers)) {
    if (config.oauth) {
      // Mantener solo si ya tiene tokens válidos
      const hasTokens = await tokenStore.getTokens(serverId);

      if (hasTokens) {
        logger.core.info('Keeping OAuth config for server with existing tokens', {
          serverId
        });
        // NO eliminar config.oauth, solo los campos de template
      } else {
        // Eliminar configuración OAuth si no hay tokens
        delete config.oauth;
        logger.core.info('Removed OAuth config for server without tokens', {
          serverId
        });
      }
    }
  }

  await preferencesService.set('mcpServers', servers);
}
```

---

## 📚 Documentación a Actualizar

1. **`docs/guides/oauth-flow.md`** - Actualizar con nuevo flujo automático
2. **`docs/plans/resumen_fases_12345.md`** - Agregar nota de cambio arquitectónico
3. **`CLAUDE.md`** - Actualizar sección de OAuth
4. **README.md** - Simplificar instrucciones de instalación de MCPs

---

## 🎯 Resultado Final

### Antes
```json
{
  "id": "github-mcp",
  "transport": "http",
  "url": "https://mcp.github.com",
  "oauth": {
    "enabled": true,
    "scopes": ["repo:read"]
  }
}
```

### Después
```json
{
  "id": "github-mcp",
  "transport": "http",
  "url": "https://mcp.github.com"
}
```

**El OAuth se activa automáticamente cuando GitHub responde con 401** 🎉

---

**Autor**: Arquitectura Levante
**Revisión**: Pendiente
**Aprobación**: Pendiente
