# Pruebas de Corrección de TitleBar - Desfase Hit-Test en Windows

## Problema Original
- **Síntoma**: Desfase de hit-test al maximizar la ventana en Windows
- **Entorno**: Windows con DPI 150% (1.5x scaling)
- **Descripción**: Los clics no coinciden con lo que se dibuja en pantalla, especialmente al maximizar la ventana

---

## Cambios Previos Aplicados (Base)

### ✅ 1. Eliminación de `h-screen` y esquinas redondeadas en Windows
- **Archivo**: `src/renderer/components/layout/MainLayout.tsx:139-142`
- **Cambio**: `h-screen` → `h-full min-h-0`
- **Cambio**: Eliminadas esquinas redondeadas (`rounded-l-2xl`) en Windows
- **Razón**: Prevenir desfase por `100vh` vs altura real

### ✅ 2. Eliminación de región drag del SidebarHeader
- **Archivo**: `src/renderer/components/layout/MainLayout.tsx:44-45`
- **Cambio**: Removido `WebkitAppRegion: 'drag'` del SidebarHeader
- **Razón**: Evitar conflictos de múltiples capas drag

### ✅ 3. Zoom lock para DPI fraccional
- **Archivo**: `src/main/lifecycle/window.ts:109-114`
- **Cambio**: Agregado `setVisualZoomLevelLimits(1, 1)` y `setZoomFactor(1)`
- **Razón**: Mitigar desajustes con DPI fraccional (125%, 150%)

### ✅ 4. useContentSize activado
- **Archivo**: `src/main/lifecycle/window.ts:34`
- **Cambio**: Agregado `useContentSize: true`
- **Razón**: Reducir redondeos al maximizar

### ✅ 5. CSS global para full height
- **Archivo**: `src/renderer/globals.css:183-189`
- **Cambio**: `html, body, #root { height: 100%; }`
- **Razón**: Evitar problemas con viewport units

---

## Tests de Diagnóstico

### 🔍 Test A: Barra Nativa en Windows
**Fecha**: 2025-11-06
**Estado**: ❌ Fallido

**Cambios aplicados**:
```typescript
// src/main/lifecycle/window.ts
const isWin = process.platform === 'win32';
titleBarStyle: isWin ? 'default' : 'hidden',
titleBarOverlay: isWin ? {} : { color: '#ffffff', symbolColor: '#000000', height: 48 }
```

**Objetivo**: Determinar si el `titleBarOverlay` es la causa del desfase

**Resultado**:
- [X] ❌ Desfase persiste → Continuar con Test B

**Notas**: El uso de barra nativa en Windows no resuelve el problema. El desfase continúa al maximizar la ventana.


---

### 🔍 Test B: TitleBar con Position Fixed
**Fecha**: 2025-11-06
**Estado**: ❌ Fallido

**Cambios aplicados**:
```tsx
// TitleBar.tsx
className="fixed top-0 left-0 right-0 z-50 flex items-center h-12 px-2"

// MainLayout.tsx - spacer agregado
<div className="h-12 shrink-0" /> {/* debajo del TitleBar */}
```

**Objetivo**: Determinar si el `transform` del Sidebar causa el desfase

**Resultado**:
- [X] ❌ Desfase persiste → Continuar con Test C

**Notas**: Position fixed no resuelve el problema. El desfase continúa al maximizar. El transform del Sidebar no es la causa principal.


---

### 🔍 Test C: Quitar Thick Frame en Windows
**Fecha**: 2025-11-06
**Estado**: ✅ Exitoso

**Cambios aplicados**:
```typescript
// src/main/lifecycle/window.ts
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

frame: !isWin,              // Frameless solo en Windows
thickFrame: false,          // Sin thick frame
titleBarStyle: 'hidden',    // Sin barra de título
titleBarOverlay: undefined  // Sin overlay
```

**Objetivo**: Determinar si el "thick frame" de Windows causa el desfase

**Resultado**:
- [X] ✅ Desfase desaparece → El thick frame era la causa

**Notas**: ¡ÉXITO! El desfase desaparece al maximizar manualmente. El problema era causado por el thick frame de Windows combinado con titleBarOverlay. Solución: ventana frameless en Windows con controles personalizados.


---

## Configuraciones Finales Propuestas

### Opción A: Barra Nativa en Windows (Simple)
**Pros**: Cero bugs de hit-test, estable
**Contras**: No hay barra 100% custom en Windows

```typescript
titleBarStyle: process.platform === 'win32' ? 'default' : 'hidden',
titleBarOverlay: process.platform === 'win32' ? undefined : { height:48, color:'#fff', symbolColor:'#000' }
```

### Opción B: Frameless Real (Custom Completo)
**Pros**: Barra 100% custom en todas las plataformas
**Contras**: Requiere manejar botones min/max/close vía IPC

```typescript
frame: process.platform === 'win32' ? false : true,
thickFrame: false,
titleBarStyle: 'hidden',
titleBarOverlay: undefined
```

---

## Solución Final Seleccionada
**Fecha**: 2025-11-06

**Configuración elegida**: Frameless Window con Controles Personalizados (Opción B)

**Justificación**:
El Test C demostró que el problema era causado por el thick frame de Windows combinado con titleBarOverlay. La única solución efectiva es usar una ventana completamente frameless en Windows.

**Cambios finales aplicados**:

### 1. Configuración de Ventana Frameless (window.ts)
```typescript
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

frame: isMac,                                    // Solo macOS mantiene frame (para traffic lights)
...((isWin || isLinux) ? { thickFrame: false } : {}),  // Sin thick frame en Win/Linux
titleBarStyle: 'hidden',                         // Sin barra de título
titleBarOverlay: undefined                       // Sin overlay (causa hit-test issues)

// Referencia: https://github.com/electron/electron/issues/7347
```

**Plataformas afectadas**: Windows, Linux (incluyendo WSL)
**Plataforma sin cambios**: macOS (mantiene frame nativo con traffic lights)

### 2. Handlers IPC para Controles de Ventana
- **Archivo creado**: `src/main/ipc/windowHandlers.ts`
- **Handlers**: minimize, maximize/restore, close, isMaximized
- **Eventos**: maximize, unmaximize notificados al renderer

### 3. API de Ventana en Preload
- **Archivo creado**: `src/preload/api/window.ts`
- **Métodos expuestos**: window.minimize(), window.maximize(), window.close()
- **Listeners**: onMaximizeChanged() para actualizar UI

### 4. Componente WindowControls
- **Archivo creado**: `src/renderer/components/layout/WindowControls.tsx`
- **Características**:
  - Botones personalizados: minimize, maximize/restore, close
  - Icono dinámico según estado maximizado
  - Estilos hover: accent para min/max, destructive para close
  - Visible en Windows y Linux (no en macOS, que usa traffic lights)

### 5. Integración en TitleBar
- **Modificado**: `src/renderer/components/layout/TitleBar.tsx`
- WindowControls integrado en el lado derecho
- Región no-draggable para permitir interacción

### 6. Registro de Handlers
- **Modificado**: `src/main/lifecycle/initialization.ts`
- **Modificado**: `src/main/main.ts`
- registerWindowControlHandlers() llamado después de createMainWindow()

---

## Notas Adicionales

### Factores que contribuyen al problema:
1. `titleBarOverlay` + ventana maximizada + DPI fraccional
2. Transform CSS en contenedores con regiones drag
3. **Thick frame de Windows con custom title bar + DPI scaling** (causa raíz principal)
4. Uso de viewport units (vh) con overlay

### Root Cause: Electron Issue #7347
El problema de desfase es un **bug conocido de Electron** con ventanas frameless en Windows/Linux cuando el DPI no está al 100%:

**Issue**: [electron/electron#7347](https://github.com/electron/electron/issues/7347)
- **Título**: "Hit testing is wrong for drag areas in frameless window (Windows)"
- **Causa**: Coordenadas del mouse incorrectas cuando display scaling ≠ 100% (ej. 150%)
- **Síntoma**: Las coordenadas del mouse se reportan multiplicadas por el factor de escala, causando desfase en hit-test
- **Ejemplo**: Con DPI 150%, el mouse en (100, 100) se reporta como (150, 150)
- **Fix**: Electron lo arregló en versión 1.4.2+ para `frame: false`, pero persiste con `titleBarOverlay` + thick frame

**Solución aplicada**:
- ✅ Usar `frame: false` en Windows/Linux (sin thick frame)
- ✅ Evitar `titleBarOverlay` (causa conflictos con DPI)
- ✅ Controles de ventana personalizados vía IPC

### Referencias:
- Electron TitleBar Overlay: https://www.electronjs.org/docs/latest/api/browser-window#new-browserwindowoptions
- Electron Issue #7347 (DPI hit-test bug): https://github.com/electron/electron/issues/7347
- Electron PR #7362 (fix original): https://github.com/electron/electron/pull/7362
