# Preview Window - Runbook de Implementación (Levante)

## 0) Propósito de este documento

Este documento define una implementación **100% ejecutable** de la feature de Preview Window para Levante.

Está escrito para que una IA sin contexto previo lo pueda aplicar paso a paso.

Regla operativa:
- Todo lo que se implementa debe estar explícito aquí.
- No inferir arquitectura fuera de este runbook.
- Si algo no está en este documento, no se aplica.

---

## 1) Objetivo funcional (v1)

Implementar una ventana secundaria de Electron para previsualizar apps web en desarrollo con:
- Carga de URL (localhost/red local permitida por whitelist).
- Barra de navegación propia (URL, back, forward, reload, open external, toggle DevTools).
- Captura de errores de consola y navegación.
- Auto-refresh al detectar cambios de archivos (basado en `coworkModeCwd`).
- Integración con chat (botón abrir preview + toasts de errores).

No se busca en v1:
- Tabs múltiples.
- Inspector de red.
- Inyección de scripts en la web del usuario.
- Settings UI para editar whitelist (se deja preparado en preferencias).

---

## 2) Decisiones cerradas (obligatorias)

1. Renderizado embebido:
- Usar `WebContentsView` (no `<webview>`, no `BrowserView`).

2. Aislamiento:
- La webapp del usuario se carga en un `WebContentsView` sin preload propio.
- La barra de navegación vive en un `WebContentsView` separado con preload específico.

3. Registro de handlers:
- Registrar IPC en `src/main/lifecycle/initialization.ts`.
- No registrar handlers nuevos en `src/main/main.ts`.

4. Directorio de auto-refresh:
- Tomar `coworkModeCwd` desde preferencias.
- No reimplementar cowork selector: ya existe.

5. Seguridad URL:
- Validación en main process con whitelist configurable.
- `safeOpenExternal` para abrir URL externa.

6. Organización de código por feature:
- Todo Preview debe vivir en carpetas dedicadas `preview/`.
- Evitar crear archivos nuevos de Preview en los roots de `src/main`, `src/preload`, `src/renderer` y `src/types`.

---

## 3) Hechos del repo actual (no contradecir)

1. La app usa Electron Forge + Vite plugin.
- `forge.config.js` define builds para `main` y `preload`.
- Renderer `main_window` usa `vite.renderer.config.ts`.

2. El preload principal es modular:
- `src/preload/preload.ts`
- APIs en `src/preload/api/*`

3. Cowork ya está implementado:
- `coworkModeCwd` existe en tipos y schema.
- Selector nativo ya existe en `src/main/ipc/coworkHandlers.ts` y `src/preload/api/cowork.ts`.
- UI en `src/renderer/components/chat/ToolsMenu.tsx`.

4. Transport ya evita `codeMode` sin cwd:
- `src/renderer/transports/ElectronChatTransport.ts`.

5. Backend ya valida cwd para coding tools:
- `src/main/services/aiService.ts`.

---

## 4) Arquitectura final de Preview (v1)

### 4.1 Componentes

- `previewWindow` (`BrowserWindow`): contenedor de preview.
- `navBarView` (`WebContentsView`): UI React de navegación.
- `webAppView` (`WebContentsView`): webapp del usuario (localhost/red local).

### 4.2 Flujo de comandos

1. Chat renderer (`window.levante.preview.*`) → `ipcMain.handle('levante/preview/...')`.
2. NavBar renderer (`window.levantePreviewNav.*`) → `ipcMain.on('levante/preview/nav/...')`.
3. Main process actualiza `webAppView` y emite eventos:
- a navBar: `levante/preview/nav/...`
- a main window/chat: `levante/preview/...`

### 4.3 Flujo auto-refresh

1. `fileWatcher` observa `coworkModeCwd`.
2. Cuando cambia un archivo relevante:
- notifica preview,
- recarga `webAppView` si auto-refresh está activo,
- emite evento a nav bar y a renderer principal.
3. Coding tools (`write`, `edit`) también notifican cambios para refresh inmediato.

---

## 5) Contratos IPC exactos

### 5.1 IPC invoke (main window / preload principal)

Canales:
- `levante/preview/open` payload `{ url?: string }` → `{ success: boolean }`
- `levante/preview/load-url` payload `{ url: string }` → `{ success: boolean; error?: string }`
- `levante/preview/reload` payload `void` → `{ success: boolean }`
- `levante/preview/navigate` payload `{ direction: 'back' | 'forward' }` → `{ success: boolean }`
- `levante/preview/toggle-devtools` payload `void` → `{ success: boolean; isOpen: boolean }`
- `levante/preview/get-state` payload `void` → `PreviewState`
- `levante/preview/close` payload `void` → `{ success: boolean }`

### 5.2 IPC send/on (nav preload dedicado)

Comandos nav → main:
- `levante/preview/nav/navigate-to` payload `{ url: string }`
- `levante/preview/nav/go-back` payload `void`
- `levante/preview/nav/go-forward` payload `void`
- `levante/preview/nav/reload` payload `void`
- `levante/preview/nav/toggle-devtools` payload `void`
- `levante/preview/nav/open-external` payload `void`
- `levante/preview/nav/set-auto-refresh` payload `{ enabled: boolean }`

Eventos main → nav:
- `levante/preview/nav/url-changed` payload `{ url: string }`
- `levante/preview/nav/webapp-loading` payload `{ isLoading: boolean }`
- `levante/preview/nav/webapp-navigated` payload `NavigationEvent`
- `levante/preview/nav/console-error` payload `ConsoleError`
- `levante/preview/nav/devtools-toggled` payload `{ isOpen: boolean }`
- `levante/preview/nav/webapp-load-error` payload `WebAppLoadError`
- `levante/preview/nav/file-changed` payload `{ filePath: string; timestamp: number }`

### 5.3 Eventos main → renderer principal (chat)

- `levante/preview/console-error` payload `ConsoleError`
- `levante/preview/navigation-event` payload `NavigationEvent`
- `levante/preview/file-changed` payload `{ filePath: string; timestamp: number }`
- `levante/preview/preview-closed` payload `void`

---

## 6) Archivos a crear/modificar

### 6.1 Nuevos

- `src/main/preview/window.ts`
- `src/main/preview/ipc.ts`
- `src/main/preview/fileWatcher.ts`
- `src/main/preview/bridge.ts`
- `src/preload/preview/api.ts`
- `src/preload/preview/navPreload.ts`
- `src/renderer/preview/nav.html`
- `src/renderer/preview/nav.tsx`
- `src/renderer/preview/pages/PreviewNavBar.tsx`
- `src/renderer/preview/components/NavigationBar.tsx`
- `src/renderer/preview/components/LoadErrorDisplay.tsx`
- `src/renderer/preview/stores/previewStore.ts`
- `src/types/preview/index.ts`

### 6.2 Modificados

- `forge.config.js`
- `vite.renderer.config.ts`
- `src/main/lifecycle/initialization.ts`
- `src/types/preferences.ts`
- `src/main/services/preferencesService.ts`
- `src/preload/preload.ts`
- `src/main/services/ai/codingTools/tools/write.ts`
- `src/main/services/ai/codingTools/tools/edit.ts`
- `src/renderer/components/chat/ChatPromptInput.tsx`
- `src/renderer/pages/ChatPage.tsx`
- `src/renderer/locales/en/chat.json`
- `src/renderer/locales/es/chat.json`
- `package.json` (si falta `chokidar`)

---

## 7) Plan por fases (orden obligatorio)

## FASE 0 - Baseline

### Objetivo

Asegurar baseline limpio antes de tocar código.

### Pasos

1. Ejecutar:
```bash
pnpm typecheck
pnpm lint
```

2. Confirmar que no existe implementación previa de preview window:
```bash
rg -n "levante/preview|preview/nav|previewWindow|navPreload" src
```

### Criterio de salida

- `typecheck` en verde.
- Si hay errores preexistentes, documentarlos antes de continuar.

---

## FASE 1 - Preferencias y tipos de seguridad URL

### Objetivo

Agregar whitelist configurable para URLs de preview.

### 1.1 `src/types/preferences.ts`

En `UIPreferences` agregar:
```ts
/** URL allowlist patterns for Preview Window */
previewAllowedUrls: string[];
```

En `DEFAULT_PREFERENCES` agregar:
```ts
previewAllowedUrls: [
  'localhost:*',
  '127.0.0.1:*',
  '0.0.0.0:*',
  '*.local:*',
  '192.168.*.*:*',
],
```

### 1.2 `src/main/services/preferencesService.ts`

En `schema` agregar:
```ts
previewAllowedUrls: {
  type: 'array',
  items: { type: 'string' },
  default: ['localhost:*', '127.0.0.1:*', '0.0.0.0:*', '*.local:*', '192.168.*.*:*']
},
```

### 1.3 `preferencesService` - listener de cambios

Agregar método público:
```ts
onPreferenceChanged<K extends PreferenceKey>(
  key: K,
  callback: (newValue: UIPreferences[K], oldValue: UIPreferences[K]) => void
): () => void {
  this.ensureInitialized();
  return this.store.onDidChange(key, callback as any);
}
```

Este método se usará para reiniciar watcher cuando cambie `coworkModeCwd`.

### Verificación

```bash
pnpm typecheck
```

---

## FASE 2 - Modelo de tipos Preview

### Objetivo

Centralizar contratos TS.

### Crear `src/types/preview/index.ts`

Definir:
- `PreviewState`
- `ConsoleError`
- `NavigationEvent`
- `WebAppLoadError`

Usar estos tipos en main/preload/renderer para evitar drift.

Plantilla mínima obligatoria:
```ts
export interface PreviewState {
  isOpen: boolean;
  currentUrl: string | null;
  isDevToolsOpen: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  autoRefreshEnabled: boolean;
}

export interface ConsoleError {
  level: 'warn' | 'error';
  message: string;
  source: string;
  line: number;
  column: number;
  timestamp: number;
}

export interface NavigationEvent {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

export interface WebAppLoadError {
  errorCode: number;
  errorDescription: string;
  url: string;
}
```

### Verificación

- Imports compilando sin duplicar tipos inline.

---

## FASE 3 - Ventana Preview (main process)

### Objetivo

Crear `BrowserWindow` con dos `WebContentsView` y ciclo de vida completo.

### 3.1 Crear `src/main/preview/window.ts`

Implementar estado módulo:
- `previewWindow: BrowserWindow | null`
- `navBarView: WebContentsView | null`
- `webAppView: WebContentsView | null`
- `currentUrl: string | null`
- `isDevToolsOpen: boolean`
- `autoRefreshEnabled: boolean` (default `true`)

### 3.2 Requisitos de implementación

1. Crear ventana en display actual (similar a mini chat, pero resizable).

2. `navBarView`:
- `preload: join(__dirname, 'navPreload.js')`
- `sandbox: true`
- `contextIsolation: true`
- `nodeIntegration: false`

3. `webAppView`:
- Sin preload.
- `sandbox: true`
- `contextIsolation: true`
- `nodeIntegration: false`
- `webSecurity: true`

4. Carga nav UI:
- Dev: `${MAIN_WINDOW_VITE_DEV_SERVER_URL}/preview/nav.html`
- Fallback dev: `${ELECTRON_RENDERER_URL}/preview/nav.html`
- Prod: `join(__dirname, '../renderer/main_window/preview/nav.html')`

5. Layout:
- `NAV_BAR_HEIGHT = 48`
- `navBarView` arriba, `webAppView` ocupa resto.
- Recalcular en `resize`.

6. Eventos de `webAppView.webContents`:
- `did-start-loading`
- `did-stop-loading`
- `did-navigate`
- `did-navigate-in-page`
- `console-message`
- `did-fail-load`

7. Seguridad URL en `loadPreviewUrl`:
- Normalizar con `normalizeEndpoint` (`src/main/utils/urlValidator.ts`).
- Validar patrón contra `previewAllowedUrls`.
- Si no permitido: no cargar y emitir `webapp-load-error`.

8. `open-external`:
- Usar `safeOpenExternal(currentUrl, 'preview-window')`.
- No usar `shell.openExternal` directo.

9. Exportar API de control:
- `createPreviewWindow(url?: string)`
- `loadPreviewUrl(url: string)`
- `reloadPreview()`
- `navigatePreview(direction)`
- `togglePreviewDevTools()`
- `setPreviewAutoRefresh(enabled: boolean)`
- `notifyPreviewFileChanged(filePath: string)`
- `getPreviewState()`
- `closePreviewWindow()`

10. `notifyPreviewFileChanged(filePath)`:
- Enviar a nav: `levante/preview/nav/file-changed`
- Enviar a main windows: `levante/preview/file-changed`
- Si `autoRefreshEnabled` y `webAppView` existe: `reloadIgnoringCache()`

### 3.3 Función de notificación a renderer principal

Implementar helper interno:
- Enviar eventos a todas las `BrowserWindow` válidas excepto `previewWindow`.
- Canal base `levante/preview/...`

### 3.4 Plantilla mínima de `window.ts`

La implementación final puede tener más detalle, pero debe incluir al menos esta estructura:

```ts
import { BrowserWindow, WebContentsView, screen } from 'electron';
import { join } from 'path';
import { getLogger } from '../services/logging';
import { preferencesService } from '../services/preferencesService';
import { normalizeEndpoint } from '../utils/urlValidator';
import { safeOpenExternal } from '../utils/urlSecurity';
import type { ConsoleError, NavigationEvent, PreviewState, WebAppLoadError } from '../../types/preview';

const logger = getLogger();
const NAV_BAR_HEIGHT = 48;

let previewWindow: BrowserWindow | null = null;
let navBarView: WebContentsView | null = null;
let webAppView: WebContentsView | null = null;
let currentUrl: string | null = null;
let isDevToolsOpen = false;
let autoRefreshEnabled = true;

export function createPreviewWindow(url?: string): BrowserWindow { /* ... */ }
export function loadPreviewUrl(url: string): { success: boolean; error?: string } { /* ... */ }
export function reloadPreview(): void { /* ... */ }
export function navigatePreview(direction: 'back' | 'forward'): void { /* ... */ }
export function togglePreviewDevTools(): boolean { /* ... */ }
export function setPreviewAutoRefresh(enabled: boolean): void { /* ... */ }
export function closePreviewWindow(): void { /* ... */ }
export function getPreviewState(): PreviewState { /* ... */ }
export function notifyPreviewFileChanged(filePath: string): void { /* ... */ }

function createNavBarView(): void { /* preload: join(__dirname, 'navPreload.js') */ }
function createWebAppView(): void { /* sin preload */ }
function updateViewBounds(): void { /* nav 48px + webapp resto */ }
function loadNavBarUI(): void { /* dev/prod paths */ }
function setupWebAppEventListeners(): void { /* did-navigate, console-message, did-fail-load... */ }
function sendToNavBar(channel: string, data: unknown): void { /* levante/preview/nav/... */ }
function notifyMainWindows(event: string, data?: unknown): void { /* levante/preview/... */ }
function isUrlAllowed(url: string, patterns: string[]): boolean { /* wildcard matcher */ }
```

### Verificación

- `pnpm typecheck`.
- Abrir/cerrar preview sin errores de runtime.

---

## FASE 4 - Handlers IPC de Preview

### Objetivo

Conectar renderer principal y nav bar con `window.ts`.

### 4.1 Crear `src/main/preview/ipc.ts`

Implementar `setupPreviewHandlers()`.

### 4.2 Registrar invoke handlers (con `removeHandler` antes)

- `levante/preview/open`
- `levante/preview/load-url`
- `levante/preview/reload`
- `levante/preview/navigate`
- `levante/preview/toggle-devtools`
- `levante/preview/get-state`
- `levante/preview/close`

### 4.3 Registrar listeners nav (`ipcMain.on`)

Antes de registrar, limpiar con `ipcMain.removeAllListeners(channel)`.

Canales:
- `levante/preview/nav/navigate-to`
- `levante/preview/nav/go-back`
- `levante/preview/nav/go-forward`
- `levante/preview/nav/reload`
- `levante/preview/nav/toggle-devtools`
- `levante/preview/nav/open-external`
- `levante/preview/nav/set-auto-refresh`

### 4.4 Integración con lifecycle

Modificar `src/main/lifecycle/initialization.ts`:
- Importar `setupPreviewHandlers`.
- Llamarlo dentro de `registerIPCHandlers()`.

### 4.5 Plantilla mínima de `ipc.ts`

```ts
import { ipcMain } from 'electron';
import { getLogger } from '../services/logging';
import {
  createPreviewWindow,
  loadPreviewUrl,
  reloadPreview,
  navigatePreview,
  togglePreviewDevTools,
  closePreviewWindow,
  getPreviewState,
  setPreviewAutoRefresh,
} from './window';
import { initializeFileWatcher } from './fileWatcher';

const logger = getLogger();

export function setupPreviewHandlers(): void {
  ipcMain.removeHandler('levante/preview/open');
  ipcMain.handle('levante/preview/open', (_e, payload?: { url?: string }) => {
    createPreviewWindow(payload?.url);
    return { success: true };
  });

  // Repetir removeHandler + handle para:
  // load-url, reload, navigate, toggle-devtools, get-state, close

  const navChannels = [
    'levante/preview/nav/navigate-to',
    'levante/preview/nav/go-back',
    'levante/preview/nav/go-forward',
    'levante/preview/nav/reload',
    'levante/preview/nav/toggle-devtools',
    'levante/preview/nav/open-external',
    'levante/preview/nav/set-auto-refresh',
  ];
  navChannels.forEach((c) => ipcMain.removeAllListeners(c));

  ipcMain.on('levante/preview/nav/navigate-to', (_e, payload: { url: string }) => {
    loadPreviewUrl(payload.url);
  });
  ipcMain.on('levante/preview/nav/go-back', () => navigatePreview('back'));
  ipcMain.on('levante/preview/nav/go-forward', () => navigatePreview('forward'));
  ipcMain.on('levante/preview/nav/reload', () => reloadPreview());
  ipcMain.on('levante/preview/nav/toggle-devtools', () => togglePreviewDevTools());
  ipcMain.on('levante/preview/nav/open-external', () => {
    // delegar a helper en window.ts
  });
  ipcMain.on('levante/preview/nav/set-auto-refresh', (_e, payload: { enabled: boolean }) => {
    setPreviewAutoRefresh(!!payload.enabled);
  });

  initializeFileWatcher().catch((error) => {
    logger.core.error('Failed to initialize preview file watcher', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
```

### Verificación

- `pnpm typecheck`.
- Confirmar que handlers se registran al iniciar app.

---

## FASE 5 - File watcher basado en `coworkModeCwd`

### Objetivo

Auto-refresh real cuando cambian archivos de proyecto.

### 5.1 Dependencia

Si no está en dependencias directas:
```bash
pnpm add chokidar
```

### 5.2 Crear `src/main/preview/fileWatcher.ts`

Implementar:
- `initializeFileWatcher()`
- `startFileWatcher(cwd: string)`
- `stopFileWatcher()`
- `getFileWatcherState()`

Reglas:
- Ignorar: `node_modules`, `.git`, `dist`, `build`, `.next`, `.nuxt`, `coverage`, `*.log`.
- Extensiones relevantes: `html`, `css`, `scss`, `js`, `jsx`, `ts`, `tsx`, `json`, `vue`, `svelte`.
- Debounce manual (timer) de 250-300ms.
- Al disparar cambio: llamar `notifyPreviewFileChanged(filePath)` desde `window.ts`.

### 5.3 Reaccionar a cambio de `coworkModeCwd`

En `initializeFileWatcher()`:
1. Leer `preferencesService.get('coworkModeCwd')`.
2. Arrancar watcher si existe.
3. Suscribirse con `preferencesService.onPreferenceChanged('coworkModeCwd', ...)`.
4. Reiniciar watcher cuando cambie.

### 5.4 Inicialización

En `setupPreviewHandlers()` llamar `initializeFileWatcher()` una sola vez.

### 5.5 Plantilla mínima de `fileWatcher.ts`

```ts
import chokidar, { FSWatcher } from 'chokidar';
import { getLogger } from '../services/logging';
import { preferencesService } from '../services/preferencesService';
import { notifyPreviewFileChanged } from './window';

const logger = getLogger();
let watcher: FSWatcher | null = null;
let currentCwd: string | null = null;
let unwatchPreference: (() => void) | null = null;
let debounceTimer: NodeJS.Timeout | null = null;

export async function initializeFileWatcher(): Promise<void> {
  const cwd = preferencesService.get<string | null>('coworkModeCwd') ?? null;
  if (cwd) {
    startFileWatcher(cwd);
  }

  if (!unwatchPreference) {
    unwatchPreference = preferencesService.onPreferenceChanged('coworkModeCwd', (next) => {
      if (!next) {
        stopFileWatcher();
        return;
      }
      if (next !== currentCwd) {
        startFileWatcher(next);
      }
    });
  }
}

export function startFileWatcher(cwd: string): void { /* ... */ }
export function stopFileWatcher(): void { /* ... */ }
export function getFileWatcherState(): { isRunning: boolean; cwd: string | null } { /* ... */ }
```

### Verificación

- Cambiar `coworkModeCwd` desde UI y confirmar reinicio watcher.
- Cambiar un `.tsx` y ver reload en preview.

---

## FASE 6 - Bridge para coding tools

### Objetivo

Cuando AI ejecuta `write`/`edit`, refrescar preview inmediatamente.

### 6.1 Crear `src/main/preview/bridge.ts`

Exponer:
```ts
notifyFileChanged(filePath: string): void
```

Implementación:
- Llamar `notifyPreviewFileChanged(filePath)` desde `src/main/preview/window.ts`.
- Log `debug` con `getLogger()`.

### 6.2 Modificar `write.ts`

Archivo: `src/main/services/ai/codingTools/tools/write.ts`

- Importar `notifyFileChanged` desde `../../../../preview/bridge`.
- Tras `writeFile(...)` exitoso, llamar `notifyFileChanged(resolvedPath)`.

### 6.3 Modificar `edit.ts`

Archivo: `src/main/services/ai/codingTools/tools/edit.ts`

- Importar `notifyFileChanged` desde `../../../../preview/bridge`.
- Tras `writeFile(...)` exitoso, llamar `notifyFileChanged(resolvedPath)`.

### Verificación

- Pedir al agente que edite un archivo del proyecto.
- Confirmar refresh en preview sin tocar manualmente reload.

---

## FASE 7 - Preload principal (API `window.levante.preview`)

### Objetivo

Exponer control de preview al renderer principal.

### 7.1 Crear `src/preload/preview/api.ts`

Implementar API:
- `open(url?: string)`
- `loadUrl(url: string)`
- `reload()`
- `navigate(direction: 'back' | 'forward')`
- `toggleDevTools()`
- `getState()`
- `close()`
- listeners:
  - `onConsoleError(cb)`
  - `onNavigationEvent(cb)`
  - `onFileChanged(cb)`
  - `onClosed(cb)`

Cada listener debe retornar cleanup function (`() => void`) usando `removeListener`.

### 7.2 Modificar `src/preload/preload.ts`

1. Importar `previewApi`.
2. Extender `LevanteAPI` con bloque `preview`.
3. Inyectar `preview: previewApi` en el objeto `api`.

### 7.3 Plantilla mínima de `src/preload/preview/api.ts`

```ts
import { ipcRenderer } from 'electron';
import type { ConsoleError, NavigationEvent, PreviewState } from '../../types/preview';

export const previewApi = {
  open: (url?: string) => ipcRenderer.invoke('levante/preview/open', { url }),
  loadUrl: (url: string) => ipcRenderer.invoke('levante/preview/load-url', { url }),
  reload: () => ipcRenderer.invoke('levante/preview/reload'),
  navigate: (direction: 'back' | 'forward') =>
    ipcRenderer.invoke('levante/preview/navigate', { direction }),
  toggleDevTools: () => ipcRenderer.invoke('levante/preview/toggle-devtools'),
  getState: () => ipcRenderer.invoke('levante/preview/get-state') as Promise<PreviewState>,
  close: () => ipcRenderer.invoke('levante/preview/close'),

  onConsoleError: (callback: (error: ConsoleError) => void) => {
    const listener = (_event: unknown, data: ConsoleError) => callback(data);
    ipcRenderer.on('levante/preview/console-error', listener);
    return () => ipcRenderer.removeListener('levante/preview/console-error', listener);
  },
  onNavigationEvent: (callback: (event: NavigationEvent) => void) => {
    const listener = (_event: unknown, data: NavigationEvent) => callback(data);
    ipcRenderer.on('levante/preview/navigation-event', listener);
    return () => ipcRenderer.removeListener('levante/preview/navigation-event', listener);
  },
  onFileChanged: (callback: (data: { filePath: string; timestamp: number }) => void) => {
    const listener = (_event: unknown, data: { filePath: string; timestamp: number }) => callback(data);
    ipcRenderer.on('levante/preview/file-changed', listener);
    return () => ipcRenderer.removeListener('levante/preview/file-changed', listener);
  },
  onClosed: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('levante/preview/preview-closed', listener);
    return () => ipcRenderer.removeListener('levante/preview/preview-closed', listener);
  },
};
```

### Verificación

- `window.levante.preview` tipado en renderer.
- `pnpm typecheck` en verde.

---

## FASE 8 - Preload dedicado para navBarView

### Objetivo

Dar API mínima a la UI de navegación del preview.

### 8.1 Crear `src/preload/preview/navPreload.ts`

Exponer en `window.levantePreviewNav`:
- comandos `send`:
  - `navigateTo(url)`
  - `goBack()`
  - `goForward()`
  - `reload()`
  - `toggleDevTools()`
  - `openExternal()`
  - `setAutoRefresh(enabled)`
- listeners con cleanup:
  - `onUrlChanged`
  - `onLoading`
  - `onNavigated`
  - `onConsoleError`
  - `onDevToolsToggled`
  - `onLoadError`
  - `onFileChanged`

No exponer APIs adicionales.

### 8.2 Build de preload adicional

Modificar `forge.config.js` en `plugins[...].config.build` y agregar entrada:
```js
{
  entry: 'src/preload/preview/navPreload.ts',
  config: 'vite.preload.config.ts',
  target: 'preload'
}
```

### Verificación

- Verificar que en build existe `navPreload.js` junto a `preload.js`.

### 8.3 Plantilla mínima de `src/preload/preview/navPreload.ts`

```ts
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  navigateTo: (url: string) => ipcRenderer.send('levante/preview/nav/navigate-to', { url }),
  goBack: () => ipcRenderer.send('levante/preview/nav/go-back'),
  goForward: () => ipcRenderer.send('levante/preview/nav/go-forward'),
  reload: () => ipcRenderer.send('levante/preview/nav/reload'),
  toggleDevTools: () => ipcRenderer.send('levante/preview/nav/toggle-devtools'),
  openExternal: () => ipcRenderer.send('levante/preview/nav/open-external'),
  setAutoRefresh: (enabled: boolean) =>
    ipcRenderer.send('levante/preview/nav/set-auto-refresh', { enabled }),

  onUrlChanged: (cb: (data: { url: string }) => void) => {
    const listener = (_event: unknown, data: { url: string }) => cb(data);
    ipcRenderer.on('levante/preview/nav/url-changed', listener);
    return () => ipcRenderer.removeListener('levante/preview/nav/url-changed', listener);
  },
  // Repetir patrón para:
  // onLoading, onNavigated, onConsoleError, onDevToolsToggled, onLoadError, onFileChanged
};

contextBridge.exposeInMainWorld('levantePreviewNav', api);
```

---

## FASE 9 - Renderer: entrypoints `preview/nav`

### Objetivo

Crear app renderer dedicada para nav bar.

### 9.1 Modificar `vite.renderer.config.ts`

Agregar input:
```ts
'preview-nav': path.resolve(__dirname, 'src/renderer/preview/nav.html')
```

Mantener `root` y `outDir` actuales.

### 9.2 Crear `src/renderer/preview/nav.html`

Requisitos:
- `<div id="root"></div>`
- script module a `./nav.tsx`
- altura fija 48px en `html, body, #root`

### 9.3 Crear `src/renderer/preview/nav.tsx`

Requisitos:
- Importar `src/renderer/globals.css` (ruta `../globals.css`).
- Renderizar `PreviewNavBar`.
- No usar `ThemeProvider` inexistente.

### Verificación

- En dev, abrir `${MAIN_WINDOW_VITE_DEV_SERVER_URL}/preview/nav.html`.
- Debe renderizar sin errores.

---

## FASE 10 - Renderer: barra de navegación y estado

### Objetivo

Implementar UI funcional del preview.

### 10.1 Crear store `src/renderer/preview/stores/previewStore.ts`

Estado mínimo:
- `currentUrl`
- `isLoading`
- `canGoBack`
- `canGoForward`
- `isDevToolsOpen`
- `autoRefresh`
- `consoleErrors[]`
- `loadError`

Actions para actualizar cada bloque.

### 10.2 Crear `src/renderer/preview/pages/PreviewNavBar.tsx`

Requisitos:
- Conectar listeners de `window.levantePreviewNav` en `useEffect`.
- Desuscribir cada listener en cleanup.
- Mapear callbacks a actions store.
- Handler submit URL → `navigateTo`.
- Handler toggle auto-refresh → `setAutoRefresh`.

### 10.3 Crear componentes

- `src/renderer/preview/components/NavigationBar.tsx`
- `src/renderer/preview/components/LoadErrorDisplay.tsx`

UI mínima obligatoria:
- Input URL.
- Back/forward/reload.
- Toggle DevTools.
- Toggle Auto-refresh.
- Open external.
- Indicador de errores consola.
- Bloque de error cuando `did-fail-load`.

### Verificación

- Navegación manual funcionando.
- Errores de carga visibles.

---

## FASE 11 - Integración con Chat

### Objetivo

Controlar preview desde chat y mostrar errores.

### 11.1 `src/renderer/components/chat/ChatPromptInput.tsx`

Agregar botón `Open Preview` en toolbar:
- Icono sugerido: `MonitorPlay`.
- Acción: `window.levante.preview.open()`.
- Con tooltip i18n.

No mover lógica de cowork existente.

### 11.2 `src/renderer/pages/ChatPage.tsx`

Agregar `useEffect`:
- Subscribe `window.levante.preview.onConsoleError(...)`.
- Mostrar `toast.error(...)` (usar `sonner`).
- Cleanup con unsubscribe.

Opcional recomendado:
- También escuchar `onNavigationEvent` para telemetría/debug.

### 11.3 i18n

Modificar:
- `src/renderer/locales/en/chat.json`
- `src/renderer/locales/es/chat.json`

Agregar claves:
- `preview.open_button`
- `preview.open_tooltip`
- `preview.error_toast_title`
- `preview.error_toast_view_details`

### Verificación

- Botón abre preview.
- `console.error` en webapp muestra toast en chat.

---

## FASE 12 - Registro final en main lifecycle

### Objetivo

Garantizar bootstrap sin hacks en `main.ts`.

### Pasos

1. En `src/main/lifecycle/initialization.ts`:
- Importar `setupPreviewHandlers`.
- Llamarlo dentro de `registerIPCHandlers()` junto a los demás.

2. No tocar `src/main/main.ts` para registrar preview handlers.

### Verificación

- Al iniciar app, handlers de preview disponibles.

---

## 8) Reglas de seguridad obligatorias

1. `webAppView` sin preload.
2. `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
3. Validar URL antes de `loadURL`.
4. Abrir externo solo con `safeOpenExternal`.
5. No habilitar `webviewTag`.
6. No usar `executeJavaScript` sobre la web del usuario.

---

## 9) Validaciones funcionales (matriz)

### Caso A - Apertura base
1. Click en botón preview en chat.
2. Se abre ventana independiente.
3. Barra visible y funcional.

### Caso B - Carga URL permitida
1. Cargar `localhost:5173`.
2. Debe normalizar a `http://localhost:5173`.
3. Debe renderizar webapp.

### Caso C - URL bloqueada
1. Cargar `https://example.com` (si no está en whitelist).
2. Debe bloquear y mostrar `LoadErrorDisplay`.

### Caso D - Navegación
1. Ir a otra ruta.
2. Back/forward actualizan estado `canGoBack/canGoForward`.

### Caso E - Errores de consola
1. Ejecutar `console.error('x')` en webapp.
2. Debe aparecer en nav indicator y toast en chat.

### Caso F - Auto-refresh por watcher
1. `coworkModeCwd` configurado.
2. Editar archivo `.tsx` del proyecto.
3. Preview recarga en < 500ms aprox desde evento.

### Caso G - Auto-refresh por coding tools
1. Pedir al agente que use `write` o `edit`.
2. Preview recarga inmediatamente.

### Caso H - DevTools toggle
1. Toggle desde nav.
2. Abrir/cerrar DevTools de `webAppView`.

---

## 10) Checklist de Definition of Done

- [ ] `pnpm typecheck` en verde.
- [ ] `pnpm lint` en verde o errores preexistentes documentados.
- [ ] Preview abre/cierra sin errores.
- [ ] URL allowlist aplicada en main process.
- [ ] Nav controls funcionales.
- [ ] Console errors llegan al chat.
- [ ] Auto-refresh funciona con watcher y con coding tools.
- [ ] No se rompe cowork existente.
- [ ] No se agregan handlers fuera de `initialization.ts`.

---

## 11) Orden exacto de ejecución para IA implementadora

1. FASE 0
2. FASE 1
3. FASE 2
4. FASE 3
5. FASE 4
6. FASE 5
7. FASE 6
8. FASE 7
9. FASE 8
10. FASE 9
11. FASE 10
12. FASE 11
13. FASE 12
14. Validaciones de sección 9
15. Checklist sección 10

No alterar el orden.

---

## 12) Riesgos y mitigaciones

1. Riesgo: preload adicional no compila.
- Mitigación: verificar `forge.config.js` build entries + path `navPreload.js`.

2. Riesgo: listeners duplicados IPC.
- Mitigación: `removeHandler` / `removeAllListeners` antes de registrar.

3. Riesgo: eventos enviados al webContents incorrecto.
- Mitigación: para nav usar siempre `navBarView.webContents.send(...)`.

4. Riesgo: bloqueo de URL incorrecto por regex.
- Mitigación: testear patrones con y sin puerto en Caso B/C.

5. Riesgo: degradación por watcher agresivo.
- Mitigación: ignores + debounce + extensiones permitidas.

---

## 13) Comandos finales de verificación

```bash
pnpm typecheck
pnpm lint
pnpm dev
```

Smoke manual durante `pnpm dev`:
- Abrir preview desde chat.
- Cargar localhost.
- Cambiar archivo y verificar reload.
- Forzar `console.error` y verificar toast.

---

## 14) Notas de compatibilidad

- `previewAllowedUrls` se agrega ahora, pero UI de edición en Settings queda para v2.
- `coworkModeCwd` **no se rediseña**: solo se consume para watcher.
- Este runbook asume Electron >= 30 (repo usa Electron 37, compatible).
