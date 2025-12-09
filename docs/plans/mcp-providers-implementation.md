# Plan de Implementación: MCP Providers

## Resumen

Añadir un sistema de filtrado por proveedores en la Store de MCP que permita importar y visualizar servidores desde múltiples fuentes (Levante, Smithery, GitHub, etc.) en una única vista unificada.

---

## Análisis del Sistema Actual

### Arquitectura Existente

**`store-layout.tsx`**:
- Dos modos: `active` (servidores instalados) y `store` (disponibles en registro)
- Carga datos desde `mcpRegistry.json` local via `useMCPStore`
- Funciones: `handleAddToActive`, `handleDeleteServer`, `handleToggleServer`
- Soporta campos dinámicos con modal `ApiKeysModal`

**`mcpRegistry.json`**:
- Estructura: `version`, `lastUpdated`, `entries[]`, `deprecated[]`
- Cada entry tiene: `id`, `name`, `description`, `category`, `icon`, `status`, `transport`, `configuration`
- Soporta transportes: `stdio`, `http`, `sse`

---

## Diseño Propuesto

### 1. Filtro por Proveedor en la Store

Mantener la estructura actual de dos modos (`active`/`store`) pero añadir un sistema de filtrado por proveedor en el modo `store`.

### 2. Estructura de Datos

#### Extender `MCPRegistryEntry`

Añadir campo `source` para identificar el proveedor:

```typescript
// src/types/mcp.ts

interface MCPRegistryEntry {
  // Campos existentes...
  id: string;
  name: string;
  description: string;
  // ...

  // Nuevo campo
  source: string; // 'levante' | 'smithery' | 'awesome-mcp' | etc.
}
```

#### Nuevo tipo: `MCPProvider`

```typescript
// src/types/mcp.ts

interface MCPProvider {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: 'local' | 'github' | 'api';
  endpoint: string;
  enabled: boolean;
  lastSynced?: string;
  serverCount?: number;
  // Configuración específica por tipo
  config?: {
    branch?: string;        // Para GitHub
    path?: string;          // Path al archivo de registro
    authRequired?: boolean;
    authToken?: string;
  };
}
```

#### Proveedores predefinidos

```json
// src/renderer/data/mcpProviders.json
{
  "version": "1.0.0",
  "lastUpdated": "2025-01-14",
  "providers": [
    {
      "id": "levante",
      "name": "Levante",
      "description": "Built-in curated MCP servers",
      "icon": "home",
      "type": "local",
      "endpoint": "mcpRegistry.json",
      "enabled": true
    },
    {
      "id": "smithery",
      "name": "Smithery",
      "description": "MCP server marketplace",
      "icon": "store",
      "type": "api",
      "endpoint": "https://registry.smithery.ai/servers",
      "enabled": false
    },
    {
      "id": "mcp-so",
      "name": "MCP.so",
      "description": "MCP server directory",
      "icon": "globe",
      "type": "api",
      "endpoint": "https://mcp.so/api/servers",
      "enabled": false
    },
    {
      "id": "awesome-mcp",
      "name": "Awesome MCP",
      "description": "Community-curated MCP servers",
      "icon": "star",
      "type": "github",
      "endpoint": "punkpeye/awesome-mcp-servers",
      "enabled": false,
      "config": {
        "branch": "main",
        "path": "servers.json"
      }
    }
  ]
}
```

---

## Plan de Implementación

### Fase 1: Tipos y Store

**Archivos a modificar/crear:**

1. **`src/types/mcp.ts`** - Añadir tipos
   - `MCPProvider`
   - Extender `MCPRegistryEntry` con campo `source`

2. **`src/renderer/stores/mcpStore.ts`** - Extender store
   ```typescript
   interface MCPState {
     // Existente...
     registry: MCPRegistry;
     activeServers: MCPServerConfig[];

     // Nuevo
     providers: MCPProvider[];
     selectedProvider: string | 'all'; // Filtro activo
     loadingProviders: Record<string, boolean>;

     // Acciones nuevas
     loadProviders: () => Promise<void>;
     syncProvider: (providerId: string) => Promise<void>;
     setSelectedProvider: (providerId: string | 'all') => void;
     toggleProviderEnabled: (providerId: string) => Promise<void>;
   }
   ```

3. **`src/renderer/data/mcpProviders.json`** - Crear archivo de proveedores

4. **Computed en store** - Filtrar entries por proveedor
   ```typescript
   // Getter para entries filtradas
   const filteredEntries = useMemo(() => {
     if (selectedProvider === 'all') {
       return registry.entries;
     }
     return registry.entries.filter(e => e.source === selectedProvider);
   }, [registry.entries, selectedProvider]);
   ```

### Fase 2: Servicios de Fetching

**Archivos a crear:**

1. **`src/main/services/mcp/MCPProviderService.ts`**
   ```typescript
   class MCPProviderService {
     // Fetchers por tipo de proveedor
     private async fetchFromLocal(path: string): Promise<unknown>
     private async fetchFromGitHub(repo: string, branch: string, path: string): Promise<unknown>
     private async fetchFromAPI(url: string): Promise<unknown>

     // Normalizadores específicos por proveedor
     private normalizeSmithery(data: SmitheryResponse, source: string): MCPRegistryEntry[]
     private normalizeMcpSo(data: McpSoResponse, source: string): MCPRegistryEntry[]
     private normalizeAwesomeMcp(data: AwesomeMcpResponse, source: string): MCPRegistryEntry[]
     private normalizeLevante(data: MCPRegistry, source: string): MCPRegistryEntry[]

     // Método principal que orquesta fetch + normalización
     async syncProvider(provider: MCPProvider): Promise<MCPRegistryEntry[]> {
       const rawData = await this.fetchData(provider);

       switch (provider.id) {
         case 'levante':
           return this.normalizeLevante(rawData, provider.id);
         case 'smithery':
           return this.normalizeSmithery(rawData, provider.id);
         case 'mcp-so':
           return this.normalizeMcpSo(rawData, provider.id);
         case 'awesome-mcp':
           return this.normalizeAwesomeMcp(rawData, provider.id);
         default:
           throw new Error(`Unknown provider: ${provider.id}`);
       }
     }
   }
   ```

2. **`src/main/ipc/handlers/mcp-providers.ts`** - IPC handlers
   ```typescript
   // levante/mcp/providers/list - Listar proveedores disponibles
   // levante/mcp/providers/sync - Sincronizar un proveedor específico
   // levante/mcp/providers/sync-all - Sincronizar todos los habilitados
   // levante/mcp/providers/toggle - Habilitar/deshabilitar proveedor
   ```

3. **`src/preload/modules/mcp.ts`** - Exponer en preload
   ```typescript
   providers: {
     list: () => ipcRenderer.invoke('levante/mcp/providers/list'),
     sync: (id: string) => ipcRenderer.invoke('levante/mcp/providers/sync', id),
     syncAll: () => ipcRenderer.invoke('levante/mcp/providers/sync-all'),
     toggle: (id: string) => ipcRenderer.invoke('levante/mcp/providers/toggle', id),
   }
   ```

### Fase 3: Componentes UI

**Archivos a crear/modificar:**

1. **`src/renderer/components/mcp/store-page/provider-filter.tsx`** (crear)
   ```typescript
   interface ProviderFilterProps {
     providers: MCPProvider[];
     selectedProvider: string | 'all';
     onSelectProvider: (id: string | 'all') => void;
     onSyncProvider: (id: string) => void;
     loadingProviders: Record<string, boolean>;
   }
   ```
   - Dropdown o SegmentedControl con proveedores
   - Opción "All" para ver todos
   - Indicador de carga por proveedor
   - Botón de sync por proveedor

2. **`src/renderer/components/mcp/store-page/provider-settings-modal.tsx`** (crear)
   - Modal para gestionar proveedores (habilitar/deshabilitar)
   - Lista de proveedores con toggles
   - Botón de sincronizar todos

3. **Modificar `src/renderer/components/mcp/store-page/store-layout.tsx`**
   - Añadir `ProviderFilter` en la cabecera del modo `store`
   - Usar `filteredEntries` en lugar de `registry.entries`
   - Añadir botón de settings de proveedores

   ```tsx
   {mode === 'store' && (
     <section>
       <div className="flex items-center justify-between mb-4">
         <h2 className="text-2xl font-bold">{t('store.available_integrations')}</h2>
         <div className="flex items-center gap-2">
           <ProviderFilter
             providers={providers}
             selectedProvider={selectedProvider}
             onSelectProvider={setSelectedProvider}
             onSyncProvider={syncProvider}
             loadingProviders={loadingProviders}
           />
           <Badge variant="outline">
             {t('store.available', { count: filteredEntries.length })}
           </Badge>
         </div>
       </div>
       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
         {filteredEntries.map(entry => (
           // ... IntegrationCard existente
         ))}
       </div>
     </section>
   )}
   ```

### Fase 4: Integración con IntegrationCard

**Archivos a modificar:**

1. **`src/renderer/components/mcp/store-page/integration-card.tsx`**
   - Mostrar badge con el nombre del proveedor (source)
   - Diferenciar visualmente servers de distintos proveedores

   ```tsx
   // Añadir en la card
   {entry?.source && entry.source !== 'levante' && (
     <Badge variant="outline" className="text-xs">
       {entry.source}
     </Badge>
   )}
   ```

### Fase 5: Persistencia y Cache

**Archivos a modificar:**

1. **`src/main/services/preferences/PreferencesService.ts`**
   - Guardar providers habilitados
   - Cache de servers sincronizados por provider

2. **Esquema de preferencias en `ui-preferences.json`:**
   ```typescript
   mcpProviders: {
     enabled: string[];           // IDs de providers habilitados ['levante', 'smithery']
     lastSyncedAt: Record<string, string>; // { 'smithery': '2025-01-14T10:00:00Z' }
   }
   ```

3. **Cache de servers en `~/levante/mcp-cache/`:**
   ```
   ~/levante/mcp-cache/
   ├── smithery.json      // Servers cacheados de Smithery
   ├── mcp-so.json        // Servers cacheados de MCP.so
   └── awesome-mcp.json   // Servers cacheados de Awesome MCP
   ```

4. **`src/main/services/mcp/MCPCacheService.ts`** (crear)
   ```typescript
   class MCPCacheService {
     async getCache(providerId: string): Promise<MCPRegistryEntry[] | null>
     async setCache(providerId: string, entries: MCPRegistryEntry[]): Promise<void>
     async clearCache(providerId: string): Promise<void>
     async isCacheValid(providerId: string, maxAge: number): boolean
   }
   ```

---

## Flujo de Usuario

### Filtrar por Proveedor
1. Usuario está en la Store (modo `store`)
2. Ve dropdown/selector de proveedores en la cabecera
3. Selecciona un proveedor específico o "All"
4. La lista de MCPs se filtra mostrando solo los del proveedor seleccionado

### Sincronizar Proveedor
1. Usuario selecciona un proveedor en el filtro
2. Click en botón "Sync" (icono de refresh)
3. Sistema hace fetch al endpoint del proveedor
4. Normaliza datos al formato `MCPRegistryEntry` con `source` del proveedor
5. Guarda en cache local
6. Actualiza la lista en la Store

### Gestionar Proveedores
1. Usuario abre modal de settings de proveedores
2. Ve lista de proveedores disponibles con toggles
3. Habilita/deshabilita proveedores
4. Puede sincronizar todos los habilitados a la vez

### Instalar MCP de cualquier Proveedor
1. Usuario ve MCPs de uno o varios proveedores
2. Click en "Add" en un MCP (igual que ahora)
3. Se abre modal de configuración si necesita API keys
4. MCP se añade a `activeServers`
5. El MCP mantiene referencia a su `source` original

---

## Normalización de Formatos

Diferentes fuentes usan diferentes formatos. El servicio debe normalizar a `MCPRegistryEntry`:

### Smithery API Response
```json
{
  "servers": [
    {
      "qualifiedName": "@smithery/filesystem",
      "displayName": "Filesystem Server",
      "description": "Access local filesystem",
      "homepage": "https://smithery.ai/server/@smithery/filesystem",
      "useCount": 1500,
      "isDeployed": true,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### MCP.so API Response
```json
{
  "tools": [
    {
      "name": "filesystem",
      "title": "Filesystem MCP",
      "description": "Read and write files",
      "author": "anthropic",
      "install": "npx @modelcontextprotocol/server-filesystem"
    }
  ]
}
```

### GitHub (awesome-mcp-servers)
```json
{
  "servers": [
    {
      "name": "filesystem",
      "repository": "modelcontextprotocol/servers",
      "path": "src/filesystem",
      "description": "File system access"
    }
  ]
}
```

### Normalizadores por Proveedor

Cada proveedor tiene su propio normalizador para manejar sus campos específicos:

```typescript
// Normalizador para Smithery
private normalizeSmithery(data: SmitheryResponse, source: string): MCPRegistryEntry[] {
  return data.servers.map(server => ({
    id: `${source}-${server.qualifiedName}`,
    name: server.displayName,
    description: server.description,
    category: 'general',
    icon: 'server',
    status: 'active',
    source,
    transport: { type: 'stdio', autoDetect: true },
    configuration: {
      fields: [],
      defaults: { command: 'npx', args: `-y ${server.qualifiedName}` },
      template: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', server.qualifiedName],
        env: {}
      }
    },
    // Metadata adicional de Smithery
    metadata: {
      useCount: server.useCount,
      homepage: server.homepage
    }
  }));
}

// Normalizador para MCP.so
private normalizeMcpSo(data: McpSoResponse, source: string): MCPRegistryEntry[] {
  return data.tools.map(tool => {
    const installParts = tool.install.split(' ');
    const command = installParts[0];
    const args = installParts.slice(1);

    return {
      id: `${source}-${tool.name}`,
      name: tool.title,
      description: tool.description,
      category: 'general',
      icon: 'server',
      status: 'active',
      source,
      transport: { type: 'stdio', autoDetect: true },
      configuration: {
        fields: [],
        defaults: { command, args: args.join(' ') },
        template: {
          type: 'stdio',
          command,
          args,
          env: {}
        }
      },
      metadata: {
        author: tool.author
      }
    };
  });
}

// Normalizador para Awesome MCP (GitHub)
private normalizeAwesomeMcp(data: AwesomeMcpResponse, source: string): MCPRegistryEntry[] {
  return data.servers.map(server => ({
    id: `${source}-${server.name}`,
    name: server.name,
    description: server.description || '',
    category: 'general',
    icon: 'server',
    status: 'active',
    source,
    transport: { type: 'stdio', autoDetect: true },
    configuration: {
      fields: [],
      defaults: { command: 'npx', args: '' },
      template: {
        type: 'stdio',
        command: 'npx',
        args: [],
        env: {}
      }
    },
    metadata: {
      repository: server.repository,
      path: server.path
    }
  }));
}

// Normalizador para Levante (local)
private normalizeLevante(data: MCPRegistry, source: string): MCPRegistryEntry[] {
  return data.entries.map(entry => ({
    ...entry,
    source
  }));
}
```

**Ventajas del enfoque por proveedor:**
- Cada normalizador maneja campos específicos de su API
- Fácil de mantener y debugear
- Si un proveedor cambia su API, solo afecta a su normalizador
- Permite extraer metadata adicional (useCount, author, etc.)

---

## Traducciones

**`src/renderer/locales/en/mcp.json`:**
```json
{
  "store": {
    "filter_provider": "Filter by provider",
    "all_providers": "All providers",
    "sync_provider": "Sync",
    "syncing": "Syncing...",
    "last_synced": "Last synced: {{date}}",
    "provider_settings": "Provider settings",
    "enable_provider": "Enable",
    "disable_provider": "Disable",
    "sync_all": "Sync all",
    "from_provider": "From {{provider}}"
  }
}
```

**`src/renderer/locales/es/mcp.json`:**
```json
{
  "store": {
    "filter_provider": "Filtrar por proveedor",
    "all_providers": "Todos los proveedores",
    "sync_provider": "Sincronizar",
    "syncing": "Sincronizando...",
    "last_synced": "Última sincronización: {{date}}",
    "provider_settings": "Configuración de proveedores",
    "enable_provider": "Habilitar",
    "disable_provider": "Deshabilitar",
    "sync_all": "Sincronizar todos",
    "from_provider": "De {{provider}}"
  }
}
```

---

## Consideraciones Técnicas

### Rate Limiting
- Implementar cache con TTL (ej: 1 hora)
- No sincronizar todos los providers automáticamente
- Usuario decide cuándo sincronizar

### Manejo de Errores
- Provider no disponible → mostrar error en card
- Formato inválido → log y skip
- Auth requerida → mostrar en configuración

### Seguridad
- Validar URLs antes de fetch
- No ejecutar código de providers externos
- Tokens de auth en storage seguro

### Performance
- Lazy loading de servers por provider
- Virtualización si hay muchos servers
- Cache en memoria + persistencia

---

## Orden de Implementación Sugerido

1. **Fase 1** (1-2 días): Tipos y estructura de datos
2. **Fase 2** (2-3 días): Servicios de fetching, IPC y cache
3. **Fase 3** (2-3 días): Componentes UI (filtro y modal de settings)
4. **Fase 4** (0.5 días): Integración con IntegrationCard
5. **Fase 5** (1 día): Persistencia en preferencias
6. **Testing** (1-2 días): Unit tests y pruebas manuales

**Total estimado: 7-11 días**

---

## Archivos a Crear/Modificar

```
src/
├── types/
│   └── mcp.ts (modificar - añadir MCPProvider, source en MCPRegistryEntry)
├── main/
│   ├── services/
│   │   └── mcp/
│   │       ├── MCPProviderService.ts (crear)
│   │       └── MCPCacheService.ts (crear)
│   └── ipc/
│       └── handlers/
│           └── mcp-providers.ts (crear)
├── preload/
│   └── modules/
│       └── mcp.ts (modificar - añadir providers)
└── renderer/
    ├── data/
    │   └── mcpProviders.json (crear)
    ├── stores/
    │   └── mcpStore.ts (modificar - añadir providers, filtro, acciones)
    ├── components/
    │   └── mcp/
    │       └── store-page/
    │           ├── store-layout.tsx (modificar - añadir filtro)
    │           ├── provider-filter.tsx (crear)
    │           ├── provider-settings-modal.tsx (crear)
    │           └── integration-card.tsx (modificar - mostrar source)
    └── locales/
        ├── en/
        │   └── mcp.json (modificar)
        └── es/
            └── mcp.json (modificar)
```

---

## Siguiente Paso

Comenzar con **Fase 1**:
1. Definir tipos `MCPProvider` en `src/types/mcp.ts`
2. Añadir campo `source` a `MCPRegistryEntry`
3. Crear `src/renderer/data/mcpProviders.json` con proveedores predefinidos
