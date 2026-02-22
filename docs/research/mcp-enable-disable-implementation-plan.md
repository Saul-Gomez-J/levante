# Plan de Implementación: Enable/Disable Server con Conexión Real

> **Fecha:** 2026-01-12
> **Basado en:** mcp-enable-disable-flow-diagnostic.md
> **Estado:** Pendiente de implementación

---

## Resumen del Problema

Los handlers IPC `enable-server` y `disable-server` actualmente **solo modifican la configuración** (mueven servidores entre `mcpServers` y `disabled`), pero **no conectan ni desconectan** los servidores realmente.

### Análisis del Flujo Actual

| Acción | Store | IPC Handler | Comportamiento Real |
|--------|-------|-------------|---------------------|
| `connectServer` | Llama IPC + actualiza estado | Conecta + mueve config | Correcto |
| `disconnectServer` | Llama IPC + actualiza estado | **Desconecta + mueve a disabled** | Correcto |
| `enableServer` | Llama IPC + pone `connecting` | Solo mueve config | **Incorrecto** - no conecta |
| `disableServer` | Llama IPC + pone `disconnected` | Solo mueve config | **Incorrecto** - no desconecta |

**Hallazgo importante:** El handler `disconnect-server` ya hace tanto la desconexión como el movimiento de config a `disabled`. Esto hace que `disable-server` sea parcialmente redundante.

---

## Solución Elegida: Modificar el Store (Opción B)

En lugar de duplicar lógica en los handlers IPC, modificamos el store para reutilizar las funciones existentes:

1. **`enableServer`**: Llama al IPC para mover config + llama a `connectServer` del store
2. **`disableServer`**: Simplemente llama a `disconnectServer` del store (que ya desconecta + mueve config)

### Ventajas de esta solución
- Reutiliza el código existente de `connectServer` (manejo de OAuth, runtime errors, analytics)
- No duplica lógica en los handlers IPC
- El store tiene acceso a la config completa en `activeServers`
- Menos código que mantener

---

## Archivo a Modificar

**`src/renderer/stores/mcpStore.ts`**

---

## Cambios Detallados

### 1. Función `enableServer` (líneas 263-289)

**Código actual:**
```typescript
// Enable a server (reconnect)
enableServer: async (serverId: string) => {
  try {
    const result = await window.levante.mcp.enableServer(serverId);

    if (result.success) {
      set(state => ({
        activeServers: state.activeServers.map(server =>
          server.id === serverId
            ? { ...server, enabled: true }
            : server
        ),
        connectionStatus: {
          ...state.connectionStatus,
          [serverId]: 'connecting'
        }
      }));

      // Refresh connection status after enabling
      await get().refreshConnectionStatus();
    } else {
      console.error('Failed to enable server:', result.error);
    }
  } catch (error) {
    console.error('Failed to enable server:', error);
  }
},
```

**Código nuevo:**
```typescript
// Enable a server (move config to active + connect)
enableServer: async (serverId: string) => {
  try {
    // 1. Get server config (already available in activeServers with enabled=false)
    const server = get().getServerById(serverId);
    if (!server) {
      console.error('Server not found:', serverId);
      return;
    }

    // 2. Move from disabled to mcpServers in config (persistence)
    const result = await window.levante.mcp.enableServer(serverId);
    if (!result.success) {
      console.error('Failed to enable server in config:', result.error);
      return;
    }

    // 3. Connect using existing connectServer logic (handles OAuth, runtime errors, etc.)
    // This will update activeServers and connectionStatus appropriately
    await get().connectServer({ ...server, enabled: true });
  } catch (error) {
    // connectServer may throw for OAuth/runtime errors - these are handled by the UI
    // Only log unexpected errors
    if (!(error as any).code && !(error as any).errorCode) {
      console.error('Failed to enable server:', error);
    }
    throw error; // Re-throw for UI handling
  }
},
```

---

### 2. Función `disableServer` (líneas 291-314)

**Código actual:**
```typescript
// Disable a server (disconnect without removing)
disableServer: async (serverId: string) => {
  try {
    const result = await window.levante.mcp.disableServer(serverId);

    if (result.success) {
      set(state => ({
        activeServers: state.activeServers.map(server =>
          server.id === serverId
            ? { ...server, enabled: false }
            : server
        ),
        connectionStatus: {
          ...state.connectionStatus,
          [serverId]: 'disconnected'
        }
      }));
    } else {
      console.error('Failed to disable server:', result.error);
    }
  } catch (error) {
    console.error('Failed to disable server:', error);
  }
},
```

**Código nuevo:**
```typescript
// Disable a server (disconnect + move config to disabled)
disableServer: async (serverId: string) => {
  try {
    // Use disconnectServer which already does:
    // 1. mcpService.disconnectServer() - runtime disconnection
    // 2. configManager.disableServer() - moves config to disabled section
    // 3. Updates store state (activeServers.enabled=false, connectionStatus='disconnected')
    await get().disconnectServer(serverId);
  } catch (error) {
    console.error('Failed to disable server:', error);
  }
},
```

---

## Flujo Completo Después de los Cambios

### Enable Server (Toggle ON)

```
1. UI (ToolsMenu) → mcpStore.enableServer(serverId)
2. Store:
   a. getServerById(serverId) → Obtiene config de activeServers
   b. window.levante.mcp.enableServer() → IPC mueve config de disabled → mcpServers
   c. connectServer(serverConfig) → Reutiliza lógica existente:
      - IPC connect-server → mcpService.connectServer()
      - Manejo de OAuth, runtime errors
      - Actualización de activeServers y connectionStatus
      - Analytics tracking
```

### Disable Server (Toggle OFF)

```
1. UI (ToolsMenu) → mcpStore.disableServer(serverId)
2. Store → disconnectServer(serverId):
   a. window.levante.mcp.disconnectServer() → IPC que hace:
      - mcpService.disconnectServer() → Desconecta runtime
      - configManager.disableServer() → Mueve config a disabled
   b. Actualiza activeServers.enabled=false
   c. Actualiza connectionStatus='disconnected'
```

---

## ¿Por qué NO modificar los IPC handlers?

La solución original (Opción A) proponía modificar los handlers IPC para conectar/desconectar. Esto tendría estos problemas:

1. **Duplicación de código:** El manejo de errores OAuth/runtime ya existe en el store `connectServer`
2. **Complejidad:** Los handlers tendrían que devolver errores especiales que el store debería manejar
3. **Inconsistencia:** El handler `disconnect-server` ya desconecta, haría que `disable-server` fuera redundante

---

## Archivos NO Modificados

| Archivo | Motivo |
|---------|--------|
| `src/main/ipc/mcpHandlers/connection.ts` | Los handlers IPC no necesitan cambios |
| `src/preload/api/mcp.ts` | Ya expone los métodos correctamente |
| `src/main/services/mcpConfigManager.ts` | Funciona correctamente |

---

## Consideraciones de Implementación

### 1. Manejo de Errores

`enableServer` ahora puede lanzar errores (OAuth, runtime) que la UI debe manejar. El código que llama a `enableServer` debe estar preparado para esto.

### 2. Diferencia Semántica

Técnicamente `disableServer` ahora hace lo mismo que `disconnectServer`. La diferencia es semántica:
- **`disconnect`**: Desconexión temporal (desde Settings)
- **`disable`**: Toggle off desde el chat (ToolsMenu)

Ambos dejan el servidor en estado disabled y desconectado.

### 3. Re-throw de Errores

`enableServer` ahora hace `throw error` para que la UI pueda mostrar diálogos de OAuth/runtime. Esto es consistente con `connectServer`.

---

## Plan de Testing

### Test Manual

1. **Test Enable con servidor normal:**
   - Deshabilitar un servidor desde ToolsMenu
   - Habilitarlo de nuevo
   - Verificar que se conecta y las tools están disponibles

2. **Test Disable:**
   - Tener un servidor conectado
   - Deshabilitarlo desde ToolsMenu
   - Verificar que se desconecta y las tools no están disponibles

3. **Test Enable con OAuth:**
   - Habilitar un servidor que requiere OAuth
   - Verificar que se muestra el diálogo de OAuth
   - Completar OAuth y verificar conexión

4. **Test Enable con error:**
   - Habilitar un servidor con config incorrecta
   - Verificar que muestra error apropiado

---

## Resumen de Cambios

| Archivo | Función | Cambio |
|---------|---------|--------|
| `src/renderer/stores/mcpStore.ts` | `enableServer` | Obtener config + IPC enable + llamar `connectServer` |
| `src/renderer/stores/mcpStore.ts` | `disableServer` | Simplificar a llamar `disconnectServer` |

**Total:** 1 archivo, ~30 líneas modificadas (reducción vs plan original)
