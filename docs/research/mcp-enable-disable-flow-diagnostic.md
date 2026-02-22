# Diagnóstico: Flujo de Enable/Disable Server MCP

> **Fecha:** 2026-01-12
> **Estado:** Funcional pero con inconsistencia arquitectónica
> **Prioridad:** Media

---

## Problema

La funcionalidad de **habilitar/deshabilitar servidores MCP desde el chat** funciona correctamente, pero **no sigue el mismo flujo arquitectónico** que las acciones de conectar/desconectar existentes en el store.

---

## Situación Actual

### Flujo de `connectServer` / `disconnectServer` (existente)

```
ToolsMenu → mcpStore.connectServer() → window.levante.mcp.connectServer() → IPC → main process
                    ↓
            Actualiza estado local:
            - connectionStatus
            - activeServers
```

El store maneja:
1. Llamada a la API del preload
2. Actualización del estado local (connectionStatus, activeServers)
3. Manejo de errores
4. Loading states

### Flujo de `enableServer` / `disableServer` (nuevo)

```
ToolsMenu → mcpStore.enableServer() → window.levante.mcp.enableServer() → IPC → main process
                    ↓
            Actualiza estado local:
            - activeServers.enabled
            - connectionStatus
```

---

## Inconsistencia Identificada

### ¿Qué hacen los IPC handlers `enable-server` y `disable-server`?

**Archivo:** `src/main/ipc/mcpHandlers/index.ts` (o similar)

Se necesita verificar si estos handlers:

1. **Solo cambian el flag `enabled` en la configuración** (persistencia)
2. **También conectan/desconectan el servidor** (comportamiento esperado)

### Comportamiento Esperado

| Acción | Debería hacer |
|--------|---------------|
| `enableServer(id)` | 1. Marcar `enabled: true` en config <br> 2. **Conectar** el servidor |
| `disableServer(id)` | 1. Marcar `enabled: false` en config <br> 2. **Desconectar** el servidor |

### Comportamiento Actual (a verificar)

Los handlers IPC pueden estar haciendo solo el paso 1, sin ejecutar la conexión/desconexión real.

---

## Archivos a Revisar

| Archivo | Qué buscar |
|---------|------------|
| `src/main/ipc/mcpHandlers/index.ts` | Handlers `levante/mcp/enable-server` y `levante/mcp/disable-server` |
| `src/main/services/mcp/mcpService.ts` | Métodos que manejan enable/disable |
| `src/renderer/stores/mcpStore.ts` | Funciones `enableServer` y `disableServer` (líneas 263-313) |

---

## Posibles Soluciones

### Opción A: Modificar los IPC handlers

Hacer que `enable-server` llame internamente a `connectServer` y `disable-server` llame a `disconnectServer`.

```typescript
// En el handler de enable-server
ipcMain.handle('levante/mcp/enable-server', async (_, serverId) => {
  // 1. Actualizar config
  await configManager.enableServer(serverId);

  // 2. Conectar servidor
  const config = await configManager.getServer(serverId);
  await mcpService.connectServer(config);

  return { success: true };
});
```

### Opción B: Modificar el store

Hacer que `enableServer` en el store llame a `connectServer` después de habilitar:

```typescript
enableServer: async (serverId: string) => {
  const result = await window.levante.mcp.enableServer(serverId);

  if (result.success) {
    // Obtener config y conectar
    const server = get().getServerById(serverId);
    if (server) {
      await get().connectServer(server);
    }
  }
}
```

### Opción C: Unificar enable/disable con connect/disconnect

Considerar si realmente necesitamos 4 acciones separadas o si:
- `connect` = enable + connect
- `disconnect` = disable + disconnect

---

## Recomendación

**Opción A** es la más limpia porque:
1. Mantiene la lógica en el main process
2. El renderer no necesita conocer los detalles de implementación
3. Un solo IPC call hace todo el trabajo

---

## Test de Verificación

Para confirmar el problema:

1. Tener un servidor MCP conectado
2. Deshabilitarlo desde el ToolsMenu
3. Verificar en logs si el servidor realmente se desconectó
4. Habilitarlo de nuevo
5. Verificar si se reconectó automáticamente

Si el servidor no se reconecta al habilitarlo, confirma que los handlers solo cambian el flag sin ejecutar connect/disconnect.

---

## Contexto Adicional

Esta funcionalidad se añadió para permitir a los usuarios desactivar servidores MCP temporalmente desde el chat sin tener que ir a Settings. El objetivo es que:

- **ON → OFF**: Desconecte el servidor (deje de consumir recursos)
- **OFF → ON**: Reconecte el servidor (vuelva a estar disponible)

Actualmente funciona visualmente pero puede que el servidor siga conectado en background cuando está "deshabilitado".
