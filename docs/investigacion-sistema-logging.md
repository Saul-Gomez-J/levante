# Investigación del Sistema de Logging de Levante

**Fecha de investigación:** 2025-12-23
**Versión de la aplicación:** Levante (Electron Desktop AI Chat)

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Arquitectura del Sistema](#arquitectura-del-sistema)
3. [Categorías de Logging](#categorías-de-logging)
4. [Niveles de Log](#niveles-de-log)
5. [Configuración por Variables de Entorno](#configuración-por-variables-de-entorno)
6. [Sistema IPC de Logging](#sistema-ipc-de-logging)
7. [Tipos de Datos](#tipos-de-datos)
8. [Transports (Salida de Logs)](#transports-salida-de-logs)
9. [Ejemplos de Uso en el Código](#ejemplos-de-uso-en-el-código)
10. [Inicialización y Configuración Global](#inicialización-y-configuración-global)
11. [Manejo de Errores y Fallbacks](#manejo-de-errores-y-fallbacks)
12. [Archivos Clave del Sistema](#archivos-clave-del-sistema)
13. [Conclusiones y Mejoras Potenciales](#conclusiones-y-mejoras-potenciales)

---

## Resumen Ejecutivo

Levante implementa un **sistema de logging centralizado y tipo-seguro** que soporta:

- ✅ **8 categorías especializadas** (ai-sdk, mcp, database, ipc, preferences, models, core, analytics)
- ✅ **4 niveles jerárquicos** (debug, info, warn, error)
- ✅ **Configuración dinámica** mediante variables de entorno
- ✅ **Arquitectura multi-proceso** con comunicación IPC segura
- ✅ **Múltiples transports** (Console con colores ANSI + File)
- ✅ **Zero overhead** cuando una categoría/nivel está deshabilitado
- ✅ **TypeScript tipo-seguro** con interfaces completas
- ✅ **Fallbacks robustos** en caso de fallos de IPC

### Ubicaciones Principales

| Componente | Ruta |
|------------|------|
| Main Logger | `src/main/services/logging/` |
| Renderer Logger | `src/renderer/services/logger.ts` |
| IPC Handlers | `src/main/ipc/loggerHandlers.ts` |
| Preload Bridge | `src/preload/api/logger.ts` |
| Tipos | `src/main/types/logger.ts` |
| Documentación | `docs/LOGGING.md` |

---

## Arquitectura del Sistema

### Diseño Multi-Proceso

El sistema está diseñado para funcionar en un entorno Electron con dos procesos separados:

#### 1. Main Process Logger

**Ubicación:** `src/main/services/logging/`

**Componentes:**
- `logger.ts` - Implementación principal del logger
- `config.ts` - Gestión de configuración desde variables de entorno
- `transports.ts` - Implementación de Console y File transports
- `index.ts` - Exportaciones públicas

**Características:**
- Singleton pattern para instancia única
- Soporte para múltiples transports
- Configuración dinámica en tiempo de ejecución
- Timezone configurable para timestamps

#### 2. Renderer Process Logger

**Ubicación:** `src/renderer/services/logger.ts`

**Características:**
- Cliente ligero que delega al main process via IPC
- Interfaz idéntica al logger principal
- Fallback automático a console si IPC falla
- Singleton pattern

#### 3. Preload Bridge

**Ubicación:** `src/preload/api/logger.ts`

**Función:**
- Expone API segura: `window.levante.logger.*`
- Puente entre renderer e IPC de Electron
- Validación de contexto y seguridad

### Flujo de Comunicación

```
┌─────────────────────────────────────────────────────────────┐
│                    RENDERER PROCESS                         │
│                                                             │
│  App.tsx / Components                                       │
│         ↓                                                   │
│  logger.core.info('message', { context })                   │
│         ↓                                                   │
│  RendererLogger (src/renderer/services/logger.ts)           │
│         ↓                                                   │
│  window.levante.logger.log(...)                             │
└──────────────────────┬──────────────────────────────────────┘
                       │ IPC Channel: levante/logger/log
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                    PRELOAD BRIDGE                           │
│                                                             │
│  loggerApi (src/preload/api/logger.ts)                      │
│         ↓                                                   │
│  ipcRenderer.invoke('levante/logger/log', logMessage)       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                    MAIN PROCESS                             │
│                                                             │
│  IPC Handler (src/main/ipc/loggerHandlers.ts)               │
│         ↓                                                   │
│  logger.log(category, level, message, context)              │
│         ↓                                                   │
│  Logger Instance (src/main/services/logging/logger.ts)      │
│         ↓                                                   │
│  ┌─────────────┐      ┌──────────────┐                     │
│  │  Console    │      │    File      │                     │
│  │  Transport  │      │  Transport   │                     │
│  └─────────────┘      └──────────────┘                     │
│         ↓                     ↓                             │
│    Terminal           ~/levante/levante.log                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Categorías de Logging

El sistema define **8 categorías principales** con propósitos específicos:

### Tabla de Categorías

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

### Configuración de Defaults (Conservadora)

```typescript
const defaultConfig = {
  "ai-sdk": false,     // Deshabilitado por defecto (mucho volumen)
  "mcp": false,        // Deshabilitado por defecto
  "database": false,   // Deshabilitado por defecto
  "ipc": false,        // Deshabilitado por defecto
  "preferences": false, // Deshabilitado por defecto
  "models": true,      // Habilitado (importante para debugging)
  "core": true,        // Habilitado (crítico)
  "analytics": true    // Habilitado (métricas)
};
```

**Rationale de defaults:**
- Categorías de alto volumen (ai-sdk, database, ipc) están deshabilitadas por defecto
- Categorías críticas (core, models, analytics) están habilitadas
- Permite debugging eficiente sin saturar logs en producción

---

## Niveles de Log

### Definición de Niveles

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
```

### Jerarquía de Severidad

```
DEBUG (0) ─┬─→ INFO (1) ─┬─→ WARN (2) ─┬─→ ERROR (3)
           │              │              │
           └──────────────┴──────────────┘
        Aumenta severidad →
```

### Cuándo Usar Cada Nivel

#### 1. `debug` - Información de Traza Detallada

**Uso:**
- Debugging profundo durante desarrollo
- Valores de variables, estados internos
- Flujo de ejecución detallado
- Información que solo es útil al investigar bugs

**Ejemplos:**
```typescript
logger.mcp.debug('mcp-use dynamically loaded and Logger configured');
logger.models.debug(`Trying Ollama endpoint: ${ollamaUrl}`);
logger.aiSdk.debug('Handling PDF attachment', { filename });
```

#### 2. `info` - Mensajes Informativos Generales

**Uso:**
- Operaciones normales exitosas
- Hitos importantes en el ciclo de vida
- Estado de servicios
- Información útil en producción

**Ejemplos:**
```typescript
logger.database.info("Database initialized", { dbPath });
logger.mcp.info("Attempting to connect to server (mcp-use)", { serverId });
logger.core.info("Application initialized successfully");
```

#### 3. `warn` - Advertencias No Críticas

**Uso:**
- Condiciones recuperables
- Comportamiento inesperado pero manejable
- Deprecations
- Configuraciones subóptimas

**Ejemplos:**
```typescript
logger.mcp.warn(`Connection attempt ${attempt}/${maxRetries} failed, retrying...`);
logger.aiSdk.warn("PDF attachment has no data", { attachmentId });
logger.core.warn("Using fallback configuration", { reason });
```

#### 4. `error` - Errores que Requieren Atención

**Uso:**
- Errores que impiden completar una operación
- Excepciones capturadas
- Fallos de servicios externos
- Condiciones que requieren intervención

**Ejemplos:**
```typescript
logger.aiSdk.error("Error processing PDF attachment", { error: error.message });
logger.mcp.error("Failed to connect to MCP server (mcp-use)", { error });
logger.database.error("SQL execution failed", { operation, error });
```

### Control de Nivel Global

Variable de entorno `LOG_LEVEL` controla el nivel mínimo que se escribe:

```bash
LOG_LEVEL=debug   # Escribe todos los niveles
LOG_LEVEL=info    # Escribe info, warn, error (omite debug)
LOG_LEVEL=warn    # Escribe warn, error (omite debug, info)
LOG_LEVEL=error   # Solo escribe error
```

**Lógica de decisión:**
```typescript
const levelPriority = { debug: 0, info: 1, warn: 2, error: 3 };

shouldLog(requestedLevel: LogLevel): boolean {
  return levelPriority[requestedLevel] >= levelPriority[LOG_LEVEL];
}
```

---

## Configuración por Variables de Entorno

### Variables Disponibles

#### Control Maestro

```bash
# Habilita/deshabilita TODO el sistema de logging de debug
DEBUG_ENABLED=true   # Default: true
```

Si `DEBUG_ENABLED=false`, **todas las categorías de debug** son ignoradas, independientemente de sus configuraciones individuales.

#### Control por Categoría

```bash
DEBUG_AI_SDK=true       # AI SDK operations
DEBUG_MCP=true          # MCP server management
DEBUG_DATABASE=true     # Database operations
DEBUG_IPC=true          # Inter-process communication
DEBUG_PREFERENCES=true  # Preferences management
DEBUG_MODELS=true       # Model management
DEBUG_CORE=true         # Application core
DEBUG_ANALYTICS=true    # Analytics events
```

#### Control de Nivel

```bash
LOG_LEVEL=debug   # Nivel mínimo: debug | info | warn | error
```

#### Configuración de File Transport

```bash
LOG_TO_FILE=true                    # Habilita escritura a archivo
LOG_FILE_PATH=./logs/levante.log   # Ruta del archivo de logs
```

### Archivo de Configuración Actual

**`.env.local`** (configuración local del proyecto):

```bash
DEBUG_ENABLED=true
DEBUG_MCP=true
DEBUG_CORE=true
```

**Resultado:** Solo logs de MCP y Core están habilitados en debug. Otras categorías usan sus defaults conservadores.

### Lógica de Evaluación

El logger solo escribe un log si se cumplen **3 condiciones simultáneas**:

```typescript
shouldLog(category: LogCategory, level: LogLevel): boolean {
  return (
    config.isEnabled() &&                    // 1. DEBUG_ENABLED = true
    config.isCategoryEnabled(category) &&    // 2. DEBUG_[CATEGORY] = true
    config.isLevelEnabled(level)             // 3. LOG_LEVEL <= level
  );
}
```

### Ejemplo Práctico

**Configuración:**
```bash
DEBUG_ENABLED=true
DEBUG_AI_SDK=false
DEBUG_CORE=true
LOG_LEVEL=info
```

**Resultados:**

| Llamada | ¿Se escribe? | Razón |
|---------|--------------|-------|
| `logger.aiSdk.debug('...')` | ❌ NO | Categoría ai-sdk deshabilitada |
| `logger.aiSdk.error('...')` | ❌ NO | Categoría ai-sdk deshabilitada |
| `logger.core.debug('...')` | ❌ NO | Nivel debug < info (LOG_LEVEL) |
| `logger.core.info('...')` | ✅ SÍ | Todas las condiciones OK |
| `logger.core.warn('...')` | ✅ SÍ | Todas las condiciones OK |

### Configuraciones Recomendadas

#### Desarrollo Local

```bash
DEBUG_ENABLED=true
DEBUG_AI_SDK=true
DEBUG_MCP=true
DEBUG_DATABASE=true
DEBUG_CORE=true
LOG_LEVEL=debug
LOG_TO_FILE=true
```

#### Producción

```bash
DEBUG_ENABLED=false
LOG_LEVEL=warn
LOG_TO_FILE=true
```

#### Debugging de AI

```bash
DEBUG_ENABLED=true
DEBUG_AI_SDK=true
DEBUG_MODELS=true
LOG_LEVEL=debug
```

#### Debugging de MCP

```bash
DEBUG_ENABLED=true
DEBUG_MCP=true
DEBUG_IPC=true
LOG_LEVEL=debug
```

---

## Sistema IPC de Logging

### Handlers IPC Registrados

**Archivo:** `src/main/ipc/loggerHandlers.ts`

#### 1. `levante/logger/log` - Enviar Mensaje de Log

**Propósito:** Permite al renderer enviar logs al main process.

```typescript
ipcMain.handle(
  'levante/logger/log',
  (_event, logMessage: LogMessage) => {
    const { category, level, message, context } = logMessage;
    logger.log(category, level, message, context);
    return { success: true };
  }
);
```

**Parámetros:**
```typescript
interface LogMessage {
  category: LogCategory;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
}
```

**Respuesta:**
```typescript
{ success: true }
```

#### 2. `levante/logger/isEnabled` - Verificar Estado

**Propósito:** Permite al renderer verificar si una categoría/nivel está habilitado antes de construir logs costosos.

```typescript
ipcMain.handle(
  'levante/logger/isEnabled',
  (_event, category: LogCategory, level: LogLevel) => {
    const enabled = logger.isEnabled(category, level);
    return { success: true, data: enabled };
  }
);
```

**Parámetros:**
```typescript
category: LogCategory
level: LogLevel
```

**Respuesta:**
```typescript
{ success: true, data: boolean }
```

**Uso:**
```typescript
// Evita construir contextos costosos si no se va a loguear
if (await logger.isEnabled('ai-sdk', 'debug')) {
  const expensiveContext = buildExpensiveDebugInfo();
  logger.aiSdk.debug('Expensive debug info', expensiveContext);
}
```

#### 3. `levante/logger/configure` - Reconfigurar en Tiempo Real

**Propósito:** Permite cambiar la configuración del logger sin reiniciar la app.

```typescript
ipcMain.handle(
  'levante/logger/configure',
  (_event, config: Partial<LoggerConfig>) => {
    logger.configure(config);
    return { success: true };
  }
);
```

**Parámetros:**
```typescript
interface LoggerConfig {
  isEnabled: boolean;
  categories: {
    [K in LogCategory]: boolean;
  };
  logLevel: LogLevel;
}
```

**Ejemplo de uso:**
```typescript
// Habilitar logs de database dinámicamente
await window.levante.logger.configure({
  categories: {
    database: true
  }
});
```

### Preload Bridge API

**Archivo:** `src/preload/api/logger.ts`

```typescript
export const loggerApi = {
  log: (
    category: LogCategory,
    level: LogLevel,
    message: string,
    context?: LogContext
  ) =>
    ipcRenderer.invoke('levante/logger/log', {
      category,
      level,
      message,
      context
    }),

  isEnabled: (category: LogCategory, level: LogLevel) =>
    ipcRenderer.invoke('levante/logger/isEnabled', category, level),

  configure: (config: Partial<LoggerConfig>) =>
    ipcRenderer.invoke('levante/logger/configure', config)
};
```

**Exposición segura:**
```typescript
contextBridge.exposeInMainWorld('levante', {
  logger: loggerApi,
  // ... otras APIs
});
```

### Implementación en Renderer

**Archivo:** `src/renderer/services/logger.ts`

```typescript
class RendererLogger implements LoggerService {
  private log(
    category: LogCategory,
    level: LogLevel,
    message: string,
    context?: LogContext
  ): void {
    window.levante.logger
      .log(category, level, message, context)
      .catch((error) => {
        // Fallback a console si IPC falla
        console.error('Logger IPC failed:', error);
        console.log(`[${category}] [${level}]`, message, context);
      });
  }

  async isEnabled(category: LogCategory, level: LogLevel): Promise<boolean> {
    try {
      const result = await window.levante.logger.isEnabled(category, level);
      return result.success && result.data === true;
    } catch (error) {
      console.error('Logger isEnabled check failed:', error);
      return true; // Fallback: asumir habilitado
    }
  }

  // Interfaces por categoría
  get aiSdk(): CategoryLogger {
    return {
      debug: (msg, ctx?) => this.log('ai-sdk', 'debug', msg, ctx),
      info: (msg, ctx?) => this.log('ai-sdk', 'info', msg, ctx),
      warn: (msg, ctx?) => this.log('ai-sdk', 'warn', msg, ctx),
      error: (msg, ctx?) => this.log('ai-sdk', 'error', msg, ctx)
    };
  }
  // ... otras categorías
}
```

---

## Tipos de Datos

**Archivo:** `src/main/types/logger.ts`

### Tipos Principales

```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogCategory =
  | 'ai-sdk'
  | 'mcp'
  | 'database'
  | 'ipc'
  | 'preferences'
  | 'models'
  | 'core'
  | 'analytics';

export type LogContext = Record<string, any>;
```

### Interfaces

#### LogEntry

**Estructura interna del logger:**

```typescript
export interface LogEntry {
  timestamp: Date;
  category: LogCategory;
  level: LogLevel;
  message: string;
  context?: LogContext;
}
```

#### CategoryLogger

**Interfaz de logging por categoría:**

```typescript
export interface CategoryLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}
```

**Uso:**
```typescript
const logger = getLogger();
logger.aiSdk.debug('Model loaded', { modelId: 'gpt-4' });
//     ^^^^^^ CategoryLogger
```

#### LoggerService

**Interfaz principal del logger:**

```typescript
export interface LoggerService {
  // Loggers por categoría
  aiSdk: CategoryLogger;
  mcp: CategoryLogger;
  database: CategoryLogger;
  ipc: CategoryLogger;
  preferences: CategoryLogger;
  models: CategoryLogger;
  core: CategoryLogger;
  analytics: CategoryLogger;

  // Métodos generales
  log(
    category: LogCategory,
    level: LogLevel,
    message: string,
    context?: LogContext
  ): void;

  configure(config: Partial<LoggerConfig>): void;
  isEnabled(category: LogCategory, level: LogLevel): boolean;
}
```

#### LoggerConfig

**Configuración del logger:**

```typescript
export interface LoggerConfig {
  isEnabled: boolean;
  categories: {
    [K in LogCategory]: boolean;
  };
  logLevel: LogLevel;
}
```

#### Transport

**Interfaz para implementar nuevos transports:**

```typescript
export interface Transport {
  write(entry: LogEntry): void;
}
```

---

## Transports (Salida de Logs)

### ConsoleTransport

**Archivo:** `src/main/services/logging/transports.ts`

#### Características

- ✅ **Colores ANSI** para mejor legibilidad en terminal
- ✅ **Formato estructurado:** `[timestamp] [CATEGORY] [LEVEL] message`
- ✅ **Soporte para contextos** con pretty-print
- ✅ **Salida diferenciada** según nivel (console.log/info/warn/error)

#### Código de Colores

```typescript
const colors = {
  debug: '\x1b[36m',    // Cyan
  info: '\x1b[32m',     // Green
  warn: '\x1b[33m',     // Yellow
  error: '\x1b[31m',    // Red
  bold: '\x1b[1m',      // Bold
  category: '\x1b[35m', // Magenta
  reset: '\x1b[0m'      // Reset
};
```

#### Formato de Salida

**Sin contexto:**
```
[2025-01-15 14:30:25] [MCP] [INFO] Successfully connected to MCP server (mcp-use)
```

**Con contexto:**
```
[2025-01-15 14:30:25] [MCP] [INFO] Successfully connected to MCP server (mcp-use)
  serverId: "filesystem"
  tools: 12
  status: "healthy"
```

#### Implementación

```typescript
export class ConsoleTransport implements Transport {
  write(entry: LogEntry): void {
    const timestamp = this.formatTimestamp(entry.timestamp);
    const category = entry.category.toUpperCase();
    const level = entry.level.toUpperCase();

    // Construir mensaje con colores
    const coloredMessage = `${colors.bold}[${timestamp}] ${colors.category}[${category}]${colors.reset} ${colors[entry.level]}[${level}]${colors.reset} ${entry.message}`;

    // Seleccionar método de console según nivel
    const consoleMethod = this.getConsoleMethod(entry.level);
    consoleMethod(coloredMessage);

    // Imprimir contexto si existe
    if (entry.context && Object.keys(entry.context).length > 0) {
      this.printContext(entry.context, consoleMethod);
    }
  }

  private getConsoleMethod(level: LogLevel) {
    switch (level) {
      case 'debug': return console.log;
      case 'info': return console.info;
      case 'warn': return console.warn;
      case 'error': return console.error;
    }
  }
}
```

### FileTransport

**Archivo:** `src/main/services/logging/transports.ts`

#### Características

- ✅ **Escritura sincrónica** a archivo
- ✅ **Formato legible** sin colores ANSI
- ✅ **Contextos en JSON** para parseo
- ✅ **Creación automática** de directorio
- ✅ **Append mode** para preservar logs históricos

#### Configuración

```typescript
const logFilePath = process.env.LOG_FILE_PATH || '.logs/levante.log';
const logToFile = process.env.LOG_TO_FILE !== 'false'; // Default: true
```

#### Formato de Salida

```
[2025-01-15 14:30:25] [MCP] [INFO] Successfully connected to MCP server (mcp-use) {"serverId":"filesystem","tools":12,"status":"healthy"}
```

#### Implementación

```typescript
export class FileTransport implements Transport {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.ensureLogDirectory();
  }

  write(entry: LogEntry): void {
    const timestamp = this.formatTimestamp(entry.timestamp);
    const category = entry.category.toUpperCase();
    const level = entry.level.toUpperCase();

    let logLine = `[${timestamp}] [${category}] [${level}] ${entry.message}`;

    // Agregar contexto como JSON
    if (entry.context && Object.keys(entry.context).length > 0) {
      logLine += ' ' + JSON.stringify(entry.context);
    }

    logLine += '\n';

    // Escribir sincrónico (append)
    fs.appendFileSync(this.filePath, logLine, 'utf-8');
  }

  private ensureLogDirectory(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
```

### Registro de Transports

**Archivo:** `src/main/services/logging/logger.ts`

```typescript
class Logger implements LoggerService {
  private transports: Transport[] = [];

  constructor(
    private configService: LoggerConfigService,
    transports: Transport[]
  ) {
    this.transports = transports;
  }

  log(category, level, message, context?): void {
    if (!this.configService.shouldLog(category, level)) {
      return; // Zero overhead
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      category,
      level,
      message,
      context
    };

    // Escribir a todos los transports
    for (const transport of this.transports) {
      try {
        transport.write(entry);
      } catch (error) {
        console.error('Logger transport error:', error);
      }
    }
  }
}

// Creación del logger con transports
export function createLogger(): Logger {
  const transports: Transport[] = [
    new ConsoleTransport()
  ];

  if (process.env.LOG_TO_FILE !== 'false') {
    const filePath = process.env.LOG_FILE_PATH || '.logs/levante.log';
    transports.push(new FileTransport(filePath));
  }

  return new Logger(new LoggerConfigService(), transports);
}
```

### Extensibilidad

Para agregar un nuevo transport (ej: Sentry, LogStash, CloudWatch):

```typescript
// 1. Implementar la interfaz Transport
class SentryTransport implements Transport {
  write(entry: LogEntry): void {
    if (entry.level === 'error') {
      Sentry.captureMessage(entry.message, {
        level: 'error',
        extra: entry.context
      });
    }
  }
}

// 2. Registrar en createLogger()
transports.push(new SentryTransport());
```

### Timezone Configuration

**Funciones disponibles:**

```typescript
// Configurar timezone para timestamps
setLogTimezone(timezone: string): void;  // 'auto' | IANA timezone

// Obtener timezone actual
getLogTimezone(): string;
```

**Uso en inicialización:**

```typescript
// src/main/lifecycle/initialization.ts
const timezone = preferencesService.get("timezone");
if (timezone) {
  setLogTimezone(timezone);
  logger.core.info("Log timezone configured", { timezone });
}
```

**Valores soportados:**
- `'auto'` - Usa timezone del sistema
- `'America/New_York'` - IANA timezone name
- `'Europe/Madrid'` - IANA timezone name
- etc.

---

## Ejemplos de Uso en el Código

### Main Process - aiService.ts

**Manejo de attachments PDF:**

```typescript
// Debug: información de traza
logger.aiSdk.debug('Handling PDF attachment', {
  filename,
  size: pdfData.length
});

// Info: operación normal
logger.aiSdk.info('Using native PDF support (model supports vision)', {
  modelId,
  provider
});

// Warn: condición recuperable
logger.aiSdk.warn("PDF attachment has no data", {
  attachmentId,
  filename
});

// Error: fallo en operación
logger.aiSdk.error("Error processing PDF attachment", {
  error: error.message,
  stack: error.stack,
  attachmentId
});
```

### Main Process - databaseService.ts

**Operaciones de base de datos:**

```typescript
// Inicialización
logger.database.info("Database initialized", {
  dbPath,
  version: schemaVersion
});

// Debug de queries
logger.database.debug("SQL execution", {
  operation: 'SELECT',
  table: 'chat_sessions',
  sql: query
});

// Errores de SQL
logger.database.error("SQL execution failed", {
  operation,
  duration: `${Date.now() - startTime}ms`,
  error: error.message,
  sql: query
});
```

### Main Process - mcpUseService.ts

**Gestión de servidores MCP:**

```typescript
// Debug de inicialización
logger.mcp.debug('mcp-use dynamically loaded and Logger configured');

// Info de conexión
logger.mcp.info("Attempting to connect to server (mcp-use)", {
  serverId,
  transport: config.transport,
  command: config.command
});

// Warn de reintentos
logger.mcp.warn(
  `Connection attempt ${attempt}/${maxRetries} failed, retrying...`,
  {
    serverId,
    error: error.message,
    nextRetryIn: `${retryDelay}ms`
  }
);

// Error de conexión
logger.mcp.error("Failed to connect to MCP server (mcp-use)", {
  serverId,
  error: error.message,
  stack: error.stack,
  attempts: maxRetries
});
```

### Main Process - modelFetchService.ts

**Fetch de modelos:**

```typescript
// Debug de endpoints
logger.models.debug(`Trying Ollama endpoint: ${ollamaUrl}`);

// Info de éxito
logger.models.info("Models fetched from OpenRouter", {
  count: models.length,
  endpoint: baseUrl
});

// Error de fetch
logger.models.error("Failed to fetch OpenRouter models", {
  error: error.message,
  endpoint: baseUrl,
  statusCode: error.response?.status
});
```

### Main Process - preferencesService.ts

**Gestión de preferencias:**

```typescript
// Inicialización
logger.preferences.info("PreferencesService initialized", {
  storePath: store.path,
  encryptionEnabled: true
});

// Configuración de timezone
logger.preferences.info('Log timezone updated', {
  timezone,
  previousTimezone
});

// Error de inicialización
logger.preferences.error("Failed to initialize PreferencesService", {
  error: error.message,
  storePath
});
```

### Renderer Process - App.tsx

**Carga de configuración:**

```typescript
import { logger } from '@/services/logger';

// Info de carga exitosa
logger.core.info('Language loaded from preferences', {
  language,
  source: 'preferences'
});

// Error de carga
logger.core.error('Failed to load user preferences', {
  error: error.message,
  component: 'App'
});

// Debug de tema
logger.core.debug('Theme applied (system)', {
  theme,
  systemPrefersDark,
  themeSource: 'system',
  appliedClass: 'dark'
});
```

### Renderer Process - ChatPage.tsx

**Operaciones de chat:**

```typescript
// Info de envío de mensaje
logger.core.info('Sending message to AI', {
  sessionId: currentSession.id,
  modelId: currentModel.id,
  messageLength: message.length
});

// Error de streaming
logger.core.error('AI streaming error', {
  error: error.message,
  sessionId,
  modelId
});
```

### Uso Avanzado con isEnabled

**Evitar construcción de contextos costosos:**

```typescript
// Malo: siempre construye el contexto, aunque debug esté deshabilitado
logger.aiSdk.debug('Expensive operation', buildExpensiveDebugInfo());

// Bueno: solo construye si se va a loguear
if (await logger.isEnabled('ai-sdk', 'debug')) {
  const debugInfo = buildExpensiveDebugInfo(); // Costoso
  logger.aiSdk.debug('Expensive operation', debugInfo);
}
```

---

## Inicialización y Configuración Global

### Archivo Principal

**Ubicación:** `src/main/lifecycle/initialization.ts`

### Secuencia de Inicialización

```typescript
import { getLogger, setLogTimezone } from "../services/logging";

export async function initializeApp(): Promise<void> {
  // 1. Obtener instancia singleton del logger
  const logger = getLogger();
  logger.core.info("Starting application initialization");

  // 2. Inicializar servicios fundamentales primero
  try {
    await databaseService.initialize();
    logger.core.info("Database initialized successfully");
  } catch (error) {
    logger.core.error("Failed to initialize database", {
      error: error.message
    });
    throw error;
  }

  // 3. Ejecutar migraciones de configuración
  try {
    await configMigrationService.runMigrations();
    logger.core.info("Config migrations completed successfully");
  } catch (error) {
    logger.core.error("Config migration failed", {
      error: error.message
    });
  }

  // 4. Configurar timezone desde preferencias
  try {
    const timezone = preferencesService.get("timezone");
    if (timezone) {
      setLogTimezone(timezone);
      logger.preferences.info("Log timezone configured", { timezone });
    }
  } catch (error) {
    logger.preferences.warn("Failed to configure log timezone", {
      error: error.message
    });
  }

  // 5. Registrar handlers IPC
  setupLoggerHandlers();   // Crítico: habilita logging desde renderer
  setupDatabaseHandlers();
  setupPreferencesHandlers();
  setupUserProfileHandlers();
  setupModelsHandlers();
  setupChatHandlers();
  setupMCPHandlers();
  logger.ipc.info("IPC handlers registered successfully");

  // 6. Inicializar servicios adicionales
  try {
    await mcpService.initialize();
    logger.mcp.info("MCP service initialized");
  } catch (error) {
    logger.mcp.error("MCP initialization failed", {
      error: error.message
    });
  }

  logger.core.info("Application initialization completed");
}
```

### Función initializeLogger()

```typescript
// src/main/services/logging/index.ts

let loggerInstance: Logger | null = null;

export function getLogger(): Logger {
  if (!loggerInstance) {
    loggerInstance = createLogger();
  }
  return loggerInstance;
}

export function initializeLogger(): void {
  const logger = getLogger();
  // Cargar configuración desde variables de entorno
  (logger as any).configService.initializeFromEnvironment();
}
```

**Llamada en main.ts:**

```typescript
// src/main/index.ts
import { initializeLogger } from './services/logging';

app.whenReady().then(async () => {
  // Inicializar logger antes que nada
  initializeLogger();

  // Inicializar aplicación
  await initializeApp();

  // Crear ventanas
  createWindow();
});
```

### Orden de Inicialización Crítico

```
1. initializeLogger()           → Carga config de .env
2. getLogger()                  → Singleton del logger
3. databaseService.initialize() → BD lista para logs de DB
4. configMigrationService       → Migra preferencias
5. setLogTimezone()             → Configura zona horaria
6. setupLoggerHandlers()        → Habilita IPC desde renderer
7. Otros servicios e IPC        → Usan logger normalmente
```

**Importancia del orden:**
- Logger debe inicializarse primero para capturar logs de otros servicios
- IPC handlers deben registrarse para que renderer pueda loguear
- Timezone debe configurarse después de cargar preferencias

---

## Manejo de Errores y Fallbacks

### En Main Process

#### Fallback en Transports

```typescript
class Logger implements LoggerService {
  log(category, level, message, context?): void {
    if (!this.configService.shouldLog(category, level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      category,
      level,
      message,
      context
    };

    // Escribir a todos los transports con try-catch individual
    for (const transport of this.transports) {
      try {
        transport.write(entry);
      } catch (error) {
        // Fallback a console.error si transport falla
        console.error(`Logger transport error:`, error);
        console.error(`Original log entry:`, entry);
      }
    }
  }
}
```

**Ventajas:**
- Si FileTransport falla (disco lleno, permisos), ConsoleTransport sigue funcionando
- Errores de logging no bloquean la aplicación
- Se preserva el log original en console

#### Manejo de Errores en Inicialización

```typescript
export function createLogger(): Logger {
  const transports: Transport[] = [
    new ConsoleTransport() // Siempre presente
  ];

  // Agregar FileTransport con try-catch
  if (process.env.LOG_TO_FILE !== 'false') {
    try {
      const filePath = process.env.LOG_FILE_PATH || '.logs/levante.log';
      transports.push(new FileTransport(filePath));
    } catch (error) {
      console.error('Failed to initialize FileTransport:', error);
      // Continúa con solo ConsoleTransport
    }
  }

  return new Logger(new LoggerConfigService(), transports);
}
```

### En Renderer Process

#### Fallback de IPC a Console

```typescript
class RendererLogger implements LoggerService {
  private log(
    category: LogCategory,
    level: LogLevel,
    message: string,
    context?: LogContext
  ): void {
    window.levante.logger
      .log(category, level, message, context)
      .catch((error) => {
        // Fallback automático a console si IPC falla
        console.error('Logger IPC failed:', error);

        // Formatear similar al logger principal
        const timestamp = new Date().toISOString();
        const formatted = `[${timestamp}] [${category}] [${level}] ${message}`;

        // Seleccionar método de console según nivel
        const consoleMethod = this.getConsoleMethod(level);
        consoleMethod(formatted);

        // Imprimir contexto si existe
        if (context && Object.keys(context).length > 0) {
          consoleMethod(context);
        }
      });
  }

  private getConsoleMethod(level: LogLevel) {
    switch (level) {
      case 'debug': return console.log;
      case 'info': return console.info;
      case 'warn': return console.warn;
      case 'error': return console.error;
    }
  }
}
```

**Escenarios de fallback:**
- Main process no está disponible
- IPC channel no está registrado
- Timeout de IPC
- Error en preload bridge

#### Fallback en isEnabled()

```typescript
async isEnabled(category: LogCategory, level: LogLevel): Promise<boolean> {
  try {
    const result = await window.levante.logger.isEnabled(category, level);
    return result.success && result.data === true;
  } catch (error) {
    console.error('Logger isEnabled check failed:', error);
    // Fallback: asumir que está habilitado para no perder logs
    return true;
  }
}
```

**Rationale:**
- Si IPC falla, es mejor loguear de más que perder información crítica
- El main process filtrará si es necesario

### Manejo de Errores en Contextos

```typescript
// Evitar que errores en construcción de contexto bloqueen el log
try {
  const context = {
    modelId: model.id,
    provider: model.provider,
    // Esto podría lanzar error
    metadata: JSON.parse(model.rawMetadata)
  };
  logger.aiSdk.info('Model loaded', context);
} catch (error) {
  // Loguear sin contexto si falla
  logger.aiSdk.info('Model loaded');
  logger.aiSdk.warn('Failed to build log context', {
    error: error.message
  });
}
```

### Singleton Safety

```typescript
// Main Process
let loggerInstance: Logger | null = null;

export function getLogger(): Logger {
  if (!loggerInstance) {
    loggerInstance = createLogger();
  }
  return loggerInstance;
}

// Renderer Process
let rendererLoggerInstance: RendererLogger | null = null;

export function getRendererLogger(): RendererLogger {
  if (!rendererLoggerInstance) {
    rendererLoggerInstance = createRendererLogger();
  }
  return rendererLoggerInstance;
}

export const logger = getRendererLogger();
```

**Garantías:**
- Solo una instancia por proceso
- Thread-safe en main process (Node.js single-threaded)
- Evita múltiples FileTransports escribiendo al mismo archivo

---

## Archivos Clave del Sistema

### Tabla de Archivos

| Ruta | Propósito | LOC | Responsabilidad |
|------|-----------|-----|-----------------|
| `src/main/services/logging/logger.ts` | Implementación principal | 135 | Core del logger, CategoryLoggers, singleton |
| `src/main/services/logging/config.ts` | Gestión de configuración | 130 | Lectura de env vars, shouldLog(), configure() |
| `src/main/services/logging/transports.ts` | Console + File transports | 212 | Escritura formateada a console y archivo |
| `src/main/services/logging/index.ts` | Exportaciones públicas | 30 | API pública del logger |
| `src/main/types/logger.ts` | Definiciones TypeScript | 54 | Tipos, interfaces, enums |
| `src/main/ipc/loggerHandlers.ts` | Handlers IPC | 59 | Registro de 3 endpoints IPC |
| `src/renderer/services/logger.ts` | Logger del renderer | 106 | Cliente IPC, fallbacks, CategoryLoggers |
| `src/preload/api/logger.ts` | Bridge de preload | 14 | contextBridge para logger |
| `docs/LOGGING.md` | Documentación completa | 337 | Guía de usuario y referencia |

### Mapa de Dependencias

```
src/main/index.ts
  └─→ src/main/lifecycle/initialization.ts
       └─→ src/main/services/logging/index.ts
            ├─→ src/main/services/logging/logger.ts
            │    ├─→ src/main/services/logging/config.ts
            │    └─→ src/main/services/logging/transports.ts
            └─→ src/main/types/logger.ts

src/main/ipc/loggerHandlers.ts
  └─→ src/main/services/logging/index.ts

src/preload/index.ts
  └─→ src/preload/api/logger.ts
       └─→ (expone via contextBridge)

src/renderer/App.tsx
  └─→ src/renderer/services/logger.ts
       └─→ window.levante.logger (IPC)
```

### Ubicaciones de Uso

**51 archivos** usan el logger activamente:

**Main Process (Services):**
- `aiService.ts` - 15 usos (ai-sdk)
- `databaseService.ts` - 22 usos (database)
- `mcpUseService.ts` - 28 usos (mcp)
- `mcpLegacyService.ts` - 18 usos (mcp)
- `modelFetchService.ts` - 12 usos (models)
- `preferencesService.ts` - 8 usos (preferences)
- `userProfileService.ts` - 5 usos (preferences)
- `initialization.ts` - 14 usos (core)
- `window.ts` - 7 usos (core)

**Renderer Process (Components):**
- `App.tsx` - 6 usos (core)
- `ChatPage.tsx` - 4 usos (core)
- `ModelPage.tsx` - 3 usos (models)
- `SettingsPage.tsx` - 2 usos (preferences)

**Handlers IPC:**
- `chatHandlers.ts` - 5 usos (ipc)
- `mcpHandlers.ts` - 8 usos (ipc, mcp)
- `modelsHandlers.ts` - 3 usos (ipc, models)

---

## Conclusiones y Mejoras Potenciales

### Fortalezas del Sistema Actual

#### ✅ Diseño Robusto

1. **Tipo-seguro con TypeScript**
   - Todos los tipos están definidos explícitamente
   - Autocompletado completo en IDEs
   - Detección de errores en compile-time

2. **Arquitectura Multi-Proceso Bien Diseñada**
   - Comunicación IPC segura via contextBridge
   - Fallbacks automáticos en caso de fallos
   - Zero-dependency en renderer (100% via IPC)

3. **Performance Optimizado**
   - Zero overhead cuando categoría/nivel está deshabilitado
   - Evaluación lazy de contextos
   - Singleton pattern evita instancias duplicadas

4. **Extensibilidad**
   - Interfaz `Transport` permite agregar nuevos destinos fácilmente
   - Sistema de categorías extensible
   - Configuración dinámica en runtime

5. **Developer Experience**
   - API intuitiva por categoría: `logger.aiSdk.info(...)`
   - Documentación completa en `docs/LOGGING.md`
   - Colores ANSI para mejor legibilidad

### Áreas de Mejora Potencial

#### 1. Structured Logging Enhancement

**Problema:** Contextos son `Record<string, any>`, sin validación.

**Propuesta:**
```typescript
// Definir schemas por categoría
interface AiSdkContext {
  modelId?: string;
  provider?: string;
  duration?: number;
  tokenCount?: number;
}

interface McpContext {
  serverId?: string;
  toolName?: string;
  transport?: string;
}

// Uso tipo-seguro
logger.aiSdk.info<AiSdkContext>('Model loaded', {
  modelId: 'gpt-4',
  provider: 'openai'
  // ❌ Error: 'invalidField' no existe en AiSdkContext
});
```

**Beneficios:**
- Autocompletado de campos de contexto
- Validación en compile-time
- Mejor documentación implícita

#### 2. Log Rotation para FileTransport

**Problema:** `levante.log` crece indefinidamente.

**Propuesta:**
```typescript
class RotatingFileTransport implements Transport {
  private maxFileSize = 10 * 1024 * 1024; // 10MB
  private maxFiles = 5; // levante.log.1, .2, .3, .4, .5

  write(entry: LogEntry): void {
    if (this.shouldRotate()) {
      this.rotate();
    }
    fs.appendFileSync(this.filePath, this.format(entry));
  }

  private rotate(): void {
    // levante.log → levante.log.1
    // levante.log.1 → levante.log.2
    // ...
    // levante.log.4 → levante.log.5 (eliminar .5 si existe)
  }
}
```

**Alternativa:** Usar librería probada como `winston` o `pino` con rotation built-in.

#### 3. Remote Logging Transport

**Problema:** No hay forma de recolectar logs de usuarios en producción.

**Propuesta:**
```typescript
class RemoteTransport implements Transport {
  constructor(
    private endpoint: string,
    private minLevel: LogLevel = 'warn' // Solo warn y error
  ) {}

  write(entry: LogEntry): void {
    if (levelPriority[entry.level] < levelPriority[this.minLevel]) {
      return; // No enviar debug/info en producción
    }

    // Enviar async a servidor de logs
    this.sendToRemote(entry).catch(console.error);
  }

  private async sendToRemote(entry: LogEntry): Promise<void> {
    await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
  }
}
```

**Consideraciones:**
- Privacy: no enviar información sensible
- Rate limiting: evitar flood
- Batch: agrupar múltiples logs
- Opt-in: requerir consentimiento del usuario

#### 4. Performance Metrics

**Propuesta:** Agregar métricas automáticas de performance.

```typescript
logger.aiSdk.withTiming('Model inference', async () => {
  const result = await generateText(...);
  return result;
});

// Output:
// [INFO] Model inference completed in 1,234ms
```

**Implementación:**
```typescript
interface CategoryLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;

  // Nuevo método
  withTiming<T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T>;
}
```

#### 5. Log Search y Analytics

**Problema:** Archivo de log plano dificulta búsqueda y análisis.

**Propuesta:** Agregar comando de análisis:

```bash
# Buscar errores de MCP en las últimas 24h
pnpm log:search --category=mcp --level=error --since=24h

# Ver estadísticas
pnpm log:stats --category=ai-sdk --since=1w

# Output:
# AI SDK Logs (Last 7 days):
# - Debug: 1,234
# - Info: 567
# - Warn: 12
# - Error: 3
#
# Top errors:
# 1. "Failed to connect to OpenAI" (2 times)
# 2. "PDF processing timeout" (1 time)
```

**Implementación:**
```typescript
// scripts/log-analyzer.ts
import fs from 'fs';

interface LogStats {
  category: LogCategory;
  counts: Record<LogLevel, number>;
  errors: Array<{ message: string; count: number }>;
}

function analyzeLogFile(filePath: string, options: {
  category?: LogCategory;
  level?: LogLevel;
  since?: string; // '24h', '7d', etc.
}): LogStats {
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  // Parse y agregar estadísticas
  // ...
}
```

#### 6. Log Levels Granulares por Categoría

**Problema:** `LOG_LEVEL` es global, no permite granularidad.

**Propuesta:**
```bash
# Nivel global debug, pero ai-sdk solo info+
LOG_LEVEL=debug
LOG_LEVEL_AI_SDK=info
LOG_LEVEL_MCP=debug
LOG_LEVEL_DATABASE=warn
```

**Implementación:**
```typescript
class LoggerConfigService {
  shouldLog(category: LogCategory, level: LogLevel): boolean {
    const categoryLevel = this.getCategoryLevel(category);
    return (
      this.config.isEnabled &&
      this.config.categories[category] &&
      levelPriority[level] >= levelPriority[categoryLevel]
    );
  }

  private getCategoryLevel(category: LogCategory): LogLevel {
    const envVar = `LOG_LEVEL_${category.toUpperCase().replace('-', '_')}`;
    return process.env[envVar] as LogLevel || this.config.logLevel;
  }
}
```

#### 7. Testing Utilities

**Problema:** Difícil testear código que usa logger.

**Propuesta:**
```typescript
// tests/utils/mockLogger.ts
export function createMockLogger(): LoggerService {
  const logs: LogEntry[] = [];

  return {
    aiSdk: {
      debug: (msg, ctx?) => logs.push({ category: 'ai-sdk', level: 'debug', message: msg, context: ctx }),
      // ...
    },
    // ...

    // Helpers para tests
    getLogs: () => logs,
    getLogsByCategory: (category) => logs.filter(l => l.category === category),
    clear: () => logs.splice(0, logs.length)
  };
}

// Uso en tests
test('should log model loading', () => {
  const mockLogger = createMockLogger();
  const service = new ModelService(mockLogger);

  service.loadModel('gpt-4');

  const logs = mockLogger.getLogsByCategory('models');
  expect(logs).toHaveLength(1);
  expect(logs[0].message).toContain('Model loaded');
  expect(logs[0].context.modelId).toBe('gpt-4');
});
```

#### 8. Contextual Logging (Scoped Logger)

**Propuesta:** Logger con contexto persistente.

```typescript
// Crear logger con contexto
const scopedLogger = logger.withContext({
  sessionId: '123',
  userId: 'abc'
});

// Todos los logs incluyen el contexto automáticamente
scopedLogger.aiSdk.info('Message sent');
// Output: [AI-SDK] [INFO] Message sent { sessionId: '123', userId: 'abc' }

scopedLogger.aiSdk.error('Failed to send', { error: 'Timeout' });
// Output: [AI-SDK] [ERROR] Failed to send { sessionId: '123', userId: 'abc', error: 'Timeout' }
```

**Implementación:**
```typescript
interface LoggerService {
  // ... métodos existentes

  withContext(context: LogContext): LoggerService;
}

class Logger implements LoggerService {
  constructor(
    private configService: LoggerConfigService,
    private transports: Transport[],
    private persistentContext: LogContext = {}
  ) {}

  withContext(context: LogContext): LoggerService {
    return new Logger(
      this.configService,
      this.transports,
      { ...this.persistentContext, ...context }
    );
  }

  log(category, level, message, context?): void {
    // Merge persistent context con contexto de llamada
    const mergedContext = {
      ...this.persistentContext,
      ...context
    };

    // ... resto de la lógica
  }
}
```

### Priorización de Mejoras

**Alta prioridad:**
1. **Log Rotation** - Evita archivos gigantes en producción
2. **Testing Utilities** - Facilita desarrollo con TDD

**Media prioridad:**
3. **Structured Logging** - Mejora developer experience
4. **Performance Metrics** - Útil para debugging
5. **Log Levels Granulares** - Mayor control en producción

**Baja prioridad:**
6. **Remote Logging** - Solo necesario si hay telemetría
7. **Log Search** - Alternativas: usar `grep`, `jq` en archivo
8. **Contextual Logging** - Nice to have, no crítico

---

## Resumen Final

El sistema de logging de Levante es un **ejemplo de arquitectura bien diseñada** para aplicaciones Electron:

### Puntos Clave

1. **Tipo-seguro y robusto** con TypeScript
2. **Multi-proceso** con IPC y fallbacks
3. **Configurable** via variables de entorno
4. **Extensible** con sistema de transports
5. **Performance** optimizado (zero overhead cuando deshabilitado)
6. **Developer-friendly** con API por categorías

### Estado Actual

- ✅ Completamente funcional en producción
- ✅ Usado extensivamente en 51 archivos
- ✅ Documentación completa en `docs/LOGGING.md`
- ✅ Configuración activa en `.env.local`

### Recomendaciones

Para el desarrollo futuro:

1. **Mantener el diseño actual** - Es sólido y probado
2. **Agregar log rotation** - Para prevenir archivos gigantes
3. **Considerar structured logging** - Para mejor autocompletado
4. **Crear mock utilities** - Para facilitar testing

El sistema no requiere refactoring mayor, solo mejoras incrementales según necesidades.
