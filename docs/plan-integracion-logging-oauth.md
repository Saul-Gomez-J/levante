# Plan de Implementación: Integración de Logging OAuth

**Fecha:** 2025-12-23
**Objetivo:** Integrar el flujo de OAuth al sistema de logging centralizado de Levante con categoría dedicada `oauth` controlada por `DEBUG_OAUTH`

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Análisis del Estado Actual](#análisis-del-estado-actual)
3. [Estrategia de Implementación](#estrategia-de-implementación)
4. [Archivos a Modificar](#archivos-a-modificar)
5. [Pasos de Implementación](#pasos-de-implementación)
6. [Testing y Validación](#testing-y-validación)
7. [Configuración Final](#configuración-final)

---

## Resumen Ejecutivo

### Objetivo
Agregar una nueva categoría de logging `oauth` al sistema centralizado de Levante para permitir el debugging específico del flujo de OAuth mediante la variable de entorno `DEBUG_OAUTH`.

### Estado Actual
- El flujo de OAuth actualmente usa `logger.core` y `console.log/console.error`
- No hay control granular sobre los logs de OAuth
- Los logs de OAuth se mezclan con logs del core de la aplicación

### Estado Final
- Nueva categoría `oauth` independiente
- Control mediante `DEBUG_OAUTH=true/false`
- Logs estructurados en main y renderer process
- Compatibilidad completa con el sistema de transports (Console + File)

### Beneficios
- ✅ Debugging específico de OAuth sin ruido de otros componentes
- ✅ Logs estructurados con contexto rico (serverId, metadata, tokens, etc.)
- ✅ Consistencia con el resto del sistema de logging
- ✅ Mejor troubleshooting en producción

---

## Análisis del Estado Actual

### Archivos que Usan Logging OAuth

#### Main Process
1. **`src/main/services/oauthCallbackServer.ts`** (21 líneas)
   - Usa: `logger.core` (22 ocurrencias)
   - Tipos: info, warn, error
   - Contextos: puerto, callbacks, errores de autorización

2. **`src/main/ipc/oauthHandlers.ts`** (72 líneas)
   - Usa: `logger.core` (11 ocurrencias)
   - Tipos: info, error
   - Contextos: IPC handlers, autorización, desconexión, estado

3. **`src/main/services/oauth/OAuthService.ts`** (~300 líneas estimadas)
   - Usa: `logger.core` (múltiples ocurrencias)
   - Tipos: debug, info, warn, error
   - Contextos: flujo de autorización, discovery, tokens, registro dinámico

4. **`src/main/services/oauth/OAuthFlowManager.ts`**
   - Usa: `logger.core`
   - Contextos: PKCE, código de autorización, intercambio de tokens

5. **`src/main/services/oauth/OAuthDiscoveryService.ts`**
   - Usa: `logger.core`
   - Contextos: descubrimiento de metadata, parsing de WWW-Authenticate

6. **`src/main/services/oauth/OAuthTokenStore.ts`**
   - Usa: `logger.core`
   - Contextos: almacenamiento, recuperación, refresh de tokens

7. **`src/main/services/oauth/OAuthHttpClient.ts`**
   - Usa: `logger.core`
   - Contextos: requests HTTP, respuestas, errores de red

8. **`src/main/services/oauth/OAuthRedirectServer.ts`**
   - Usa: `logger.core`
   - Contextos: servidor local de redirección, callbacks

9. **`src/main/services/oauth/OAuthStateManager.ts`**
   - Usa: `logger.core`
   - Contextos: gestión de estado CSRF, validación

#### Renderer Process
1. **`src/renderer/stores/oauthStore.ts`** (270 líneas)
   - Usa: `console.log`, `console.error` (2 ocurrencias)
   - Contextos: eventos de OAuth required, errores de Zustand

### Sistema de Logging Actual

**Categorías existentes:**
```typescript
type LogCategory = 'ai-sdk' | 'mcp' | 'database' | 'ipc' | 'preferences' | 'models' | 'core' | 'analytics';
```

**Variables de entorno:**
- `DEBUG_ENABLED` - Master switch
- `DEBUG_AI_SDK`, `DEBUG_MCP`, `DEBUG_DATABASE`, `DEBUG_IPC`, `DEBUG_PREFERENCES`, `DEBUG_MODELS`, `DEBUG_CORE`, `DEBUG_ANALYTICS`
- `LOG_LEVEL` - Nivel mínimo (debug|info|warn|error)

---

## Estrategia de Implementación

### Principios
1. **Zero Breaking Changes**: No afectar funcionalidad existente
2. **Consistencia**: Seguir exactamente el patrón de categorías existentes
3. **Tipo-seguro**: Mantener type safety en TypeScript
4. **Fallbacks**: Mantener fallbacks robustos en renderer

### Fases de Implementación

**Fase 1: Core del Sistema de Logging** (30 min)
- Agregar categoría `oauth` a tipos
- Actualizar configuración para soportar `DEBUG_OAUTH`
- Agregar CategoryLogger en main y renderer

**Fase 2: Main Process** (45 min)
- Reemplazar `logger.core` por `logger.oauth` en archivos OAuth
- Ajustar niveles de log según criticidad
- Enriquecer contextos con información relevante

**Fase 3: Renderer Process** (15 min)
- Reemplazar `console.log/error` por `logger.oauth`
- Actualizar oauthStore con logging estructurado

**Fase 4: Testing y Validación** (30 min)
- Verificar logs con `DEBUG_OAUTH=true/false`
- Validar formato y transports
- Testing de fallbacks

---

## Archivos a Modificar

### 1. Core del Sistema de Logging

#### ✏️ `src/main/types/logger.ts`

**Cambios:**
```typescript
// ANTES
export type LogCategory = 'ai-sdk' | 'mcp' | 'database' | 'ipc' | 'preferences' | 'models' | 'core' | 'analytics';

// DESPUÉS
export type LogCategory = 'ai-sdk' | 'mcp' | 'database' | 'ipc' | 'preferences' | 'models' | 'core' | 'analytics' | 'oauth';
```

```typescript
// ANTES
export interface LoggerService {
  aiSdk: CategoryLogger;
  mcp: CategoryLogger;
  database: CategoryLogger;
  ipc: CategoryLogger;
  preferences: CategoryLogger;
  models: CategoryLogger;
  core: CategoryLogger;
  analytics: CategoryLogger;

  log(category: LogCategory, level: LogLevel, message: string, context?: LogContext): void;
  configure(config: Partial<LoggerConfig>): void;
  isEnabled(category: LogCategory, level: LogLevel): boolean;
}

// DESPUÉS
export interface LoggerService {
  aiSdk: CategoryLogger;
  mcp: CategoryLogger;
  database: CategoryLogger;
  ipc: CategoryLogger;
  preferences: CategoryLogger;
  models: CategoryLogger;
  core: CategoryLogger;
  analytics: CategoryLogger;
  oauth: CategoryLogger;  // ← NUEVO

  log(category: LogCategory, level: LogLevel, message: string, context?: LogContext): void;
  configure(config: Partial<LoggerConfig>): void;
  isEnabled(category: LogCategory, level: LogLevel): boolean;
}
```

**Líneas afectadas:** 3, 42-49

---

#### ✏️ `src/main/services/logging/config.ts`

**Cambios:**

1. **Default configuration:**
```typescript
// LÍNEA 19-37: Actualizar getDefaultConfig()
private getDefaultConfig(): LoggerConfig {
  return {
    enabled: true,
    level: "debug" as LogLevel,
    categories: {
      "ai-sdk": false,
      mcp: false,
      database: false,
      ipc: false,
      preferences: false,
      models: false,
      core: true,
      analytics: true,
      oauth: false,  // ← NUEVO: Deshabilitado por defecto (alto volumen)
    },
    output: {
      console: true,
      file: true,
      filePath: "levante.log",
    },
  };
}
```

2. **Environment loading:**
```typescript
// LÍNEA 48-69: Actualizar loadConfig()
private loadConfig(): LoggerConfig {
  const env = process.env;

  return {
    enabled: this.parseBoolean(env.DEBUG_ENABLED, true),
    level: this.parseLogLevel(env.LOG_LEVEL, "debug"),
    categories: {
      "ai-sdk": this.parseBoolean(env.DEBUG_AI_SDK, false),
      mcp: this.parseBoolean(env.DEBUG_MCP, false),
      database: this.parseBoolean(env.DEBUG_DATABASE, false),
      ipc: this.parseBoolean(env.DEBUG_IPC, false),
      preferences: this.parseBoolean(env.DEBUG_PREFERENCES, false),
      models: this.parseBoolean(env.DEBUG_MODELS, true),
      core: this.parseBoolean(env.DEBUG_CORE, true),
      analytics: this.parseBoolean(env.DEBUG_ANALYTICS, true),
      oauth: this.parseBoolean(env.DEBUG_OAUTH, false),  // ← NUEVO
    },
    output: {
      console: true,
      file: this.parseBoolean(env.LOG_TO_FILE, true),
      filePath: env.LOG_FILE_PATH || "./logs/levante.log",
    },
  };
}
```

**Líneas afectadas:** 32, 62

---

#### ✏️ `src/main/services/logging/logger.ts`

**Cambios:**

```typescript
// LÍNEA 37-49: Agregar property oauth
export class Logger implements LoggerService {
  private configService: LoggerConfigService;
  private transports: LogTransport[] = [];

  // Category loggers
  public readonly aiSdk: CategoryLogger;
  public readonly mcp: CategoryLogger;
  public readonly database: CategoryLogger;
  public readonly ipc: CategoryLogger;
  public readonly preferences: CategoryLogger;
  public readonly models: CategoryLogger;
  public readonly core: CategoryLogger;
  public readonly analytics: CategoryLogger;
  public readonly oauth: CategoryLogger;  // ← NUEVO
```

```typescript
// LÍNEA 51-64: Agregar inicialización en constructor
constructor() {
  this.configService = new LoggerConfigService();
  this.setupTransports();

  // Initialize category loggers
  this.aiSdk = new CategoryLoggerImpl('ai-sdk', this);
  this.mcp = new CategoryLoggerImpl('mcp', this);
  this.database = new CategoryLoggerImpl('database', this);
  this.ipc = new CategoryLoggerImpl('ipc', this);
  this.preferences = new CategoryLoggerImpl('preferences', this);
  this.models = new CategoryLoggerImpl('models', this);
  this.core = new CategoryLoggerImpl('core', this);
  this.analytics = new CategoryLoggerImpl('analytics', this);
  this.oauth = new CategoryLoggerImpl('oauth', this);  // ← NUEVO
}
```

**Líneas afectadas:** 49, 64

---

#### ✏️ `src/renderer/services/logger.ts`

**Cambios:**

```typescript
// LÍNEA 3-10: Actualizar interfaz
export interface RendererLoggerService {
  aiSdk: CategoryLogger;
  mcp: CategoryLogger;
  database: CategoryLogger;
  ipc: CategoryLogger;
  preferences: CategoryLogger;
  models: CategoryLogger;
  core: CategoryLogger;
  oauth: CategoryLogger;  // ← NUEVO

  log(category: LogCategory, level: LogLevel, message: string, context?: LogContext): void;
  isEnabled(category: LogCategory, level: LogLevel): Promise<boolean>;
  configure(config: any): void;
}
```

```typescript
// LÍNEA 40-49: Agregar property
export class RendererLogger implements RendererLoggerService {
  // Category loggers
  public readonly aiSdk: CategoryLogger;
  public readonly mcp: CategoryLogger;
  public readonly database: CategoryLogger;
  public readonly ipc: CategoryLogger;
  public readonly preferences: CategoryLogger;
  public readonly models: CategoryLogger;
  public readonly core: CategoryLogger;
  public readonly oauth: CategoryLogger;  // ← NUEVO
```

```typescript
// LÍNEA 50-59: Agregar inicialización
constructor() {
  // Initialize category loggers
  this.aiSdk = new RendererCategoryLogger('ai-sdk', this);
  this.mcp = new RendererCategoryLogger('mcp', this);
  this.database = new RendererCategoryLogger('database', this);
  this.ipc = new RendererCategoryLogger('ipc', this);
  this.preferences = new RendererCategoryLogger('preferences', this);
  this.models = new RendererCategoryLogger('models', this);
  this.core = new RendererCategoryLogger('core', this);
  this.oauth = new RendererCategoryLogger('oauth', this);  // ← NUEVO
}
```

**Líneas afectadas:** 9, 48, 58

---

### 2. Main Process - Archivos OAuth

#### ✏️ `src/main/services/oauthCallbackServer.ts`

**Cambios globales:**
- Reemplazar todas las ocurrencias de `logger.core` por `logger.oauth`

**Ejemplos específicos:**

```typescript
// LÍNEA 22-23
// ANTES
logger.core.warn('OAuth callback server already running', { port: this.port });

// DESPUÉS
logger.oauth.warn('OAuth callback server already running', { port: this.port });
```

```typescript
// LÍNEA 42-45
// ANTES
logger.core.info('OAuth callback server started', {
  port: this.port,
  isRecommendedPort: this.port === 3000
});

// DESPUÉS
logger.oauth.info('OAuth callback server started', {
  port: this.port,
  isRecommendedPort: this.port === 3000
});
```

```typescript
// LÍNEA 58
// ANTES
logger.core.info('Port 3000 in use, trying random port');

// DESPUÉS
logger.oauth.info('Port 3000 in use, trying random port');
```

```typescript
// LÍNEA 63-65
// ANTES
logger.core.error('OAuth callback server error', {
  error: error.message
});

// DESPUÉS
logger.oauth.error('OAuth callback server error', {
  error: error.message
});
```

```typescript
// LÍNEA 80
// ANTES
logger.core.warn('OAuth callback server not running');

// DESPUÉS
logger.oauth.warn('OAuth callback server not running');
```

```typescript
// LÍNEA 87-89
// ANTES
logger.core.error('Error closing OAuth callback server', {
  error: error.message
});

// DESPUÉS
logger.oauth.error('Error closing OAuth callback server', {
  error: error.message
});
```

```typescript
// LÍNEA 92
// ANTES
logger.core.info('OAuth callback server stopped');

// DESPUÉS
logger.oauth.info('OAuth callback server stopped');
```

```typescript
// LÍNEA 107-110
// ANTES
logger.core.info('OAuth callback received', {
  path: url.pathname,
  query: Object.fromEntries(url.searchParams.entries())
});

// DESPUÉS
logger.oauth.info('OAuth callback received', {
  path: url.pathname,
  query: Object.fromEntries(url.searchParams.entries())
});
```

```typescript
// LÍNEA 119-122
// ANTES
logger.core.error('OAuth authorization error', {
  error,
  errorDescription
});

// DESPUÉS
logger.oauth.error('OAuth authorization error', {
  error,
  errorDescription
});
```

```typescript
// LÍNEA 179
// ANTES
logger.core.warn('OAuth callback missing code parameter');

// DESPUÉS
logger.oauth.warn('OAuth callback missing code parameter');
```

```typescript
// LÍNEA 222-224
// ANTES
logger.core.info('OAuth authorization successful', {
  codeLength: code.length
});

// DESPUÉS
logger.oauth.info('OAuth authorization successful', {
  codeLength: code.length
});
```

**Resumen:** 11 ocurrencias de `logger.core` → `logger.oauth`

---

#### ✏️ `src/main/ipc/oauthHandlers.ts`

**Cambios globales:**
- Reemplazar todas las ocurrencias de `logger.core` por `logger.oauth`

**Ejemplos específicos:**

```typescript
// LÍNEA 71
// ANTES
logger.core.info('OAuth handlers registered successfully (MCP + OpenRouter)');

// DESPUÉS
logger.oauth.info('OAuth handlers registered successfully (MCP + OpenRouter)');
```

```typescript
// LÍNEA 94-98
// ANTES
logger.core.info('IPC: Starting OAuth authorization', {
  serverId: params.serverId,
  url: params.mcpServerUrl,
  hasWWWAuth: !!params.wwwAuthHeader,
});

// DESPUÉS
logger.oauth.info('IPC: Starting OAuth authorization', {
  serverId: params.serverId,
  url: params.mcpServerUrl,
  hasWWWAuth: !!params.wwwAuthHeader,
});
```

```typescript
// LÍNEA 109-111
// ANTES
logger.core.info('IPC: OAuth authorization successful', {
  serverId: params.serverId,
});

// DESPUÉS
logger.oauth.info('IPC: OAuth authorization successful', {
  serverId: params.serverId,
});
```

```typescript
// LÍNEA 121-124
// ANTES
logger.core.error('IPC: OAuth authorization failed', {
  serverId: params.serverId,
  error: result.error,
});

// DESPUÉS
logger.oauth.error('IPC: OAuth authorization failed', {
  serverId: params.serverId,
  error: result.error,
});
```

```typescript
// LÍNEA 132-135
// ANTES
logger.core.error('IPC: OAuth authorization error', {
  serverId: params.serverId,
  error: error instanceof Error ? error.message : error,
});

// DESPUÉS
logger.oauth.error('IPC: OAuth authorization error', {
  serverId: params.serverId,
  error: error instanceof Error ? error.message : error,
});
```

```typescript
// LÍNEA 160-163
// ANTES
logger.core.info('IPC: Disconnecting OAuth server', {
  serverId: params.serverId,
  revokeTokens: params.revokeTokens,
});

// DESPUÉS
logger.oauth.info('IPC: Disconnecting OAuth server', {
  serverId: params.serverId,
  revokeTokens: params.revokeTokens,
});
```

```typescript
// LÍNEA 170-172
// ANTES
logger.core.info('IPC: OAuth server disconnected', {
  serverId: params.serverId,
});

// DESPUÉS
logger.oauth.info('IPC: OAuth server disconnected', {
  serverId: params.serverId,
});
```

```typescript
// LÍNEA 176-179
// ANTES
logger.core.error('IPC: OAuth disconnect error', {
  serverId: params.serverId,
  error: error instanceof Error ? error.message : error,
});

// DESPUÉS
logger.oauth.error('IPC: OAuth disconnect error', {
  serverId: params.serverId,
  error: error instanceof Error ? error.message : error,
});
```

```typescript
// LÍNEA 234-237
// ANTES
logger.core.error('IPC: OAuth status error', {
  serverId: params.serverId,
  error: error instanceof Error ? error.message : error,
});

// DESPUÉS
logger.oauth.error('IPC: OAuth status error', {
  serverId: params.serverId,
  error: error instanceof Error ? error.message : error,
});
```

```typescript
// LÍNEA 260-262
// ANTES
logger.core.info('IPC: Refreshing OAuth token', {
  serverId: params.serverId,
});

// DESPUÉS
logger.oauth.info('IPC: Refreshing OAuth token', {
  serverId: params.serverId,
});
```

```typescript
// LÍNEA 266-268
// ANTES
logger.core.info('IPC: OAuth token refreshed', {
  serverId: params.serverId,
});

// DESPUÉS
logger.oauth.info('IPC: OAuth token refreshed', {
  serverId: params.serverId,
});
```

```typescript
// LÍNEA 277-280
// ANTES
logger.core.error('IPC: OAuth refresh error', {
  serverId: params.serverId,
  error: error instanceof Error ? error.message : error,
});

// DESPUÉS
logger.oauth.error('IPC: OAuth refresh error', {
  serverId: params.serverId,
  error: error instanceof Error ? error.message : error,
});
```

```typescript
// LÍNEA 332-334
// ANTES
logger.core.error('IPC: OAuth list error', {
  error: error instanceof Error ? error.message : error,
});

// DESPUÉS
logger.oauth.error('IPC: OAuth list error', {
  error: error instanceof Error ? error.message : error,
});
```

```typescript
// LÍNEA 356
// ANTES
logger.core.info('Starting OAuth callback server');

// DESPUÉS
logger.oauth.info('Starting OAuth callback server');
```

```typescript
// LÍNEA 358
// ANTES
logger.core.info('OAuth callback server started', result);

// DESPUÉS
logger.oauth.info('OAuth callback server started', result);
```

```typescript
// LÍNEA 361-363
// ANTES
logger.core.error('Error starting OAuth callback server', {
  error: error instanceof Error ? error.message : error,
});

// DESPUÉS
logger.oauth.error('Error starting OAuth callback server', {
  error: error instanceof Error ? error.message : error,
});
```

```typescript
// LÍNEA 376
// ANTES
logger.core.info('Stopping OAuth callback server');

// DESPUÉS
logger.oauth.info('Stopping OAuth callback server');
```

```typescript
// LÍNEA 380-382
// ANTES
logger.core.error('Error stopping OAuth callback server', {
  error: error instanceof Error ? error.message : error,
});

// DESPUÉS
logger.oauth.error('Error stopping OAuth callback server', {
  error: error instanceof Error ? error.message : error,
});
```

**Resumen:** 18 ocurrencias de `logger.core` → `logger.oauth`

---

#### ✏️ `src/main/services/oauth/OAuthService.ts`

**Cambios:**
- Buscar y reemplazar **todas** las ocurrencias de `logger.core` por `logger.oauth`
- Revisar niveles de log según contexto:
  - `debug`: Información detallada de flujo (steps, metadata parsing)
  - `info`: Operaciones exitosas (discovery, autorización, tokens)
  - `warn`: Condiciones recuperables (reintentos, fallbacks)
  - `error`: Fallos que requieren atención

**Estimación:** ~20-30 ocurrencias

---

#### ✏️ `src/main/services/oauth/OAuthFlowManager.ts`

**Cambios:**
- Reemplazar `logger.core` → `logger.oauth`
- Ajustar niveles según contexto:
  - `debug`: PKCE verifier/challenge, state generation
  - `info`: Apertura de navegador, código recibido
  - `error`: Fallos en intercambio de tokens

**Estimación:** ~10-15 ocurrencias

---

#### ✏️ `src/main/services/oauth/OAuthDiscoveryService.ts`

**Cambios:**
- Reemplazar `logger.core` → `logger.oauth`
- Niveles recomendados:
  - `debug`: Parsing de WWW-Authenticate, metadata fields
  - `info`: Discovery exitoso
  - `warn`: Metadata incompleta
  - `error`: Fallo en discovery

**Estimación:** ~8-12 ocurrencias

---

#### ✏️ `src/main/services/oauth/OAuthTokenStore.ts`

**Cambios:**
- Reemplazar `logger.core` → `logger.oauth`
- Niveles recomendados:
  - `debug`: Lectura/escritura de tokens
  - `info`: Token refresh exitoso
  - `warn`: Token expirado (antes de refresh)
  - `error`: Fallo en almacenamiento

**Estimación:** ~10-15 ocurrencias

---

#### ✏️ `src/main/services/oauth/OAuthHttpClient.ts`

**Cambios:**
- Reemplazar `logger.core` → `logger.oauth`
- Niveles recomendados:
  - `debug`: Detalles de requests (headers, body)
  - `info`: Requests exitosos
  - `warn`: Reintentos, timeouts
  - `error`: Errores HTTP (4xx, 5xx)

**Estimación:** ~12-18 ocurrencias

---

#### ✏️ `src/main/services/oauth/OAuthRedirectServer.ts`

**Cambios:**
- Reemplazar `logger.core` → `logger.oauth`
- Similar a oauthCallbackServer.ts

**Estimación:** ~8-12 ocurrencias

---

#### ✏️ `src/main/services/oauth/OAuthStateManager.ts`

**Cambios:**
- Reemplazar `logger.core` → `logger.oauth`
- Niveles recomendados:
  - `debug`: Generación de state, validación
  - `error`: CSRF validation failed

**Estimación:** ~5-8 ocurrencias

---

### 3. Renderer Process

#### ✏️ `src/renderer/stores/oauthStore.ts`

**Cambios:**

```typescript
// LÍNEA 1: Agregar import
import { create } from 'zustand';
import { logger } from '@/services/logger';  // ← NUEVO
```

```typescript
// LÍNEA 253
// ANTES
console.log('[OAuth] OAuth required for server:', serverId);

// DESPUÉS
logger.oauth.info('OAuth required for server', { serverId });
```

```typescript
// LÍNEA 234
// ANTES
console.error('Failed to load OAuth servers:', error);

// DESPUÉS
logger.oauth.error('Failed to load OAuth servers', {
  error: error instanceof Error ? error.message : error
});
```

**Resumen:** 2 ocurrencias de console → logger.oauth

---

### 4. Variables de Entorno

#### ✏️ `.env` (Defaults del repositorio)

**Agregar:**
```bash
# OAuth Logging (default: false - alto volumen)
DEBUG_OAUTH=false
```

**Ubicación:** Después de la línea de `DEBUG_ANALYTICS`

---

#### ✏️ `.env.local` (Configuración local)

**Opcional - para desarrollo:**
```bash
# Habilitar logs de OAuth durante desarrollo
DEBUG_OAUTH=true
```

---

### 5. Documentación

#### ✏️ `docs/LOGGING.md`

**Cambios:**

1. **Línea ~143: Tabla de categorías**
```markdown
| Categoría | Variable ENV | Default | Propósito | Archivos Principales |
|-----------|--------------|---------|-----------|----------------------|
| **ai-sdk** | `DEBUG_AI_SDK` | `false` | Operaciones del SDK de IA, streaming, tool calls | `aiService.ts`, `ProviderServices` |
| **mcp** | `DEBUG_MCP` | `false` | Gestión de servidores MCP, conexiones, herramientas | `mcpUseService.ts`, `mcpLegacyService.ts` |
| **database** | `DEBUG_DATABASE` | `false` | Operaciones de BD, queries, migraciones | `databaseService.ts` |
| **ipc** | `DEBUG_IPC` | `false` | Comunicación inter-proceso | `loggerHandlers.ts`, handlers |
| **preferences** | `DEBUG_PREFERENCES` | `false` | Gestión de configuración y preferencias | `preferencesService.ts` |
| **models** | `DEBUG_MODELS` | `true` | Gestión de modelos IA, fetch, sincronización | `modelFetchService.ts` |
| **core** | `DEBUG_CORE` | `true` | Ciclo de vida de la app, errores críticos | `initialization.ts`, `window.ts` |
| **analytics** | `DEBUG_ANALYTICS` | `true` | Análisis y métricas de uso | Eventos de usuario |
| **oauth** | `DEBUG_OAUTH` | `false` | Flujo de OAuth, autorización, tokens | `OAuthService.ts`, `oauthHandlers.ts` |  <!-- NUEVO -->
```

2. **Línea ~158: Default config**
```typescript
const defaultConfig = {
  "ai-sdk": false,
  "mcp": false,
  "database": false,
  "ipc": false,
  "preferences": false,
  "models": true,
  "core": true,
  "analytics": true,
  "oauth": false      // ← NUEVO
};
```

3. **Línea ~293: Variables disponibles**
```bash
DEBUG_AI_SDK=true       # AI SDK operations
DEBUG_MCP=true          # MCP server management
DEBUG_DATABASE=true     # Database operations
DEBUG_IPC=true          # Inter-process communication
DEBUG_PREFERENCES=true  # Preferences management
DEBUG_MODELS=true       # Model management
DEBUG_CORE=true         # Application core
DEBUG_ANALYTICS=true    # Analytics events
DEBUG_OAUTH=true        # OAuth flow and authorization  # ← NUEVO
```

4. **Nueva sección de ejemplos:**
```markdown
### Main Process - OAuthService.ts

**Flujo de autorización:**

```typescript
// Debug: pasos del flujo
logger.oauth.debug('Step 1: Discovering authorization server', {
  serverId,
  mcpServerUrl
});

// Info: operación exitosa
logger.oauth.info('Authorization server discovered', {
  serverId,
  authServerId,
  hasMetadata: !!metadata
});

// Warn: condición recuperable
logger.oauth.warn('Client registration not supported, using static credentials', {
  serverId
});

// Error: fallo en flujo
logger.oauth.error('OAuth authorization failed', {
  serverId,
  error: error.message,
  step: 'token_exchange'
});
```

### Renderer Process - oauthStore.ts

**Eventos de OAuth:**

```typescript
// Info: evento de OAuth required
logger.oauth.info('OAuth required for server', {
  serverId,
  mcpServerUrl
});

// Error: fallo en store
logger.oauth.error('Failed to load OAuth servers', {
  error: error.message
});
```
```

5. **Línea ~1512: Ubicaciones de uso**
```markdown
**Main Process (OAuth Services):**
- `OAuthService.ts` - 25 usos (oauth)
- `OAuthFlowManager.ts` - 12 usos (oauth)
- `OAuthDiscoveryService.ts` - 10 usos (oauth)
- `OAuthTokenStore.ts` - 14 usos (oauth)
- `OAuthHttpClient.ts` - 15 usos (oauth)
- `oauthCallbackServer.ts` - 11 usos (oauth)
- `oauthHandlers.ts` - 18 usos (oauth)

**Renderer Process (Stores):**
- `oauthStore.ts` - 2 usos (oauth)
```

6. **Configuraciones recomendadas:**
```markdown
#### Debugging de OAuth

```bash
DEBUG_ENABLED=true
DEBUG_OAUTH=true
DEBUG_MCP=true          # Si OAuth es para servidores MCP
LOG_LEVEL=debug
```
```

---

#### ✏️ `CLAUDE.md`

**Cambios:**

En la sección de **Logging Configuration** (~línea 207):

```markdown
**Logging Configuration:**
- `DEBUG_ENABLED` → Master switch for all debug logging
- `DEBUG_AI_SDK` → AI service operations and streaming
- `DEBUG_MCP` → MCP server management and tools
- `DEBUG_DATABASE` → Database operations and migrations
- `DEBUG_IPC` → Inter-process communication
- `DEBUG_PREFERENCES` → Settings and configuration
- `DEBUG_CORE` → Application lifecycle and errors
- `DEBUG_OAUTH` → OAuth flow, authorization, and tokens  <!-- NUEVO -->
- `LOG_LEVEL` → Minimum log level (debug|info|warn|error)
```

---

## Pasos de Implementación

### Fase 1: Core del Sistema (30 min)

**Paso 1.1:** Actualizar tipos base
```bash
# Editar src/main/types/logger.ts
1. Agregar 'oauth' a LogCategory union type (línea 3)
2. Agregar oauth: CategoryLogger a LoggerService (línea 49)
3. Guardar y verificar que TypeScript compila sin errores
```

**Paso 1.2:** Actualizar configuración
```bash
# Editar src/main/services/logging/config.ts
1. Agregar oauth: false en getDefaultConfig() (línea 32)
2. Agregar oauth: this.parseBoolean(env.DEBUG_OAUTH, false) en loadConfig() (línea 62)
3. Guardar
```

**Paso 1.3:** Actualizar implementación del logger (main)
```bash
# Editar src/main/services/logging/logger.ts
1. Agregar public readonly oauth: CategoryLogger (línea 49)
2. Agregar this.oauth = new CategoryLoggerImpl('oauth', this) en constructor (línea 64)
3. Guardar
```

**Paso 1.4:** Actualizar implementación del logger (renderer)
```bash
# Editar src/renderer/services/logger.ts
1. Agregar oauth: CategoryLogger a RendererLoggerService (línea 9)
2. Agregar public readonly oauth: CategoryLogger (línea 48)
3. Agregar this.oauth = new RendererCategoryLogger('oauth', this) en constructor (línea 58)
4. Guardar
```

**Paso 1.5:** Verificar compilación
```bash
pnpm typecheck
# Debe compilar sin errores
```

---

### Fase 2: Main Process - Archivos OAuth (45 min)

**Paso 2.1:** oauthCallbackServer.ts
```bash
# Reemplazar logger.core → logger.oauth (11 ocurrencias)
# Usar búsqueda y reemplazo en editor:
# Buscar: logger\.core\.(debug|info|warn|error)
# Reemplazar con: logger.oauth.$1
```

**Paso 2.2:** oauthHandlers.ts
```bash
# Reemplazar logger.core → logger.oauth (18 ocurrencias)
```

**Paso 2.3:** OAuthService.ts
```bash
# Reemplazar logger.core → logger.oauth (~25 ocurrencias)
# Revisar cada ocurrencia y ajustar nivel si es necesario
```

**Paso 2.4:** Servicios OAuth restantes
```bash
# Aplicar cambios en cada archivo:
- OAuthFlowManager.ts
- OAuthDiscoveryService.ts
- OAuthTokenStore.ts
- OAuthHttpClient.ts
- OAuthRedirectServer.ts
- OAuthStateManager.ts

# Total estimado: ~80-100 ocurrencias
```

**Paso 2.5:** Verificar compilación
```bash
pnpm typecheck
```

---

### Fase 3: Renderer Process (15 min)

**Paso 3.1:** Actualizar oauthStore.ts
```bash
# 1. Agregar import: import { logger } from '@/services/logger';
# 2. Línea 253: console.log → logger.oauth.info
# 3. Línea 234: console.error → logger.oauth.error
# 4. Guardar
```

**Paso 3.2:** Verificar compilación
```bash
pnpm typecheck
```

---

### Fase 4: Variables de Entorno y Docs (15 min)

**Paso 4.1:** Actualizar .env
```bash
# Agregar al final del archivo:
DEBUG_OAUTH=false
```

**Paso 4.2:** Actualizar .env.local (opcional)
```bash
# Para debugging local:
DEBUG_OAUTH=true
```

**Paso 4.3:** Actualizar docs/LOGGING.md
```bash
# Seguir cambios detallados en sección "Documentación"
# Agregar oauth a todas las tablas y ejemplos
```

**Paso 4.4:** Actualizar CLAUDE.md
```bash
# Agregar DEBUG_OAUTH a la lista de variables de logging
```

---

## Testing y Validación

### Test 1: Compilación y Build
```bash
# Verificar que TypeScript compila sin errores
pnpm typecheck

# Verificar que el build funciona
pnpm build
```

**Criterio de éxito:** ✅ Sin errores de TypeScript, build exitoso

---

### Test 2: Logs Habilitados

**Configuración:**
```bash
# .env.local
DEBUG_ENABLED=true
DEBUG_OAUTH=true
LOG_LEVEL=debug
```

**Pasos:**
```bash
1. Iniciar aplicación: pnpm dev
2. Navegar a Settings > MCP Configuration
3. Intentar conectar un servidor MCP con OAuth
4. Observar logs en terminal
```

**Criterio de éxito:**
- ✅ Logs de OAuth aparecen en terminal con formato `[OAUTH]`
- ✅ Logs incluyen contexto rico (serverId, metadata, etc.)
- ✅ Niveles debug, info, warn, error funcionan correctamente
- ✅ Logs se escriben en archivo `./logs/levante.log`

**Ejemplo esperado:**
```
[2025-12-23 14:30:25] [OAUTH] [INFO] IPC: Starting OAuth authorization { serverId: 'test-server', url: 'https://example.com', hasWWWAuth: true }
[2025-12-23 14:30:26] [OAUTH] [DEBUG] Step 1: Discovering authorization server { serverId: 'test-server' }
[2025-12-23 14:30:27] [OAUTH] [INFO] Authorization server discovered { serverId: 'test-server', authServerId: 'https://auth.example.com' }
```

---

### Test 3: Logs Deshabilitados

**Configuración:**
```bash
# .env.local
DEBUG_ENABLED=true
DEBUG_OAUTH=false  # ← Deshabilitado
LOG_LEVEL=debug
```

**Pasos:**
```bash
1. Iniciar aplicación: pnpm dev
2. Repetir flujo de OAuth
3. Observar logs en terminal
```

**Criterio de éxito:**
- ✅ NO aparecen logs con `[OAUTH]`
- ✅ Otros logs (CORE, MCP, etc.) sí aparecen si están habilitados
- ✅ Sin errores en consola

---

### Test 4: Control de Nivel

**Configuración:**
```bash
# .env.local
DEBUG_ENABLED=true
DEBUG_OAUTH=true
LOG_LEVEL=info  # ← Solo info y superiores
```

**Criterio de éxito:**
- ✅ Logs de nivel `debug` no aparecen
- ✅ Logs de nivel `info`, `warn`, `error` sí aparecen

---

### Test 5: Fallback en Renderer

**Pasos:**
```bash
1. Detener el main process artificialmente (simular crash)
2. Intentar hacer logging desde renderer (oauthStore)
3. Observar consola del navegador (DevTools)
```

**Criterio de éxito:**
- ✅ Logs aparecen en console del navegador como fallback
- ✅ Error de IPC logged: "Logger IPC failed"
- ✅ Aplicación no crashea

---

### Test 6: File Transport

**Verificar archivo de logs:**
```bash
cat ./logs/levante.log | grep OAUTH
```

**Criterio de éxito:**
- ✅ Logs de OAuth presentes en archivo
- ✅ Formato correcto sin colores ANSI
- ✅ Contextos en formato JSON

**Ejemplo esperado:**
```
[2025-12-23 14:30:25] [OAUTH] [INFO] IPC: Starting OAuth authorization {"serverId":"test-server","url":"https://example.com","hasWWWAuth":true}
```

---

## Configuración Final

### Configuración Recomendada para Desarrollo

```bash
# .env.local
DEBUG_ENABLED=true
DEBUG_OAUTH=true
DEBUG_MCP=true
DEBUG_CORE=true
LOG_LEVEL=debug
LOG_TO_FILE=true
```

### Configuración Recomendada para Producción

```bash
# .env
DEBUG_ENABLED=false
DEBUG_OAUTH=false
LOG_LEVEL=warn
LOG_TO_FILE=true
```

### Configuración para Debugging de OAuth Específico

```bash
# .env.local
DEBUG_ENABLED=true
DEBUG_OAUTH=true          # ← Solo OAuth
DEBUG_AI_SDK=false
DEBUG_MCP=false           # Deshabilitar otros si hay ruido
DEBUG_DATABASE=false
DEBUG_IPC=false
DEBUG_PREFERENCES=false
DEBUG_MODELS=false
DEBUG_CORE=true           # Mantener core para errores críticos
LOG_LEVEL=debug
```

---

## Checklist Final de Implementación

### Core del Sistema
- [ ] `src/main/types/logger.ts` - Agregar 'oauth' a LogCategory
- [ ] `src/main/types/logger.ts` - Agregar oauth a LoggerService
- [ ] `src/main/services/logging/config.ts` - Agregar oauth en defaults
- [ ] `src/main/services/logging/config.ts` - Agregar DEBUG_OAUTH en loadConfig
- [ ] `src/main/services/logging/logger.ts` - Agregar property oauth
- [ ] `src/main/services/logging/logger.ts` - Inicializar CategoryLogger
- [ ] `src/renderer/services/logger.ts` - Agregar oauth a interfaz
- [ ] `src/renderer/services/logger.ts` - Agregar property oauth
- [ ] `src/renderer/services/logger.ts` - Inicializar CategoryLogger

### Main Process - OAuth Files
- [ ] `src/main/services/oauthCallbackServer.ts` - Reemplazar logger.core
- [ ] `src/main/ipc/oauthHandlers.ts` - Reemplazar logger.core
- [ ] `src/main/services/oauth/OAuthService.ts` - Reemplazar logger.core
- [ ] `src/main/services/oauth/OAuthFlowManager.ts` - Reemplazar logger.core
- [ ] `src/main/services/oauth/OAuthDiscoveryService.ts` - Reemplazar logger.core
- [ ] `src/main/services/oauth/OAuthTokenStore.ts` - Reemplazar logger.core
- [ ] `src/main/services/oauth/OAuthHttpClient.ts` - Reemplazar logger.core
- [ ] `src/main/services/oauth/OAuthRedirectServer.ts` - Reemplazar logger.core
- [ ] `src/main/services/oauth/OAuthStateManager.ts` - Reemplazar logger.core

### Renderer Process
- [ ] `src/renderer/stores/oauthStore.ts` - Agregar import logger
- [ ] `src/renderer/stores/oauthStore.ts` - Reemplazar console.log
- [ ] `src/renderer/stores/oauthStore.ts` - Reemplazar console.error

### Configuración
- [ ] `.env` - Agregar DEBUG_OAUTH=false
- [ ] `.env.local` - Agregar DEBUG_OAUTH=true (opcional)

### Documentación
- [ ] `docs/LOGGING.md` - Agregar oauth a tabla de categorías
- [ ] `docs/LOGGING.md` - Actualizar defaults
- [ ] `docs/LOGGING.md` - Agregar DEBUG_OAUTH a variables
- [ ] `docs/LOGGING.md` - Agregar ejemplos de uso OAuth
- [ ] `docs/LOGGING.md` - Actualizar ubicaciones de uso
- [ ] `docs/LOGGING.md` - Agregar config recomendada para OAuth
- [ ] `CLAUDE.md` - Agregar DEBUG_OAUTH a lista de variables

### Testing
- [ ] Verificar compilación con `pnpm typecheck`
- [ ] Test con DEBUG_OAUTH=true - logs aparecen
- [ ] Test con DEBUG_OAUTH=false - logs no aparecen
- [ ] Test con LOG_LEVEL=info - solo info+ aparecen
- [ ] Test de fallback en renderer
- [ ] Test de file transport
- [ ] Test de colores ANSI en terminal

---

## Tiempo Estimado Total

- **Fase 1 (Core):** 30 minutos
- **Fase 2 (Main Process):** 45 minutos
- **Fase 3 (Renderer):** 15 minutos
- **Fase 4 (Config/Docs):** 15 minutos
- **Testing:** 30 minutos

**Total:** ~2 horas y 15 minutos

---

## Notas Adicionales

### Niveles de Log Recomendados por Contexto

**Debug:**
- Steps del flujo de autorización
- Parsing de metadata
- Generación de PKCE verifier/challenge
- Detalles de requests HTTP

**Info:**
- Discovery exitoso
- Autorización completada
- Tokens obtenidos/refreshed
- Servidor iniciado/detenido

**Warn:**
- Puerto 3000 ocupado (fallback a random)
- Client registration no soportado
- Token próximo a expirar
- Reintentos de requests

**Error:**
- Fallo en discovery
- Fallo en autorización
- Fallo en token exchange
- Errores de red HTTP
- CSRF validation failed

### Contextos Ricos Recomendados

**Para discovery:**
```typescript
{
  serverId: string;
  mcpServerUrl: string;
  authServerId: string;
  hasMetadata: boolean;
  supportedGrants?: string[];
}
```

**Para autorización:**
```typescript
{
  serverId: string;
  hasClientId: boolean;
  scopes: string[];
  codeVerifier?: string;  // Solo en debug
}
```

**Para tokens:**
```typescript
{
  serverId: string;
  expiresAt: number;
  scope: string;
  hasRefreshToken: boolean;
}
```

**Para errores:**
```typescript
{
  serverId: string;
  error: string;
  step: 'discovery' | 'authorization' | 'token_exchange' | 'revocation';
  statusCode?: number;
  retryable?: boolean;
}
```

---

## Conclusión

Este plan proporciona una guía paso a paso completa para integrar el logging de OAuth en el sistema centralizado de Levante. Al seguir estos pasos, se logrará:

1. ✅ **Separación de concerns**: OAuth tiene su propia categoría independiente
2. ✅ **Control granular**: DEBUG_OAUTH permite habilitar/deshabilitar específicamente
3. ✅ **Consistencia**: Mismo patrón que las 8 categorías existentes
4. ✅ **Tipo-seguro**: Full TypeScript support sin breaking changes
5. ✅ **Debugging mejorado**: Logs estructurados con contexto rico para troubleshooting

La implementación es **no invasiva** y sigue exactamente el mismo patrón establecido en el sistema actual, garantizando estabilidad y mantenibilidad a largo plazo.
