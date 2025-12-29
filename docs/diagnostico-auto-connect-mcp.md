# Diagnóstico: Auto-Conexión de Servidores MCP al Instalarse

## Resumen Ejecutivo

**Problema identificado**: Cuando se instala un servidor MCP, se guarda en configuración con `enabled: true`, pero no siempre se intenta conectar. Esto provoca que:
1. No se detecten errores de conexión hasta que el usuario intente usarlo manualmente
2. No se inicie el flujo OAuth automáticamente para servidores que lo requieren
3. El usuario vea el servidor como "activo" pero realmente no esté conectado

**Dificultad de solución**: ⭐⭐ FÁCIL

---

## Análisis por Flujo de Instalación

### 1. Instalación desde Store ✅ FUNCIONA

**Ubicación**: `src/renderer/components/mcp/store-page/store-layout.tsx:219-395`

**Flujo actual**:
```typescript
// 1. Guardar en .mcp.json
await addServer(serverConfig);

// 2. Recargar lista
await loadActiveServers();

// 3. ✅ INTENTA CONECTAR
const toastId = toast.loading(t('messages.connecting', { name: registryEntry.name }));
try {
  await connectServer(serverConfig);
  toast.success(t('messages.added', { name: registryEntry.name }), { id: toastId });
} catch (connectError: any) {
  // Maneja OAuth required
  if (connectError.code === 'OAUTH_REQUIRED') {
    handleOAuthRequired({...});
  }
  // Maneja errores de runtime
  if (connectError.message === 'RUNTIME_NOT_FOUND') {
    toast.error(t('messages.runtime_not_available'), { id: toastId });
  }
}
```

**Conclusión**: El flujo del Store SÍ intenta conectar y maneja correctamente OAuth y errores de runtime.

---

### 2. Instalación Custom via Formulario ❌ NO FUNCIONA

**Ubicación**: `src/renderer/components/mcp/config/FormMCPConfig.tsx:188-242`

**Flujo actual**:
```typescript
const handleSave = async () => {
  // Validar
  if (!validate()) return;

  // Construir config
  const serverConfig: MCPServerConfig = { ... };

  // ❌ SOLO AGREGA, NO CONECTA
  await addServer(serverConfig);

  // Cierra el panel
  onClose();
};
```

**Problema**:
- El servidor se guarda en `mcpServers` (lo que lo marca como "enabled")
- Pero nunca se intenta `connectServer()`
- El servidor aparece como "activo" en la UI pero no está realmente conectado
- No se detectan errores ni se inicia OAuth

---

### 3. Instalación via Full JSON Editor ✅ FUNCIONA

**Ubicación**: `src/renderer/components/mcp/config/FullJSONEditor.tsx:157-192`

**Flujo actual**:
```typescript
const handleSave = async () => {
  // 1. Guardar configuración completa
  await window.levante.mcp.saveConfiguration(validation.data);

  // 2. ✅ REFRESH reconecta TODOS los servidores
  await window.levante.mcp.refreshConfiguration();

  // 3. Actualizar UI
  await loadActiveServers();
  await refreshConnectionStatus();
};
```

**Cómo funciona el refresh** (en `configuration.ts:23-78`):
```typescript
// Desconecta todos
await mcpService.disconnectAll();

// Reconecta solo los de mcpServers (NO disabled)
for (const [serverId, serverConfig] of Object.entries(config.mcpServers)) {
  await mcpService.connectServer({ id: serverId, ...serverConfig });
}
```

**Conclusión**: Funciona, pero con efectos secundarios (desconecta/reconecta todos).

---

### 4. Instalación via Deeplink 🔍 NO IMPLEMENTADO

No encontré implementación de deeplinks para instalación de MCP. Si existe, debería seguir el mismo patrón que el Store.

---

## Arquitectura Actual

### Capas involucradas:

```
┌──────────────────────────────────────────────────────────┐
│                     RENDERER                              │
│                                                           │
│  store-layout.tsx    FormMCPConfig.tsx   FullJSONEditor  │
│       │                    │                  │           │
│       ↓                    ↓                  ↓           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              mcpStore.ts (Zustand)                   │ │
│  │  - addServer()     → solo persiste                  │ │
│  │  - connectServer() → persiste + conecta             │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
                            │
                            ↓ IPC
┌──────────────────────────────────────────────────────────┐
│                      MAIN PROCESS                         │
│                                                           │
│  configuration.ts:                                        │
│    levante/mcp/add-server → configManager.addServer()    │
│    levante/mcp/refresh-configuration → disconnectAll +   │
│                                         reconnect all     │
│                                                           │
│  connection.ts:                                           │
│    levante/mcp/connect-server → mcpService.connectServer │
│                               → maneja OAuth/runtime      │
└──────────────────────────────────────────────────────────┘
```

### El problema raíz:

`addServer()` en mcpStore.ts (líneas 252-273):
```typescript
addServer: async (config: MCPServerConfig) => {
  const result = await window.levante.mcp.addServer(config);
  if (result.success) {
    await get().loadActiveServers();  // Solo recarga, NO conecta
  }
};
```

El IPC handler `levante/mcp/add-server` (configuration.ts:89-99):
```typescript
ipcMain.handle("levante/mcp/add-server", async (_, config) => {
  await configManager.addServer(config);  // Solo persiste
  return { success: true };
});
```

---

## Comportamiento de la UI

### IntegrationCard muestra estados incorrectos:

Cuando un servidor está en `mcpServers` pero no está conectado:
- `server.enabled` = `true` (porque está en mcpServers)
- `connectionStatus[id]` = `undefined` o `'disconnected'`
- La card muestra estado "disconnected" pero el toggle está "enabled"

El usuario ve:
- Toggle: ON (habilitado)
- Estado: "Disconnected"
- Confusión: "¿Por qué está habilitado pero desconectado?"

---

## Solución Propuesta

### Opción A: Modificar FormMCPConfig (RECOMENDADA)

Agregar la misma lógica de conexión que usa store-layout:

```typescript
// src/renderer/components/mcp/config/FormMCPConfig.tsx
const handleSave = async () => {
  if (!validate()) return;

  setIsSaving(true);
  setError(null);

  try {
    const serverConfig: MCPServerConfig = { ... };

    // 1. Guardar configuración
    await addServer(serverConfig);

    // 2. NUEVO: Intentar conectar
    try {
      await connectServer(serverConfig);
      toast.success(t('messages.connected', { name: serverConfig.name }));
    } catch (connectError: any) {
      // Manejar OAuth
      if (connectError.code === 'OAUTH_REQUIRED') {
        const { handleOAuthRequired } = useOAuthStore.getState();
        handleOAuthRequired({
          serverId: serverConfig.id,
          mcpServerUrl: connectError.metadata?.mcpServerUrl || '',
          wwwAuth: connectError.metadata?.wwwAuth || ''
        });
        toast.info(t('messages.oauth_required', { name: serverConfig.name }));
        onClose();
        return;
      }

      // Manejar runtime errors
      if (connectError.errorCode === 'RUNTIME_NOT_FOUND') {
        toast.warning(t('messages.added_runtime_needed', { name: serverConfig.name }));
        // Mostrar RuntimeChoiceDialog...
        onClose();
        return;
      }

      // Otros errores: servidor guardado pero no conectado
      toast.warning(t('messages.added_not_connected', { name: serverConfig.name }));
    }

    onClose();
  } catch (err) {
    setError(t('config.save_error'));
  } finally {
    setIsSaving(false);
  }
};
```

**Cambios necesarios**:
1. Importar `connectServer` del store
2. Importar `useOAuthStore`
3. Agregar estado para RuntimeChoiceDialog
4. Agregar traducciones nuevas

---

### Opción B: Modificar mcpStore.addServer

Hacer que `addServer` siempre intente conectar:

```typescript
// src/renderer/stores/mcpStore.ts
addServer: async (config: MCPServerConfig) => {
  set({ isLoading: true, error: null });

  try {
    // 1. Persistir
    const result = await window.levante.mcp.addServer(config);

    if (result.success) {
      // 2. Recargar lista
      await get().loadActiveServers();

      // 3. NUEVO: Intentar conectar
      try {
        await get().connectServer(config);
      } catch (connectError) {
        // Propagar para que el caller maneje OAuth/runtime
        throw connectError;
      }
    }
  } catch (error) {
    // ...
  }
};
```

**Pros**: Cambio centralizado
**Contras**: Cambia el comportamiento de todos los lugares que usen addServer

---

### Opción C: Nueva función addAndConnect

Crear una función específica para el caso de uso:

```typescript
// src/renderer/stores/mcpStore.ts
addAndConnect: async (config: MCPServerConfig) => {
  await get().addServer(config);
  return get().connectServer(config);
};
```

**Pros**: No rompe el comportamiento existente
**Contras**: Requiere actualizar callers

---

## Estimación de Esfuerzo

| Tarea | Complejidad | Archivos afectados |
|-------|-------------|-------------------|
| Opción A: Modificar FormMCPConfig | ⭐⭐ Fácil | 1 archivo |
| Opción B: Modificar mcpStore | ⭐⭐⭐ Media | 1 archivo, test regresión |
| Opción C: Nueva función | ⭐⭐ Fácil | 2 archivos |
| Agregar RuntimeChoiceDialog a Form | ⭐⭐ Fácil | 1 archivo |
| Traducciones nuevas | ⭐ Trivial | 2 archivos (en/es) |

---

## Archivos a Modificar

### Para Opción A (recomendada):

1. **`src/renderer/components/mcp/config/FormMCPConfig.tsx`**
   - Importar `connectServer` de mcpStore
   - Importar `useOAuthStore`
   - Agregar estado para RuntimeChoiceDialog
   - Modificar `handleSave` para conectar después de agregar

2. **`src/renderer/locales/en/mcp.json`** y **`es/mcp.json`**
   - Agregar traducciones para nuevos mensajes:
     - `messages.added_runtime_needed`
     - `messages.connecting` (si no existe)

3. **Opcional**: `src/renderer/components/mcp/config/full-json-editor-panel.tsx`
   - Verificar que el RuntimeChoiceDialog funcione correctamente

---

## Consideraciones de UX

### Comportamiento esperado después del fix:

1. **Usuario agrega servidor desde Store**:
   - Toast: "Conectando..."
   - Si éxito: Toast: "Servidor X conectado"
   - Si OAuth: Se abre navegador automáticamente
   - Si runtime: Dialog para elegir runtime

2. **Usuario agrega servidor Custom**:
   - Toast: "Conectando..."
   - Mismos flujos que Store

3. **Usuario agrega via JSON Editor**:
   - Ya funciona (refresh reconecta todos)

### Estados de la card después del fix:

| Escenario | Toggle | Estado | Icono |
|-----------|--------|--------|-------|
| Conectado exitosamente | ON | "Connected" | ✅ Verde |
| Pendiente OAuth | ON | "Pending OAuth" | 🔐 Amarillo |
| Error de conexión | ON | "Error" | ❌ Rojo |
| Deshabilitado por usuario | OFF | "Disconnected" | ⚪ Gris |

---

## Conclusión

**El problema es fácil de solucionar.** La causa raíz es que `FormMCPConfig.tsx` no llama a `connectServer()` después de `addServer()`, mientras que `store-layout.tsx` sí lo hace.

**Recomendación**: Implementar **Opción A** - es la más segura y aislada, con el menor riesgo de regresión.

**Tiempo estimado**: 1-2 horas de desarrollo + testing.
