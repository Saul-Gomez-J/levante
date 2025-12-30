# Plan de Implementación: Auto-Conexión MCP desde Formulario

## Resumen

**Objetivo**: Hacer que cuando se agregue un servidor MCP desde el formulario (`FormMCPConfig.tsx`), se intente conectar automáticamente después de guardarlo, igual que hace el Store.

**Dificultad**: Fácil (1-2 horas)

**Archivos a modificar**: 3

---

## Paso 1: Modificar FormMCPConfig.tsx

**Archivo**: `src/renderer/components/mcp/config/FormMCPConfig.tsx`

### 1.1 Agregar imports necesarios

**Ubicación**: Líneas 1-16

**Código actual**:
```typescript
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, AlertCircle, X } from 'lucide-react';
import { useMCPStore } from '@/stores/mcpStore';
import { MCPServerConfig } from '@/types/mcp';
import { useTranslation } from 'react-i18next';
```

**Código nuevo**:
```typescript
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, AlertCircle, X } from 'lucide-react';
import { useMCPStore } from '@/stores/mcpStore';
import { useOAuthStore } from '@/stores/oauthStore';
import { MCPServerConfig } from '@/types/mcp';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
```

---

### 1.2 Extraer `connectServer` del store

**Ubicación**: Línea 52

**Código actual**:
```typescript
const { addServer } = useMCPStore();
```

**Código nuevo**:
```typescript
const { addServer, connectServer } = useMCPStore();
```

---

### 1.3 Modificar función `handleSave`

**Ubicación**: Líneas 188-242

**Código actual**:
```typescript
const handleSave = async () => {
  if (!validate()) return;

  setIsSaving(true);
  setError(null);

  try {
    const serverConfig: MCPServerConfig = {
      id: sanitizeNameToId(name),
      name: name.trim(),
      transport: connectionType,
    };

    if (connectionType === 'stdio') {
      const parts = command.trim().split(/\s+/);
      serverConfig.command = parts[0];
      serverConfig.args = parts.slice(1);

      const env: Record<string, string> = {};
      envVariables.forEach(({ key, value }) => {
        if (key.trim()) {
          env[key.trim()] = value;
        }
      });
      if (Object.keys(env).length > 0) {
        serverConfig.env = env;
      }
    } else {
      serverConfig.url = url.trim();

      const headers: Record<string, string> = {};

      if (authType === 'bearer' && bearerToken.trim()) {
        headers['Authorization'] = `Bearer ${bearerToken.trim()}`;
      }

      customHeaders.forEach(({ key, value }) => {
        if (key.trim()) {
          headers[key.trim()] = value;
        }
      });

      if (Object.keys(headers).length > 0) {
        serverConfig.headers = headers;
      }
    }

    await addServer(serverConfig);
    onClose();
  } catch (err) {
    setError(t('config.save_error'));
  } finally {
    setIsSaving(false);
  }
};
```

**Código nuevo**:
```typescript
const handleSave = async () => {
  if (!validate()) return;

  setIsSaving(true);
  setError(null);

  try {
    const serverConfig: MCPServerConfig = {
      id: sanitizeNameToId(name),
      name: name.trim(),
      transport: connectionType,
    };

    if (connectionType === 'stdio') {
      const parts = command.trim().split(/\s+/);
      serverConfig.command = parts[0];
      serverConfig.args = parts.slice(1);

      const env: Record<string, string> = {};
      envVariables.forEach(({ key, value }) => {
        if (key.trim()) {
          env[key.trim()] = value;
        }
      });
      if (Object.keys(env).length > 0) {
        serverConfig.env = env;
      }
    } else {
      serverConfig.url = url.trim();

      const headers: Record<string, string> = {};

      if (authType === 'bearer' && bearerToken.trim()) {
        headers['Authorization'] = `Bearer ${bearerToken.trim()}`;
      }

      customHeaders.forEach(({ key, value }) => {
        if (key.trim()) {
          headers[key.trim()] = value;
        }
      });

      if (Object.keys(headers).length > 0) {
        serverConfig.headers = headers;
      }
    }

    // 1. Guardar configuración
    await addServer(serverConfig);

    // 2. Intentar conectar automáticamente
    const toastId = toast.loading(t('messages.connecting', { name: serverConfig.name }));

    try {
      await connectServer(serverConfig);
      toast.success(t('messages.added', { name: serverConfig.name }), { id: toastId });
      onClose();
    } catch (connectError: any) {
      // Manejar OAuth requerido
      if (connectError.code === 'OAUTH_REQUIRED') {
        const { handleOAuthRequired } = useOAuthStore.getState();
        handleOAuthRequired({
          serverId: connectError.serverConfig?.id || serverConfig.id,
          mcpServerUrl: connectError.metadata?.mcpServerUrl || '',
          wwwAuth: connectError.metadata?.wwwAuth || ''
        });

        toast.info(t('messages.oauth_required', { name: serverConfig.name }), { id: toastId });
        onClose();
        return;
      }

      // Manejar errores de runtime
      if (connectError.errorCode === 'RUNTIME_NOT_FOUND' || connectError.message === 'RUNTIME_NOT_FOUND') {
        toast.error(t('messages.runtime_not_available'), { id: toastId });
        onClose();
        return;
      }

      // Otros errores: servidor guardado pero no conectado
      toast.warning(t('messages.added_not_connected', { name: serverConfig.name }), { id: toastId });
      onClose();
    }
  } catch (err) {
    setError(t('config.save_error'));
  } finally {
    setIsSaving(false);
  }
};
```

---

## Paso 2: Agregar traducciones (si no existen)

Las traducciones necesarias ya existen en los archivos de idioma:

### Verificación en `src/renderer/locales/en/mcp.json`:
- `messages.connecting`: "Setting up {{name}}..." ✅
- `messages.added`: "{{name}} added and connected" ✅
- `messages.oauth_required`: "OAuth authorization required for {{name}}..." ✅
- `messages.runtime_not_available`: "Runtime not available..." ✅
- `messages.added_not_connected`: "{{name}} added but couldn't connect..." ✅

### Verificación en `src/renderer/locales/es/mcp.json`:
- `messages.connecting`: "Configurando {{name}}..." ✅
- `messages.added`: "{{name}} añadido y conectado" ✅
- `messages.oauth_required`: "Se requiere autorización OAuth para {{name}}..." ✅
- `messages.runtime_not_available`: "Runtime no disponible..." ✅
- `messages.added_not_connected`: "{{name}} añadido pero no se pudo conectar..." ✅

**No se requieren cambios en los archivos de traducción.**

---

## Resumen de Cambios

| Archivo | Tipo de Cambio | Descripción |
|---------|----------------|-------------|
| `src/renderer/components/mcp/config/FormMCPConfig.tsx` | Modificación | Agregar imports, extraer `connectServer`, modificar `handleSave` |
| `src/renderer/locales/en/mcp.json` | Sin cambios | Traducciones ya existen |
| `src/renderer/locales/es/mcp.json` | Sin cambios | Traducciones ya existen |

---

## Flujo Después del Fix

```
Usuario rellena formulario
         │
         ▼
    handleSave()
         │
         ▼
    addServer(config)  ──► Guarda en .mcp.json
         │
         ▼
    connectServer(config)
         │
         ├─── Éxito ──► toast.success("Conectado")
         │                      │
         │                      ▼
         │                  onClose()
         │
         ├─── OAuth Required ──► handleOAuthRequired()
         │                              │
         │                              ▼
         │                       toast.info("OAuth requerido")
         │                              │
         │                              ▼
         │                          onClose()
         │
         ├─── Runtime Not Found ──► toast.error("Runtime no disponible")
         │                                 │
         │                                 ▼
         │                             onClose()
         │
         └─── Otro Error ──► toast.warning("Guardado pero no conectado")
                                    │
                                    ▼
                                onClose()
```

---

## Testing

1. **Caso básico**: Agregar servidor STDIO simple (ej: `npx @modelcontextprotocol/server-filesystem /tmp`)
   - Debería mostrar toast "Conectando..."
   - Luego toast "Conectado" si éxito

2. **Caso OAuth**: Agregar servidor HTTP que requiere OAuth
   - Debería mostrar toast "OAuth requerido"
   - Debería abrir diálogo de autorización OAuth

3. **Caso error**: Agregar servidor con comando inválido
   - Debería mostrar toast "Guardado pero no conectado"
   - Servidor aparece en lista pero desconectado
