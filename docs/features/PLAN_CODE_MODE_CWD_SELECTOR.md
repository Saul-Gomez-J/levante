# Runbook de Implementación: Selector de Carpeta (CWD) para Cowork Mode

## 0) Propósito de este documento

Este documento está diseñado para que **otra IA** (o cualquier ingeniero) pueda ejecutar la implementación completa sin ambigüedades.

Incluye:
- Qué hay que cambiar.
- En qué archivo exacto.
- Por qué se cambia.
- Cómo validar cada fase.
- Riesgos y criterios de aceptación.

## 1) Decisiones cerradas (obligatorias)

Estas decisiones vienen de producto y **no se deben reinterpretar**:

1. Si `coworkMode` está activo y `coworkModeCwd` es `null`/vacío:
   - `codeMode` **NO** se envía en el request al backend.
   - Las coding tools quedan **desactivadas**.
   - La UI debe mostrar un **warning visible** indicando que falta seleccionar carpeta.
2. La API de selección de carpeta debe ser **acotada a cowork**.
   - No crear API genérica de `dialog`.
   - Nombre recomendado del namespace público: `window.levante.cowork`.

## 2) Alcance

### 2.1 En alcance

- Persistencia de CWD de cowork en preferencias.
- Selector nativo de directorio por IPC.
- UI de indicador de estado + warning cuando falta CWD.
- Transporte del valor CWD solo cuando corresponde.
- Validación defensiva en backend para evitar activar coding tools con CWD inválido.

### 2.2 Fuera de alcance

- Permisos finos por herramienta (`bash/read/write/...`) más allá del comportamiento actual.
- Sandbox adicional por CWD en filesystem de tools (no existe hoy un confinamiento estricto por path).
- Cambios de UX en mini-chat (si no usa el mismo `ChatPromptInput`, no tocarlo).

## 3) Contexto técnico actual del repo

### 3.1 Registro IPC real

En este repo, los handlers no se registran en `src/main/ipc/index.ts`.
El registro central ocurre en:
- `src/main/lifecycle/initialization.ts`
- Función: `registerIPCHandlers()`

### 3.2 Preload modular

El preload está modularizado:
- APIs en `src/preload/api/*`
- ensambladas en `src/preload/preload.ts`
- tipado de request chat en `src/preload/types/index.ts`

### 3.3 Flujo actual de cowork

Actualmente:
- `coworkMode` existe como preferencia.
- `ElectronChatTransport` envía `codeMode.enabled` cuando `coworkMode = true`.
- Backend (`AIService.streamChat`) usa `request.codeMode.cwd ?? process.cwd()`.

Problema: si no hay carpeta seleccionada, se ejecuta en `process.cwd()` silenciosamente.

## 4) Objetivo funcional final

### 4.1 Comportamiento esperado

- Usuario activa cowork.
- Si no hay carpeta:
  - indicador ámbar + warning textual,
  - no se envía `codeMode`,
  - chat funciona normal sin coding tools.
- Si selecciona carpeta:
  - se persiste en preferencias,
  - indicador azul,
  - `codeMode.cwd` se envía,
  - coding tools usan esa carpeta.

### 4.2 Principio de seguridad

No hacer fallback silencioso a `process.cwd()` cuando el usuario no proporcionó CWD válido para cowork.

## 5) Plan de implementación por fases

## FASE 0 - Preparación y baseline

### Objetivo

Arrancar con baseline verificable para detectar regresiones.

### Pasos

1. Confirmar rama de trabajo.
2. Ejecutar baseline de tipos:

```bash
pnpm typecheck
```

3. Confirmar que no exista ya API cowork de directorio:

```bash
rg -n "selectWorkingDirectory|levante/cowork/select-working-directory|window\.levante\.cowork" src
```

### Criterio de salida

- `pnpm typecheck` en verde antes de cambios.
- Sin implementaciones duplicadas de cowork selector.

---

## FASE 1 - Preferencias y persistencia de CWD

### Archivos

- `src/types/preferences.ts`
- `src/main/services/preferencesService.ts`

### Cambios requeridos

#### 1.1 Agregar preferencia a tipo y defaults

En `src/types/preferences.ts`:

1. En `UIPreferences`, agregar:

```ts
/** Working directory for Cowork mode (coding tools) */
coworkModeCwd: string | null;
```

2. En `DEFAULT_PREFERENCES`, agregar:

```ts
coworkModeCwd: null,
```

#### 1.2 Agregar preferencia al schema de electron-store

En `src/main/services/preferencesService.ts`, dentro de `schema`, agregar:

```ts
coworkModeCwd: {
  type: ["string", "null"],
  default: null,
},
```

### Por qué

Si solo se actualiza `UIPreferences` pero no el schema, la clave puede no validarse como esperamos en `electron-store` y se pierde consistencia entre tipado y almacenamiento real.

### Verificación de fase

1. Revisar que `usePreference('coworkModeCwd')` compile (aún no usado, pero debe tipar).
2. Ejecutar:

```bash
pnpm typecheck
```

---

## FASE 2 - IPC principal + preload (API acotada a cowork)

### Archivos

- Nuevo: `src/main/ipc/coworkHandlers.ts`
- Modificar: `src/main/lifecycle/initialization.ts`
- Nuevo: `src/preload/api/cowork.ts`
- Modificar: `src/preload/preload.ts`

### Cambios requeridos

#### 2.1 Crear handler IPC dedicado de cowork

Crear `src/main/ipc/coworkHandlers.ts`.

Contrato IPC:
- Channel: `levante/cowork/select-working-directory`
- Input: `{ title?, defaultPath?, buttonLabel? }`
- Output:
  - `success: true` + `data: { path, canceled }`
  - `success: false` + `error`

Implementación recomendada:
- `ipcMain.removeHandler(channel)` antes de `ipcMain.handle(...)`.
- Obtener ventana emisora con:

```ts
const win = BrowserWindow.fromWebContents(event.sender);
```

- Mostrar diálogo con `dialog.showOpenDialog` usando `properties: ['openDirectory', 'createDirectory']`.

#### 2.2 Registrar handler en el punto correcto

En `src/main/lifecycle/initialization.ts`:

1. Importar `setupCoworkHandlers`.
2. Invocarlo dentro de `registerIPCHandlers()` junto al resto de setup.

### Importante

No usar `src/main/ipc/index.ts` (ese archivo no existe en esta arquitectura).

#### 2.3 Crear API preload acotada a cowork

Crear `src/preload/api/cowork.ts` con:

```ts
import { ipcRenderer } from 'electron';

export interface SelectWorkingDirectoryResult {
  success: boolean;
  data?: { path: string; canceled: boolean };
  error?: string;
}

export const coworkApi = {
  selectWorkingDirectory: (options?: {
    title?: string;
    defaultPath?: string;
    buttonLabel?: string;
  }) =>
    ipcRenderer.invoke('levante/cowork/select-working-directory', options) as Promise<SelectWorkingDirectoryResult>,
};
```

#### 2.4 Integrar API en preload principal

En `src/preload/preload.ts`:

1. Importar `coworkApi`.
2. Extender `LevanteAPI` con:

```ts
cowork: {
  selectWorkingDirectory: (options?: {
    title?: string;
    defaultPath?: string;
    buttonLabel?: string;
  }) => Promise<{
    success: boolean;
    data?: { path: string; canceled: boolean };
    error?: string;
  }>;
};
```

3. En el objeto `api`, agregar:

```ts
cowork: coworkApi,
```

### Por qué

- API dedicada a cowork minimiza superficie y evita mezclar usos no relacionados.
- Usar `event.sender` abre el diálogo en la ventana correcta.

### Verificación de fase

1. `pnpm typecheck`.
2. Confirmar que `window.levante.cowork.selectWorkingDirectory` aparece en TS sin errores.

---

## FASE 3 - UI: selector, indicador y warning

### Archivos

- `src/renderer/components/chat/ToolsMenu.tsx`
- `src/renderer/components/chat/ChatPromptInput.tsx`
- `src/renderer/pages/ChatPage.tsx`

### Cambios requeridos

#### 3.1 ToolsMenu: nuevas props de cowork CWD

En `ToolsMenuProps` agregar:

```ts
coworkModeCwd: string | null;
onCoworkModeCwdChange: (cwd: string | null) => void;
```

#### 3.2 ToolsMenu: llamada a selector cowork

Reemplazar cualquier uso de `window.levante.dialog.*` por:

```ts
window.levante.cowork.selectWorkingDirectory(...)
```

#### 3.3 ToolsMenu: warning visible cuando no hay carpeta

Condición:

```ts
const showCoworkMissingDirWarning = coworkMode && !coworkModeCwd;
```

Mostrar un texto visible (no solo tooltip), por ejemplo bajo el selector:
- `tools_menu.cowork.missing_directory_warning`

#### 3.4 ToolsMenu: nombre corto cross-platform

Para obtener nombre de carpeta:

```ts
const parts = cwd.split(/[\\/]/).filter(Boolean);
```

No usar `split('/')` únicamente.

#### 3.5 ChatPromptInput: prop drilling hacia ToolsMenu

Agregar en `ChatPromptInputProps`:
- `coworkModeCwd`
- `onCoworkModeCwdChange`

Pasarlas al `<ToolsMenu />`.

#### 3.6 ChatPage: estado de preferencia y paso al input/transport

En `ChatPage.tsx`:

1. Crear estado:

```ts
const [coworkModeCwd, setCoworkModeCwd] = usePreference('coworkModeCwd');
```

2. Incluir en `createElectronChatTransport({...})`.
3. Incluir en `transport.updateOptions({...})`.
4. Pasar props a los dos `<ChatPromptInput />` del archivo.

### Por qué

- El warning guía al usuario y evita estado “cowork activo pero no operativo”.
- La persistencia en preferencia hace que no tenga que seleccionar carpeta en cada inicio.

### Verificación de fase

1. `pnpm typecheck`.
2. UI:
   - cowork ON + sin carpeta => warning visible.
   - seleccionar carpeta => warning desaparece.

---

## FASE 4 - Transport: enviar `codeMode` solo si hay CWD

### Archivo

- `src/renderer/transports/ElectronChatTransport.ts`

### Cambios requeridos

1. Ampliar options internas:

```ts
private defaultOptions: {
  model?: string;
  enableMCP?: boolean;
  coworkMode?: boolean;
  coworkModeCwd?: string | null;
}
```

2. Leer `coworkModeCwd` desde `bodyObj`/`defaultOptions`.

3. Construir request con condición estricta:

```ts
...(coworkMode && coworkModeCwd && {
  codeMode: {
    enabled: true,
    cwd: coworkModeCwd,
  },
}),
```

4. Ampliar firma de factory:

```ts
createElectronChatTransport(options?: {
  model?: string;
  enableMCP?: boolean;
  coworkMode?: boolean;
  coworkModeCwd?: string | null;
})
```

### Por qué

Se implementa la decisión de producto: sin carpeta, no hay `codeMode`, no hay coding tools.

### Verificación de fase

- `pnpm typecheck`.
- Revisar logs del request para confirmar ausencia/presencia de `codeMode` según estado.

---

## FASE 5 - Backend: validación obligatoria de CWD

### Archivo

- `src/main/services/aiService.ts`

### Cambios requeridos

Ubicar bloque de `streamChat()` donde actualmente se cargan coding tools (`if (request.codeMode?.enabled) { ... }`).

Reemplazar lógica por flujo defensivo:

1. Extraer `requestedCwd = request.codeMode.cwd`.
2. Si falta `requestedCwd`:
   - warning en logs,
   - **no cargar coding tools**,
   - continuar con flujo de chat sin ellas.
3. Si existe:
   - validar con `fs.promises.stat(requestedCwd)`,
   - exigir `stats.isDirectory()`.
4. Si falla validación:
   - warning,
   - **no cargar coding tools**.
5. Solo en caso válido:
   - `getCodingTools({ cwd: requestedCwd, enabled: request.codeMode.tools })`.

### Ejemplo de helper recomendado

Puedes crear helper privado para claridad:

```ts
private async resolveValidCoworkCwd(cwd?: string): Promise<string | null> {
  if (!cwd) return null;
  try {
    const fs = await import('fs/promises');
    const stats = await fs.stat(cwd);
    return stats.isDirectory() ? cwd : null;
  } catch {
    return null;
  }
}
```

Y en `streamChat`:

```ts
if (request.codeMode?.enabled) {
  const validCwd = await this.resolveValidCoworkCwd(request.codeMode.cwd);
  if (!validCwd) {
    this.logger.aiSdk.warn('Cowork code mode requested without valid cwd; skipping coding tools', {
      requestedCwd: request.codeMode.cwd,
    });
  } else {
    const codingTools = getCodingTools({
      cwd: validCwd,
      enabled: request.codeMode.tools,
    });
    tools = { ...tools, ...codingTools };
  }
}
```

### Regla importante

No reintroducir fallback a `process.cwd()` para este caso.

### Por qué

Evita ejecutar comandos en directorio inesperado y respeta intención del usuario.

### Verificación de fase

1. `pnpm typecheck`.
2. Prueba manual:
   - Forzar `codeMode.enabled=true` con `cwd` inválido.
   - Confirmar que no se cargan coding tools.

---

## FASE 6 - Traducciones (incluye warning)

### Archivos

- `src/renderer/locales/en/chat.json`
- `src/renderer/locales/es/chat.json`

### Claves nuevas requeridas

Agregar bajo `tools_menu.cowork`:

- `label`
- `active`
- `tooltip`
- `no_directory`
- `select_directory_title`
- `select_button`
- `click_to_select`
- `select_directory_hint`
- `missing_directory_warning`

### Recomendación de textos

EN:
- `missing_directory_warning`: `Cowork is enabled but no working directory is selected. Coding tools are disabled.`

ES:
- `missing_directory_warning`: `Cowork está activado pero no hay carpeta de trabajo seleccionada. Las herramientas de código están desactivadas.`

### Por qué

Evita warning hardcodeado y mantiene consistencia i18n.

### Verificación de fase

- Cambiar idioma EN/ES y confirmar traducción del warning.

---

## 6) Secuencia exacta de ejecución para el agente implementador

Ejecutar en este orden:

1. FASE 1 (tipos + schema)
2. FASE 2 (IPC + preload)
3. FASE 3 (UI)
4. FASE 4 (transport)
5. FASE 5 (backend validación)
6. FASE 6 (i18n)
7. Verificaciones finales (tipo + smoke manual)

No saltar fases.

## 7) Checklist de aceptación (Definition of Done)

### 7.1 Build/typing

- `pnpm typecheck` pasa sin errores.

### 7.2 Funcional

1. Cowork ON, sin CWD:
   - warning visible,
   - request sin `codeMode`.
2. Cowork ON, con CWD válido:
   - request con `codeMode.cwd` correcto.
3. Cowork ON, CWD inválido (si se inyecta manualmente):
   - backend no carga coding tools,
   - warning en logs.
4. Persistencia:
   - reiniciar app mantiene `coworkModeCwd`.

### 7.3 UX

- Indicador ámbar cuando falta CWD.
- Indicador azul cuando CWD válido seleccionado.
- Click en indicador abre selector nativo.

## 8) Matriz de pruebas manuales detallada

### Caso A: primera activación sin carpeta

1. Abrir chat.
2. Activar Cowork.
3. Verificar warning visible.
4. Enviar mensaje pidiendo usar `ls`.
5. Resultado esperado: respuesta sin tool calls de coding.

### Caso B: selección de carpeta y uso de tools

1. Cowork activo.
2. Click en indicador/campo de carpeta.
3. Seleccionar directorio proyecto.
4. Enviar mensaje: `lista archivos del directorio`.
5. Resultado esperado: tool call de `ls` y contenido de la carpeta seleccionada.

### Caso C: cancelar selector

1. Abrir selector.
2. Cancelar.
3. Resultado esperado: no cambia `coworkModeCwd`.

### Caso D: persistencia entre reinicios

1. Seleccionar carpeta.
2. Cerrar app.
3. Reabrir app.
4. Resultado esperado: cowork mantiene carpeta anterior.

### Caso E: CWD inválido inyectado (defensivo backend)

1. Manipular preferencia a ruta inexistente.
2. Enviar mensaje con cowork activo.
3. Resultado esperado:
   - backend omite coding tools,
   - warning en logs,
   - chat no rompe.

## 9) Observabilidad recomendada (logs)

Registrar en categorías existentes (`logger.ipc`, `logger.aiSdk`) al menos:

- `cowork directory selected/canceled` (IPC).
- `sending codeMode with cwd` / `skipping codeMode because cwd missing` (transport).
- `skipping coding tools because cwd invalid/missing` (backend).

Esto simplifica diagnóstico cuando el usuario reporta: “cowork no ejecuta tools”.

## 10) Riesgos y mitigaciones

1. Riesgo: desalineación entre `UIPreferences` y schema.
   - Mitigación: FASE 1 incluye ambos cambios y typecheck inmediato.
2. Riesgo: diálogo aparece en ventana incorrecta.
   - Mitigación: usar `BrowserWindow.fromWebContents(event.sender)`.
3. Riesgo: regresión por API preload mal ensamblada.
   - Mitigación: crear módulo `src/preload/api/cowork.ts` y añadirlo en `api` central.
4. Riesgo: fallback silencioso al cwd del proceso.
   - Mitigación: validación backend sin fallback y logs explícitos.

## 11) Plan de rollback

Si algo falla en runtime:

1. Desactivar `coworkMode` desde preferencias para bloquear envío de `codeMode`.
2. Revertir commits de:
   - `coworkHandlers` + wiring preload,
   - cambios de transport/backend.
3. Mantener cambios i18n y UI fuera si no afectan compilación.

## 12) Resumen de archivos (final)

### Nuevos

1. `src/main/ipc/coworkHandlers.ts`
2. `src/preload/api/cowork.ts`

### Modificados

1. `src/types/preferences.ts`
2. `src/main/services/preferencesService.ts`
3. `src/main/lifecycle/initialization.ts`
4. `src/preload/preload.ts`
5. `src/renderer/components/chat/ToolsMenu.tsx`
6. `src/renderer/components/chat/ChatPromptInput.tsx`
7. `src/renderer/pages/ChatPage.tsx`
8. `src/renderer/transports/ElectronChatTransport.ts`
9. `src/main/services/aiService.ts`
10. `src/renderer/locales/en/chat.json`
11. `src/renderer/locales/es/chat.json`

## 13) Comandos de verificación final

Ejecutar al terminar:

```bash
pnpm typecheck
pnpm lint
```

Si `lint` falla por reglas no relacionadas, documentar qué errores son preexistentes y cuáles son introducidos por este cambio.
