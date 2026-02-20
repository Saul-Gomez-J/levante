# Flujo de Instalación de MCPs en Levante

> Análisis detallado del sistema completo de instalación de servidores MCP, tanto desde la UI directa como a través de dynamic links (deep links).

---

## Índice

1. [Flujo de Instalación Directa desde UI](#1-flujo-de-instalación-directa-desde-ui)
2. [Flujo de Dynamic Link (Deep Links)](#2-flujo-de-dynamic-link-deep-links)
3. [Arquitectura de Servicios e IPC](#3-arquitectura-de-servicios-e-ipc)
4. [Persistencia y Estado](#4-persistencia-y-estado)
5. [Manejo de Errores](#5-manejo-de-errores)
6. [Diagrama Visual Completo](#6-diagrama-visual-completo)

---

## 1. Flujo de Instalación Directa desde UI

### 1.1 Archivos Involucrados

| Capa | Archivo |
|------|---------|
| UI Component | `src/renderer/components/mcp/config/AddMCPTabs.tsx` |
| Form Component | `src/renderer/components/mcp/config/FormMCPConfig.tsx` |
| Custom JSON Editor | `src/renderer/components/mcp/config/CustomMCPConfig.tsx` |
| Zustand Store | `src/renderer/stores/mcpStore.ts` |
| Config Hook | `src/renderer/hooks/useMCPConfig.ts` |
| IPC Handler Config | `src/main/ipc/mcpHandlers/configuration.ts` |
| IPC Handler Connection | `src/main/ipc/mcpHandlers/connection.ts` |
| Config Manager | `src/main/services/mcpConfigManager.ts` |

### 1.2 Paso a Paso

#### Paso 1 — El usuario inicia la adición

El usuario navega a la página **Store** y selecciona "Agregar MCP". Se abre el modal `AddMCPTabs`, que ofrece dos pestañas:
- **Form Tab** (`FormMCPConfig.tsx`): Campos guiados
- **Custom Tab** (`CustomMCPConfig.tsx`): Editor JSON directo

#### Paso 2 — Ingreso de configuración

El usuario completa los campos según el tipo de transporte:

**Para tipo `stdio`:**
- Nombre del servidor (obligatorio)
- Comando a ejecutar (ej: `npx`, `python`)
- Argumentos
- Variables de entorno (pares clave-valor)

**Para tipo `http` / `sse` / `streamable-http`:**
- Nombre del servidor (obligatorio)
- URL del servidor
- Tipo de autenticación (`none` o `bearer`)
- Bearer token (si aplica)
- Headers personalizados

#### Paso 3 — Validación en renderer

El hook `useMCPConfig` valida:
- Nombre no vacío
- Para STDIO: comando no vacío
- Para HTTP: URL válida y bien formada

```typescript
// FormMCPConfig.handleSave()
if (!validate()) return; // Se detiene si hay errores
```

#### Paso 4 — Construcción del objeto de configuración

Se construye el objeto `MCPServerConfig`:

```typescript
{
  id: "sanitized-name",       // Generado desde el nombre
  name: "User Friendly Name",
  transport: "stdio" | "http",

  // Para STDIO:
  command: "npx",
  args: ["package-name"],
  env: { KEY: "value" },

  // Para HTTP:
  url: "https://api.example.com",
  headers: { "Authorization": "Bearer token" }
}
```

#### Paso 5 — Envío al main process via IPC

Desde `mcpStore.ts` se ejecutan **dos operaciones en secuencia**:

```typescript
// 1. Guardar configuración en disco
const addResult = await window.levante.mcp.addServer(finalConfig);

// 2. Conectar en runtime
await connectServer(finalConfig);
```

El IPC handler correspondiente en `configuration.ts`:

```typescript
ipcMain.handle("levante/mcp/add-server", async (_, config: MCPServerConfig) => {
  try {
    await configManager.addServer(config);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});
```

#### Paso 6 — Persistencia en disco

`mcpConfigManager.ts` realiza:
1. **Sanitización**: Elimina claves peligrosas (`__proto__`, `constructor`, `prototype`)
2. **Normalización**: Convierte alias (`type` → `transport`, `url` → `baseUrl` si aplica)
3. **Escritura**: Guarda en el archivo de configuración `.mcp.json`

```typescript
async addServer(config: MCPServerConfig): Promise<void> {
  const currentConfig = await this.loadConfiguration();
  const sanitizedConfig = this.sanitizeServerConfig(config);
  const normalizedConfig = this.normalizeServerConfig(sanitizedConfig);

  const { id, ...serverConfig } = normalizedConfig;
  currentConfig.mcpServers[id] = serverConfig;

  await this.saveConfiguration(currentConfig);
}
```

Formato en disco (`.mcp.json`):

```json
{
  "mcpServers": {
    "my-server": {
      "name": "My MCP Server",
      "transport": "stdio",
      "command": "npx",
      "args": ["@package/name"],
      "env": { "API_KEY": "${API_KEY}" }
    }
  },
  "disabled": {}
}
```

#### Paso 7 — Conexión en runtime

El handler de conexión (`connection.ts`) conecta el servidor y lo registra en el estado:

```typescript
ipcMain.handle("levante/mcp/connect-server", async (_, config: MCPServerConfig) => {
  try {
    await mcpService.connectServer(config);

    // Si estaba en "disabled", lo habilita
    const currentConfig = await configManager.loadConfiguration();
    if (currentConfig.disabled?.[config.id]) {
      await configManager.enableServer(config.id);
    } else if (!currentConfig.mcpServers[config.id]) {
      await configManager.addServer(config);
    }

    return { success: true };
  } catch (error: any) {
    if (error.code === 'OAUTH_REQUIRED') {
      return { success: false, errorCode: 'OAUTH_REQUIRED', metadata: { ... } };
    }
    // ... otros tipos de error
  }
});
```

#### Paso 8 — Actualización del store Zustand

```typescript
connectServer: async (config: MCPServerConfig) => {
  set({ isLoading: true });

  const result = await window.levante.mcp.connectServer(config);

  if (result.success) {
    set(state => ({
      activeServers: [...state.activeServers, { ...config, enabled: true }],
      connectionStatus: { ...state.connectionStatus, [config.id]: 'connected' }
    }));

    window.levante.analytics?.trackMCP?.(config.name || config.id, 'active');
  }
};
```

#### Paso 9 — Feedback al usuario

- Toast de éxito: "MCP Server added and connected"
- Modal se cierra
- El servidor aparece en la lista de servidores activos

---

## 2. Flujo de Dynamic Link (Deep Links)

### 2.1 Registro del Protocolo

**Archivo**: `src/main/main.ts`

```typescript
if (process.defaultApp) {
  // Modo desarrollo
  app.setAsDefaultProtocolClient("levante", process.execPath, [join(__dirname, "../../")]);
} else {
  // Modo producción
  app.setAsDefaultProtocolClient("levante");
}
```

**URL Scheme**: `levante://`

### 2.2 Recepción en el Sistema Operativo

**Archivo**: `src/main/lifecycle/events.ts`

**macOS** — evento `open-url`:
```typescript
app.on("open-url", (event, url) => {
  event.preventDefault();
  deepLinkService.handleDeepLink(url);
});
```

**Windows / Linux** — argumentos de línea de comandos:
```typescript
export function setupDeepLinkHandling(): void {
  const deepLinkUrl = process.argv.find(arg => arg.startsWith("levante://"));
  if (deepLinkUrl) {
    setTimeout(() => deepLinkService.handleDeepLink(deepLinkUrl), 1000);
  }
}
```

### 2.3 URLs Soportadas

**Archivo**: `src/main/services/deepLinkService.ts`

#### MCP Add Link
```
levante://mcp/add?name=SERVER_NAME&transport=TRANSPORT&command=CMD&args=ARG&env=JSON&inputs=JSON
```

Parámetros:

| Parámetro | Requerido | Descripción |
|-----------|-----------|-------------|
| `name` | Sí | Nombre del servidor |
| `transport` | Sí | `stdio` \| `http` \| `sse` \| `streamable-http` |
| `command` | Para STDIO | Comando a ejecutar |
| `args` | No | Argumentos separados por coma o JSON array |
| `env` | No | JSON con variables de entorno |
| `url` | Para HTTP | URL del servidor |
| `headers` | No | JSON con headers HTTP |
| `inputs` | No | JSON con definiciones de campos de entrada del usuario |

Ejemplo completo:
```
levante://mcp/add?name=GitHub%20Tools&transport=stdio&command=npx&args=%40github%2Ftools&env=%7B%22API_KEY%22%3A%22%24%7BGITHUB_TOKEN%7D%22%7D&inputs=%7B%22github_token%22%3A%7B%22label%22%3A%22GitHub%20Token%22%2C%22required%22%3Atrue%2C%22type%22%3A%22password%22%7D%7D
```

#### MCP Configure Link
```
levante://mcp/configure/SERVER_ID
```
Abre el modal de configuración para un servidor ya instalado, cargando su template desde el registry.

#### Chat New Link
```
levante://chat/new?prompt=MESSAGE&autoSend=true
```

### 2.4 Parsing y Validación de Seguridad

**Método**: `deepLinkService.parseDeepLink(url: string)`

```typescript
parseDeepLink(url: string): DeepLinkAction | null {
  const parsedUrl = new URL(url);

  if (parsedUrl.protocol !== 'levante:') return null;

  const hostname = parsedUrl.hostname || '';
  const pathname = parsedUrl.pathname.replace(/^\/+/, '');
  const fullPath = hostname ? `${hostname}/${pathname}` : pathname;

  const [category, action] = fullPath.split('/');
  const params = Object.fromEntries(parsedUrl.searchParams.entries());

  if (category === 'mcp' && action === 'add') {
    return this.parseMCPAddLink(params);
  } else if (category === 'mcp' && action === 'configure') {
    return this.parseMCPConfigureLink(serverId, params);
  } else if (category === 'chat' && action === 'new') {
    return this.parseChatNewLink(params);
  }
}
```

**Validaciones de seguridad aplicadas:**

1. **Sanitización anti-prototype-pollution**:
```typescript
private sanitizeObject(obj: any): any {
  const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
  const sanitized = Object.create(null);
  for (const key in obj) {
    if (dangerousKeys.includes(key)) continue; // Bloquea
    sanitized[key] = typeof obj[key] === 'object'
      ? this.sanitizeObject(obj[key])
      : obj[key];
  }
  return sanitized;
}
```

2. **Validación de comandos STDIO**:
```typescript
try {
  validateMCPCommand(command, serverConfig.args);
} catch (error) {
  logger.core.error('Security validation failed for MCP deep link');
  return null; // Rechaza el deep link completo
}
```

3. **Validación de transport types**:
```typescript
const validTransports = ['stdio', 'http', 'sse', 'streamable-http'];
if (!validTransports.includes(serverType)) {
  logger.core.warn('Invalid MCP server transport type');
  return null;
}
```

La acción retornada tiene esta estructura:
```typescript
{
  type: 'mcp-add',
  data: {
    name: 'Server Name',
    config: MCPServerConfig,
    inputs?: Record<string, InputDefinition>
  }
}
```

### 2.5 Envío al Renderer

```typescript
handleDeepLink(url: string): void {
  const action = this.parseDeepLink(url);
  if (!action || !this.mainWindow) return;

  // Trae la ventana al frente
  if (this.mainWindow.isMinimized()) this.mainWindow.restore();
  this.mainWindow.show();
  this.mainWindow.focus();

  // Envía la acción al renderer via IPC
  this.mainWindow.webContents.send('levante/deep-link/action', action);
}
```

### 2.6 Recepción en el Preload

**Archivo**: `src/preload/api/app.ts`

```typescript
onDeepLink: (callback: (action: DeepLinkAction) => void) => {
  const listener = (_event: any, action: DeepLinkAction) => callback(action);
  ipcRenderer.on('levante/deep-link/action', listener);

  return () => ipcRenderer.removeListener('levante/deep-link/action', listener);
};
```

### 2.7 Manejo en App.tsx

**Archivo**: `src/renderer/App.tsx`

```typescript
useEffect(() => {
  const cleanup = window.levante.onDeepLink(async (action: DeepLinkAction) => {
    if (action.type === 'mcp-add') {
      setCurrentPage('store');
      setMcpModalConfig({ config, name, inputs });
      setMcpModalOpen(true);

    } else if (action.type === 'mcp-configure') {
      // Carga template desde registry
      const result = await window.levante.mcp.providers.getEntry(serverId);
      if (result.success) {
        // Convierte fields del registry a formato inputs
        setMcpModalConfig({ config, name, inputs });
        setMcpModalOpen(true);
      }

    } else if (action.type === 'chat-new') {
      setCurrentPage('chat');
      startNewChat();
      setPendingPrompt(prompt);
    }
  });

  return cleanup;
}, [startNewChat, setPendingPrompt]);
```

### 2.8 Modal de Confirmación — MCPDeepLinkModal

**Archivo**: `src/renderer/components/mcp/deep-link/MCPDeepLinkModal.tsx`

Este modal es la pieza central del flujo de deep link. Muestra la información del servidor antes de añadirlo y gestiona el flujo de credenciales.

**Componentes internos**:
- `ServerInfoPanel`: Información y metadatos del servidor
- `JSONPreview`: Vista previa JSON de la configuración final
- `ApiKeysModal`: Modal secundario para ingresar credenciales/variables de entorno
- `RuntimeChoiceDialog`: Selector de runtime (Python, Node, etc.) cuando es necesario

**Flujo del modal `handleAddServer()`**:

```typescript
const handleAddServer = async (apiKeyValues?: Record<string, string>) => {
  // 1. Validar que config sea válida
  if (!config?.id) {
    toast.error('Invalid MCP server configuration');
    return;
  }

  // 2. Verificar duplicados
  const serverExists = activeServers.some(s => s.id === config.id);
  if (serverExists) {
    toast.error(`Server '${serverName}' already exists`);
    return;
  }

  // 3. Detectar campos que necesitan entrada del usuario
  const fieldsNeedingInput = inputs
    ? convertInputsToFields(inputs)
    : detectRequiredFields(config);

  // 4. Si hay campos sin valores, abrir ApiKeysModal
  if (fieldsNeedingInput.length > 0 && !apiKeyValues) {
    setApiKeysModalState({ isOpen: true, fields: fieldsNeedingInput });
    return;
  }

  setIsAdding(true);

  try {
    // 5. Reemplazar placeholders con valores del usuario
    const finalConfig = apiKeyValues
      ? replacePlaceholders(config, apiKeyValues)
      : config as MCPServerConfig;

    // 6. Guardar en disco
    const addResult = await window.levante.mcp.addServer(finalConfig);
    if (!addResult.success) {
      toast.error(`Failed to add server: ${addResult.error}`);
      return;
    }

    // 7. Sincronizar estado
    await loadActiveServers();

    // 8. Conectar
    await connectServer(finalConfig);

    toast.success(`Server '${serverName}' added and connected`);
    onOpenChange(false);

  } catch (connectError: any) {
    // 9. Manejo especial de errores de runtime
    if (['RUNTIME_CHOICE_REQUIRED', 'RUNTIME_NOT_FOUND'].includes(connectError.errorCode)) {
      setRuntimeDialogState({ isOpen: true, ... });
      toast.info('Runtime configuration needed');
    } else {
      toast.error(`Failed to connect: ${connectError.message}`);
    }
  } finally {
    setIsAdding(false);
  }
};
```

**Sistema de reemplazo de placeholders**:

Los inputs definidos en el deep link pueden referenciar variables de entorno con `${VARIABLE_NAME}`:

```typescript
function replacePlaceholders(
  config: Partial<MCPServerConfig>,
  values: Record<string, string>
): MCPServerConfig {
  const result = { ...config } as MCPServerConfig;
  const usedKeys = new Set<string>();

  // Reemplaza en env
  if (result.env) {
    Object.entries(result.env).forEach(([key, value]) => {
      let replaced = value;
      Object.entries(values).forEach(([placeholder, actualValue]) => {
        if (replaced.includes(`\${${placeholder}}`)) {
          replaced = replaced.replace(`\${${placeholder}}`, actualValue);
          usedKeys.add(placeholder);
        }
      });
      result.env![key] = replaced;
    });
  }

  // Reemplaza también en headers, URL y args...

  // Añade valores sin placeholder directamente a env
  Object.entries(values).forEach(([key, value]) => {
    if (!usedKeys.has(key)) {
      result.env![key] = value;
    }
  });

  return result;
}
```

---

## 3. Arquitectura de Servicios e IPC

### 3.1 Inicialización del sistema MCP

**Archivo**: `src/main/ipc/mcpHandlers/index.ts`

```typescript
export async function registerMCPHandlers() {
  const uiPreferences = preferencesService.getAll();
  mcpService = await MCPServiceFactory.createFromUIPreferences(uiPreferences);

  registerConnectionHandlers(mcpService, configManager);
  registerConfigurationHandlers(mcpService, configManager, oauthService);
  registerToolHandlers(mcpService);
  registerResourceHandlers(mcpService);
  registerPromptHandlers(mcpService);
  registerHealthHandlers();
  registerExtractionHandlers(mcpService);
  registerRegistryHandlers(mcpService, configManager, oauthService);
  registerProviderHandlers();
  registerRuntimeHandlers();
}
```

### 3.2 Handlers IPC principales

#### Configuración (`configuration.ts`)

| Canal IPC | Acción |
|-----------|--------|
| `levante/mcp/add-server` | `configManager.addServer()` |
| `levante/mcp/remove-server` | `configManager.removeServer()` |
| `levante/mcp/update-server` | `configManager.updateServer()` |
| `levante/mcp/list-servers` | `configManager.listServers()` |
| `levante/mcp/load-configuration` | `configManager.loadConfiguration()` |
| `levante/mcp/save-configuration` | `configManager.saveConfiguration()` |

#### Conexión (`connection.ts`)

| Canal IPC | Acción |
|-----------|--------|
| `levante/mcp/connect-server` | Conecta e intenta registrar |
| `levante/mcp/disconnect-server` | Desconecta y deshabilita |
| `levante/mcp/enable-server` | Mueve de `disabled` a `mcpServers` |
| `levante/mcp/disable-server` | Mueve de `mcpServers` a `disabled` |
| `levante/mcp/connection-status` | Obtiene estado de conexión |
| `levante/mcp/test-connection` | Prueba sin guardar |

#### Herramientas (`tools.ts`)

| Canal IPC | Acción |
|-----------|--------|
| `levante/mcp/list-tools` | Lista todas las herramientas disponibles |
| `levante/mcp/toggle-tool` | Habilita/deshabilita una herramienta |
| `levante/mcp/toggle-all-tools` | Habilita/deshabilita todas las herramientas |

---

## 4. Persistencia y Estado

### 4.1 Almacenamiento en disco

El archivo `.mcp.json` tiene esta estructura:

```json
{
  "mcpServers": {
    "server-id": {
      "name": "Display Name",
      "transport": "stdio",
      "command": "npx",
      "args": ["package-name"],
      "env": { "KEY": "VALUE" }
    },
    "http-server-id": {
      "name": "HTTP Server",
      "transport": "http",
      "url": "https://api.example.com",
      "headers": { "Authorization": "Bearer token" }
    }
  },
  "disabled": {
    "disabled-server-id": {
      "name": "Disabled Server",
      "transport": "stdio"
    }
  }
}
```

Los servidores en `mcpServers` están activos. Los de `disabled` están registrados pero no se conectan al arrancar.

### 4.2 Estado en renderer (Zustand — `mcpStore`)

```typescript
interface MCPStore {
  activeServers: MCPServerConfig[];
  connectionStatus: Record<string, MCPConnectionStatus>;

  // Actions
  loadActiveServers: () => Promise<void>;
  connectServer: (config: MCPServerConfig) => Promise<void>;
  disconnectServer: (serverId: string) => Promise<void>;
  enableServer: (serverId: string) => Promise<void>;
  disableServer: (serverId: string) => Promise<void>;
}
```

### 4.3 Ciclo de vida de estados de un servidor

```
Nuevo servidor
  └─ Validación → Guardado en mcpServers → Conexión → Estado: connected

Servidor deshabilitado
  └─ Desconexión → Movido a disabled → Estado: disconnected

Re-habilitar
  └─ Movido de disabled a mcpServers → Reconexión → Estado: connected o error
```

---

## 5. Manejo de Errores

### 5.1 Errores de validación (renderer y deep link service)

| Error | Dónde | Acción |
|-------|-------|--------|
| Nombre vacío | FormMCPConfig | Muestra error en campo |
| Transporte inválido | deepLinkService | Retorna `null`, rechaza el link |
| Comando vacío (STDIO) | FormMCPConfig | Muestra error en campo |
| URL inválida (HTTP) | FormMCPConfig | Muestra error en campo |
| Clave peligrosa (`__proto__`) | deepLinkService | Bloquea y loguea warning |

### 5.2 Errores OAuth

```typescript
// Respuesta del IPC cuando se requiere autenticación OAuth
{
  success: false,
  errorCode: 'OAUTH_REQUIRED',
  metadata: {
    serverId: string,
    mcpServerUrl: string,
    wwwAuth: string
  }
}
```

El renderer detecta este error y abre el flujo de OAuth correspondiente.

### 5.3 Errores de Runtime

```typescript
// Cuando el runtime (Python, Node, etc.) no está instalado o hay ambigüedad
{
  success: false,
  errorCode: 'RUNTIME_CHOICE_REQUIRED' | 'RUNTIME_NOT_FOUND',
  metadata: {
    systemPath: string,
    runtimeType: string,
    runtimeVersion: string
  }
}
```

El modal `RuntimeChoiceDialog` permite al usuario seleccionar o configurar el runtime correcto.

---

## 6. Diagrama Visual Completo

### Flujo de Instalación Directa desde UI

```
┌─────────────────────────────────────────────────────────────┐
│ RENDERER (React)                                            │
│                                                             │
│  AddMCPTabs.tsx                                            │
│    ├─ FormMCPConfig.tsx  ──→  Validación (useMCPConfig)   │
│    └─ CustomMCPConfig.tsx                                  │
│                                                             │
│                    ↓ MCPServerConfig                        │
│                                                             │
│  mcpStore.ts                                               │
│    ├─ addServer(config)    ────→ IPC: levante/mcp/add-server │
│    └─ connectServer(config) ──→ IPC: levante/mcp/connect-server │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                         ↓ IPC
┌─────────────────────────────────────────────────────────────┐
│ MAIN PROCESS (Node.js)                                      │
│                                                             │
│  mcpHandlers/configuration.ts                               │
│    └─ mcpConfigManager.ts                                  │
│         ├─ sanitizeServerConfig()                          │
│         ├─ normalizeServerConfig()                         │
│         └─ saveConfiguration() → .mcp.json                │
│                                                             │
│  mcpHandlers/connection.ts                                  │
│    └─ mcpService.connectServer() → Runtime en memoria      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                         ↓ IPC Response
┌─────────────────────────────────────────────────────────────┐
│ RENDERER — Estado actualizado                               │
│                                                             │
│  mcpStore.ts (Zustand)                                     │
│    ├─ activeServers: [..., nuevoServidor]                  │
│    └─ connectionStatus[id]: 'connected'                    │
│                                                             │
│  UI: Toast "Server added and connected" + lista actualizada │
└─────────────────────────────────────────────────────────────┘
```

### Flujo de Deep Link

```
┌─────────────────────────────────────────────────────────────┐
│ ORIGEN EXTERNO                                              │
│                                                             │
│  levante://mcp/add?name=Server&transport=stdio&command=npx  │
│                                                             │
└──────────────────────────┬──────────────────────────────────┘
                           ↓ OS Protocol Handler
┌─────────────────────────────────────────────────────────────┐
│ MAIN PROCESS — Electron Events                              │
│                                                             │
│  macOS: app.on('open-url', ...)                            │
│  Windows/Linux: process.argv parsing                        │
│                                                             │
│           ↓ deepLinkService.handleDeepLink(url)            │
│                                                             │
│  deepLinkService.ts                                         │
│    ├─ parseDeepLink()                                      │
│    │    ├─ Parsear URL y parámetros                        │
│    │    ├─ Sanitizar objetos (anti prototype pollution)    │
│    │    ├─ Validar transport type                          │
│    │    ├─ Validar comando STDIO (security)               │
│    │    └─ Retornar DeepLinkAction                        │
│    │                                                        │
│    └─ mainWindow.webContents.send('levante/deep-link/action') │
│                                                             │
└──────────────────────────┬──────────────────────────────────┘
                           ↓ IPC Event
┌─────────────────────────────────────────────────────────────┐
│ RENDERER — App.tsx                                          │
│                                                             │
│  window.levante.onDeepLink(callback)                       │
│    ├─ action.type === 'mcp-add'                            │
│    │    ├─ setCurrentPage('store')                         │
│    │    └─ setMcpModalOpen(true)                           │
│    │                                                        │
│    └─ action.type === 'mcp-configure'                      │
│         ├─ Carga template desde registry                   │
│         └─ setMcpModalOpen(true)                           │
│                                                             │
│  MCPDeepLinkModal.tsx                                       │
│    ├─ Muestra info del servidor + JSON preview             │
│    ├─ Si inputs → ApiKeysModal (credenciales)              │
│    └─ handleAddServer()                                    │
│         ├─ replacePlaceholders(config, values)             │
│         ├─ IPC: levante/mcp/add-server                    │
│         └─ IPC: levante/mcp/connect-server                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
              ↓ Mismo flujo que instalación directa
           (Pasos 6-9 del flujo de instalación directa)
```

### Datos que fluyen en cada paso (Deep Link)

```
Paso 1 — URL recibida por el OS
  levante://mcp/add?name=Server&transport=stdio&command=npx&...

Paso 2 — Parsing en deepLinkService
  DeepLinkAction {
    type: 'mcp-add',
    data: {
      name: 'Server',
      config: { id, transport, command, args, env },
      inputs: { api_key: { label, required, type } }
    }
  }

Paso 3 — IPC Main → Renderer
  mainWindow.webContents.send('levante/deep-link/action', action)

Paso 4 — Estado en App.tsx
  mcpModalConfig = { config, name, inputs }
  mcpModalOpen = true

Paso 5 — Usuario confirma + rellena credenciales
  apiKeyValues = { api_key: 'user-value' }
  finalConfig = replacePlaceholders(config, apiKeyValues)

Paso 6 — IPC Renderer → Main
  window.levante.mcp.addServer(finalConfig)
  window.levante.mcp.connectServer(finalConfig)

Paso 7 — Disco + runtime
  .mcp.json actualizado + servidor conectado en memoria

Paso 8 — Renderer actualizado
  activeServers: [..., finalConfig]
  connectionStatus[id]: 'connected'
```
