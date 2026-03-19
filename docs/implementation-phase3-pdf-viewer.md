# Plan de Implementación: Previsualización de PDFs (Phase 3) - Streaming Seguro (sin base64 en store)

## Contexto

El sistema de panel unificado (`SidePanel`) ya define `PdfTab` y placeholders en UI, pero no existe lógica para abrir ni renderizar PDFs.

Este runbook reemplaza el enfoque de cargar `base64` en Zustand por una arquitectura de mejores prácticas:

1. `pdf.js` carga el documento desde una URL local `levante-fs://...`.
2. El main process atiende esa URL con `protocol.handle` y `Range requests` (streaming).
3. Se valida cada path contra el CWD (mismo boundary de seguridad de File Browser).
4. El store NO guarda bytes de PDF, solo metadatos de pestaña.

Resultado: menos memoria, mejor rendimiento en PDFs grandes, y sin duplicación innecesaria de datos en estado global.

## Principios de diseño (obligatorios)

- No almacenar `base64`/`ArrayBuffer` de PDF en Zustand.
- No exponer lectura arbitraria de filesystem: todo path debe validarse dentro del CWD.
- Soportar `Accept-Ranges: bytes` para que `pdf.js` pueda cargar de forma eficiente.
- Mantener compatibilidad visual con `TabChip`, `PanelContextBar` y `PanelControls`.

---

## Paso 1 - Main process: protocolo local para servir PDFs

### 1.1 Registrar esquema privilegiado (pre-app-ready)

**Archivo**: `src/main/main.ts`

Actualizar import de Electron:

```ts
import { app, BrowserWindow, protocol } from "electron";
```

Antes de `app.whenReady()`, registrar esquema:

```ts
protocol.registerSchemesAsPrivileged([
  {
    scheme: "levante-fs",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);
```

### 1.2 Crear servicio de protocolo PDF con streaming

**Archivo nuevo**: `src/main/services/filesystem/pdfProtocolService.ts`

Crear servicio con esta responsabilidad:

- Registrar `protocol.handle('levante-fs', handler)`.
- Atender solo host `pdf` (ejemplo URL: `levante-fs://pdf?path=...`).
- Validar path con `fileSystemService` (ver 1.3).
- Permitir solo extensión `.pdf`.
- Soportar headers `Range` para responder `206 Partial Content`.
- Responder `Content-Type: application/pdf`, `Accept-Ranges: bytes`, `Cache-Control: no-store`.

Notas de implementación:

- Usar `fs.createReadStream(...)` + `Readable.toWeb(...)` para `Response`.
- En errores de validación devolver `403`.
- En path inválido o no encontrado devolver `404`.
- En media type inválido devolver `415`.
- Si `Range` es inválido devolver `416`.

### 1.3 Exponer helper público de validación de path

**Archivo**: `src/main/services/filesystem/fileSystemService.ts`

Añadir método público para reutilizar la validación existente sin duplicar lógica:

```ts
resolveAndValidatePath(requestedPath: string): string {
  return this.validatePath(requestedPath);
}
```

No cambiar la política de seguridad actual; solo reutilizarla.

### 1.4 Registrar el protocolo durante inicialización

**Archivo**: `src/main/lifecycle/initialization.ts`

Este punto queda **cerrado y obligatorio**: registrar el protocolo dentro de `initializeServices()`.

Implementación exacta:

1. Importar `registerPdfProtocol` al inicio de `initialization.ts`.
2. Invocarlo al final de `initializeServices()` (después de inicializar/migrar servicios).
3. No registrarlo en `registerIPCHandlers()`.

Snippet objetivo:

```ts
import { registerPdfProtocol } from "../services/filesystem/pdfProtocolService";

export async function initializeServices(): Promise<void> {
  // ... inicialización existente (db, prefs, profile, migraciones)

  registerPdfProtocol();
  logger.core.info("PDF protocol registered successfully");
}
```

Racional de orden: `main.ts` ejecuta `initializeServices()` antes de crear la ventana, por lo que el esquema/protocolo ya está disponible cuando el renderer arranca.

### 1.5 Export opcional desde índice filesystem

**Archivo**: `src/main/services/filesystem/index.ts`

Si el servicio se usa desde fuera de su carpeta, exportarlo aquí:

```ts
export { registerPdfProtocol } from './pdfProtocolService';
```

---

## Paso 2 - Preload/API: helper para URL de visualización

No hace falta IPC `readBinary`.

### 2.1 `src/preload/api/filesystem.ts`

Añadir helper puro:

```ts
getPdfUrl: (path: string) => `levante-fs://pdf?path=${encodeURIComponent(path)}`,
```

### 2.2 `src/preload/preload.ts`

Extender `LevanteAPI.fs`:

```ts
getPdfUrl: (path: string) => string;
```

---

## Paso 3 - Store: tabs PDF sin payload binario

### 3.1 `src/renderer/stores/sidePanelStore.ts`

Mantener `PdfTab` ligero (sin `pdfData`/`isLoading`/`error` persistentes):

```ts
export interface PdfTab {
  type: 'pdf';
  id: string;
  filePath: string;
  fileName: string;
  currentPage: number;
  totalPages: number;
}
```

Añadir acciones:

```ts
openPdfTab: (filePath: string) => void;
setPdfPage: (tabId: string, page: number) => void;
setPdfTotalPages: (tabId: string, totalPages: number) => void;
```

Modificar `openFileTab` para derivar `.pdf`:

```ts
openFileTab: async (filePath) => {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') {
    get().openPdfTab(filePath);
    return;
  }
  // flujo actual para archivos de texto/binarios
}
```

Implementar `openPdfTab`:

- Si la tab existe, activarla.
- Si no existe, crear tab con `currentPage: 1` y `totalPages: 0`.
- Abrir panel y activar tab.

No realizar lecturas de archivo en esta acción.

---

## Paso 4 - Renderer: PdfViewer con URL y lifecycle robusto

### 4.1 Crear `src/renderer/components/file-browser/PdfViewer.tsx`

Implementación base:

- `pdfjs-dist` directo (`import * as pdfjs from 'pdfjs-dist'`).
- Worker: `pdf.worker.min.mjs?url`.
- Cargar con `pdfjs.getDocument({ url: window.levante.fs.getPdfUrl(tab.filePath) })`.
- Estado local del componente:
  - `isLoading`, `error`, `isRendering`, `scale`, `pdfDoc`.
- Actualizar store:
  - `setPdfTotalPages(tab.id, doc.numPages)` al cargar.
  - `setPdfPage` en navegación.
- Cleanup obligatorio:
  - cancelar `loadingTask`.
  - cancelar `renderTask` anterior.
  - `pdfDoc.destroy()` al desmontar/cambiar documento.
- Re-render en resize:
  - usar `ResizeObserver` sobre el contenedor para recalcular fit-to-width.

### 4.2 `src/renderer/components/file-browser/index.ts`

Añadir export:

```ts
export { PdfViewer } from './PdfViewer';
```

---

## Paso 5 - Integración de panel

### 5.1 `src/renderer/components/chat/panel/PanelContent.tsx`

Añadir ruta de render:

```tsx
) : tab.type === 'file' ? (
  <FileContentRenderer tab={tab} />
) : tab.type === 'pdf' ? (
  <PdfViewer tab={tab} />
) : (
```

### 5.2 `src/renderer/components/chat/panel/PanelControls.tsx`

Añadir botón de copiar path también para `pdf` (igual que `file`).

### 5.3 `src/renderer/components/chat/panel/PanelContextBar.tsx`

Ya soporta `pdf` con `Page X / Y`; solo validar que se actualiza al cargar documento.

---

## Paso 6 - Dependencias y build

### 6.1 `package.json`

Añadir `pdfjs-dist` como dependencia directa (no transitive):

```json
"pdfjs-dist": "^5.4.296"
```

### 6.2 `vite.renderer.config.ts` (condicional)

Solo si falla prebundle/worker en dev:

```ts
optimizeDeps: {
  include: ['pdfjs-dist'],
},
```

---

## Paso 7 - CSP

**Archivo**: `src/renderer/index.html`

Añadir `levante-fs:` a `connect-src` para permitir fetch del PDF por `pdf.js`:

```html
connect-src 'self' levante-fs: ...
```

No relajar otras directivas.

---

## Resumen de archivos

| Archivo | Acción |
|---|---|
| `src/main/main.ts` | **Modificar**: registrar esquema `levante-fs` como privilegiado |
| `src/main/services/filesystem/pdfProtocolService.ts` | **Crear**: handler de protocolo con validación + range streaming |
| `src/main/services/filesystem/fileSystemService.ts` | **Modificar**: exponer `resolveAndValidatePath()` |
| `src/main/services/filesystem/index.ts` | **Modificar** (opcional): export del registro de protocolo |
| `src/main/lifecycle/initialization.ts` | **Modificar**: registrar protocolo en arranque |
| `src/preload/api/filesystem.ts` | **Modificar**: añadir `getPdfUrl(path)` |
| `src/preload/preload.ts` | **Modificar**: tipar `getPdfUrl` en `LevanteAPI.fs` |
| `src/renderer/stores/sidePanelStore.ts` | **Modificar**: `openPdfTab`, `setPdfPage`, `setPdfTotalPages`, derivación desde `openFileTab` |
| `src/renderer/components/file-browser/PdfViewer.tsx` | **Crear**: viewer con `pdfjs-dist` por URL local |
| `src/renderer/components/file-browser/index.ts` | **Modificar**: export `PdfViewer` |
| `src/renderer/components/chat/panel/PanelContent.tsx` | **Modificar**: render route para `pdf` |
| `src/renderer/components/chat/panel/PanelControls.tsx` | **Modificar**: copiar path para tabs `pdf` |
| `src/renderer/index.html` | **Modificar**: agregar `levante-fs:` en `connect-src` |
| `package.json` | **Modificar**: declarar `pdfjs-dist` directo |
| `vite.renderer.config.ts` | **Modificar condicional**: `optimizeDeps.include` |

**Archivos nuevos**: 2  
**Archivos modificados**: 13 (14 si aplicas cambio condicional de Vite)

---

## Verificación

1. `pnpm install` (si se añadió `pdfjs-dist` directo)
2. `pnpm typecheck`
3. Verificación manual:
   - Abrir app con CWD configurado.
   - Clic en `.pdf` desde file browser -> abre tab PDF.
   - Render de primera página correcto.
   - Navegación prev/next y salto por input.
   - Zoom +/- funcional.
   - `PanelContextBar` muestra `Page X / Y`.
   - Reabrir PDF existente reactiva tab.
   - Cerrar tab no deja listeners/tareas colgadas.
   - Resize del panel recalcula escala sin glitches.
   - PDF grande abre sin picos severos por base64 en store.
   - Path fuera de CWD (`levante-fs://pdf?...`) responde `403`.
   - Solicitudes con `Range` responden `206` y `Content-Range` válido.

---

## Criterios de aceptación

- No existe `readBinary` de PDF por IPC para viewer.
- `PdfTab` no contiene bytes (`base64`/`ArrayBuffer`).
- `pdf.js` carga mediante URL `levante-fs://pdf?...`.
- Seguridad de acceso restringida al CWD validado por backend.
- Funcionalidad de navegación/zoom estable en panel redimensionable.
