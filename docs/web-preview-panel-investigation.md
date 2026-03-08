# Web Preview Side Panel - Investigacion Profunda

## Overview

El sistema de web preview side panel detecta automaticamente servidores HTTP corriendo en background tasks y los muestra en un panel lateral redimensionable. Permite ver previews en vivo de aplicaciones web mientras se trabaja en la interfaz de chat.

---

## 1. Archivos Involucrados

### Renderer (Frontend)

| Archivo | Responsabilidad |
|---------|----------------|
| `src/renderer/stores/webPreviewStore.ts` | Store Zustand con estado y acciones |
| `src/renderer/hooks/useWebPreview.ts` | Hook que suscribe a eventos de deteccion de puertos |
| `src/renderer/components/chat/WebPreviewPanel.tsx` | Panel principal con iframe, tabs y resize |
| `src/renderer/components/chat/WebPreviewButton.tsx` | Boton en toolbar para abrir/cerrar panel |
| `src/renderer/components/chat/WebPreviewToast.tsx` | Notificacion toast cuando se detecta un servidor |
| `src/renderer/components/ai-elements/web-preview.tsx` | Componentes UI reutilizables para preview |
| `src/renderer/pages/ChatPage.tsx` | Pagina que integra todos los componentes |

### Preload (Bridge IPC)

| Archivo | Responsabilidad |
|---------|----------------|
| `src/preload/api/tasks.ts` | API de tasks expuesta al renderer, incluye `onPortDetected` |
| `src/preload/preload.ts` | Archivo principal que expone `window.levante` |

### Main Process (Backend)

| Archivo | Responsabilidad |
|---------|----------------|
| `src/main/ipc/taskHandlers.ts` | Handlers IPC que reenvian eventos de deteccion de puertos |
| `src/main/services/tasks/BackgroundTaskManager.ts` | Manager con logica de deteccion de puertos via regex |
| `src/main/services/tasks/types.ts` | Tipos TypeScript para tasks |
| `src/main/services/tasks/index.ts` | Exports y singleton |

---

## 2. Como se Abre y Cierra el Panel

### Apertura

1. **Accion del usuario**: Click en el icono de monitor en el toolbar (`WebPreviewButton`)
2. **Update de estado**: Se llama `useWebPreviewStore.openPanel(taskId?)`
3. **Accion del store**:
   ```typescript
   openPanel: (taskId) => {
     set((state) => ({
       isPanelOpen: true,
       activeTaskId: taskId ?? state.activeTaskId ?? state.servers[0]?.taskId ?? null,
       pendingToast: null,  // Limpia toast al abrir
     }));
   }
   ```
4. **Auto-cierre del sidebar**: Cuando el panel se abre, se cierra automaticamente el sidebar via `useSidebar().setOpen(false)`

### Cierre

1. **Accion del usuario**: Click en el boton X del header del panel
2. **Update del store**: Se llama `useWebPreviewStore.closePanel()`
3. **Update de estado**: `isPanelOpen` se setea a `false`
4. **Render**: El componente retorna `null` (oculto)

### Deteccion de Servidor y Toast

1. Se detecta un puerto en el output de un task
2. Se agrega un `DetectedServer` al store via `addServer()`
3. Si el panel esta **cerrado**, se setea `pendingToast`
4. Aparece un toast en la esquina inferior derecha con auto-dismiss de 6 segundos
5. El usuario puede hacer click en "Ver preview" para abrir el panel o descartar el toast

---

## 3. Como se Renderiza el Contenido Web

### Implementacion: iframe con sandbox

```typescript
// En WebPreviewPanel.tsx
<iframe
  key={iframeKey}
  src={activeServer.url}
  title={`Preview :${activeServer.port}`}
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-top-navigation-by-user-activation"
  allow="fullscreen; clipboard-read; clipboard-write"
  className="absolute inset-0 w-full h-full border-0"
/>
```

### Atributos de Sandbox

| Atributo | Proposito |
|----------|----------|
| `allow-scripts` | Permite ejecucion de JavaScript en el iframe |
| `allow-same-origin` | Permite requests same-origin (localhost) |
| `allow-forms` | Permite envio de formularios |
| `allow-popups` | Permite `window.open()` y popups |
| `allow-modals` | Permite dialogos modales |
| `allow-top-navigation-by-user-activation` | Permite navegacion solo con interaccion del usuario |

### Atributos Allow

| Atributo | Proposito |
|----------|----------|
| `fullscreen` | Permite API de pantalla completa |
| `clipboard-read` | Permite lectura del clipboard |
| `clipboard-write` | Permite escritura al clipboard |

### Mecanismo de Recarga

El iframe se recarga via **cambio de key**:
```typescript
const [iframeKey, setIframeKey] = useState(0);

const handleReload = () => {
  setIframeKey((k) => k + 1);  // Forza remount del iframe en React
};
```

Esto remonta el componente completamente, forzando una carga fresca sin APIs explicitas del iframe.

---

## 4. Flujo de Datos y State Management

### Diagrama de Arquitectura

```
+-------------------------------------------------------------------+
|                      MAIN PROCESS                                  |
|  BackgroundTaskManager                                             |
|  - Spawns child processes                                          |
|  - Captura stdout/stderr                                           |
|  - Detecta puertos via regex patterns                              |
|  - Emite eventos 'task:port-detected'                              |
+----------------------------+--------------------------------------+
                             |
                             | taskManager.emit('task:port-detected',
                             |   taskId, port, info)
                             v
+-------------------------------------------------------------------+
|                   IPC HANDLERS (Main Process)                      |
|  taskHandlers.ts                                                   |
|  - Escucha evento 'task:port-detected'                             |
|  - Reenvia via mainWindow.webContents.send()                       |
+----------------------------+--------------------------------------+
                             |
                             | mainWindow.webContents.send(
                             |   'levante/tasks:portDetected', {...})
                             v
+-------------------------------------------------------------------+
|            PRELOAD BRIDGE (Context Bridge)                         |
|  preload/api/tasks.ts                                              |
|  - Expone onPortDetected() event listener                          |
|  - window.levante.tasks.onPortDetected(callback)                   |
+----------------------------+--------------------------------------+
                             |
                             | ipcRenderer.on(
                             |   'levante/tasks:portDetected', handler)
                             v
+-------------------------------------------------------------------+
|               RENDERER PROCESS (UI)                                |
|                                                                    |
|  useWebPreview Hook                                                |
|  +-- Suscribe a eventos onPortDetected                             |
|  +-- Llama addServer() cuando detecta puerto                      |
|  +-- Reconcilia tasks corriendo cada 3 segundos                   |
|                                                                    |
|  useWebPreviewStore (Zustand)                                      |
|  +-- servers: DetectedServer[]                                     |
|  +-- isPanelOpen: boolean                                          |
|  +-- activeTaskId: string | null                                   |
|  +-- pendingToast: DetectedServer | null                           |
|  +-- Actions: addServer, removeServer, openPanel, etc.             |
|                                                                    |
|  Componentes:                                                      |
|  +-- WebPreviewPanel - Panel principal con iframe                  |
|  +-- WebPreviewButton - Boton del toolbar                          |
|  +-- WebPreviewToast - Notificacion toast                          |
+-------------------------------------------------------------------+
```

### Flujo de Estado Completo

```
Task Iniciado (ej: npm run dev)
    |
    v
Output del Task contiene puerto (ej: "Local: http://localhost:5173")
    |
    v
BackgroundTaskManager.addOutputLine() detecta puerto via regex
    |
    v
taskManager.emit('task:port-detected', taskId, port, info)
    |
    v
IPC Handler reenvia al renderer
    |
    v
window.levante.tasks.onPortDetected() callback se activa
    |
    v
useWebPreview() hook llama addServer({taskId, port, url, ...})
    |
    v
webPreviewStore.addServer() actualiza estado
    +-- Si panel cerrado: pendingToast se setea -> Toast aparece
    +-- Si no hay active task: setea activeTaskId
    |
    v
React re-renderiza WebPreviewPanel y WebPreviewButton
    |
    v
Panel muestra iframe con preview en vivo
```

---

## 5. Canales IPC

### 1. Main -> Renderer (Evento): `levante/tasks:portDetected`

- **Disparado por**: `BackgroundTaskManager.emit('task:port-detected', ...)`
- **Handler**: Forwarder IPC en `taskHandlers.ts`
- **Estructura de datos**:
  ```typescript
  {
    taskId: string;
    port: number;
    command: string;
    description?: string;
  }
  ```

### 2. Renderer -> Main (IPC Handler): `levante/tasks:list`

- **Proposito**: Obtener lista de tasks corriendo
- **Usado por**: Hook `useWebPreview` para reconciliacion
- **Retorna**: Array de `TaskInfoDTO`

### 3. Preload API: `window.levante.tasks.onPortDetected(callback)`

- **Tipo**: Registro de event listener
- **Retorna**: Funcion para desuscribirse
- **Uso**:
  ```typescript
  const unsubscribe = window.levante.tasks.onPortDetected((data) => {
    addServer({...data, url: `http://localhost:${data.port}`});
  });
  ```

---

## 6. Jerarquia de Componentes

```
ChatPage (src/renderer/pages/ChatPage.tsx)
+-- useWebPreview() hook
+-- WebPreviewToast
|   +-- Muestra notificacion cuando se detecta servidor con panel cerrado
+-- WebPreviewButton (en ToolsMenu, integrado en ChatPromptInput)
|   +-- Boton toggle con badge de conteo de servidores
+-- WebPreviewPanel
    +-- Header con componentes ServerTab
    |   +-- Tabs para cada servidor detectado con indicador de estado
    +-- URL bar mostrando URL del servidor activo
    +-- iframe para renderizar contenido web
        +-- Preview del servidor en http://localhost:{port}
```

### WebPreviewPanel.tsx - Detalle

- **Props**: Ninguna (lee del store Zustand)
- **Estado local**:
  - `width`: Ancho del panel (default 960px, min 320px)
  - `iframeKey`: Fuerza recarga del iframe al incrementar
  - `isDragging`: Rastrea drag del handle de resize
- **Constantes**:
  - `MIN_PANEL_WIDTH = 320px`
  - `MIN_CHAT_WIDTH = 300px`
  - `DEFAULT_PANEL_WIDTH = 960px`
- **Features**:
  - Panel lateral redimensionable con handle de drag en borde izquierdo
  - Tabs de servidores con indicadores de estado (punto verde/rojo)
  - Boton de recarga (deshabilitado si servidor offline)
  - Boton abrir en navegador externo
  - Boton cerrar panel
  - Manejo de servidores muertos/offline

### WebPreviewButton.tsx - Detalle

- **Props**: `className?: string`
- **Features**:
  - Muestra/oculta panel al hacer click
  - Badge con conteo de servidores vivos
  - Indicador verde pulsante cuando hay servidores disponibles pero panel cerrado
  - Cambia color segun estado del panel

### WebPreviewToast.tsx - Detalle

- **Props**: Ninguna (lee del store)
- **Features**:
  - Aparece en esquina inferior derecha
  - Auto-dismiss despues de 6 segundos
  - Muestra puerto detectado con formato de codigo
  - Boton "Ver preview" para abrir panel
  - Boton dismiss manual

### web-preview.tsx - Componentes Reutilizables

| Componente | Proposito |
|-----------|----------|
| `WebPreview` | Container con context provider |
| `WebPreviewNavigation` | Area header para controles |
| `WebPreviewNavigationButton` | Botones individuales de control |
| `WebPreviewUrl` | Campo de input de URL |
| `WebPreviewBody` | Wrapper del iframe |
| `WebPreviewConsole` | Display colapsable de output de consola |

---

## 7. Mecanismo de Deteccion de Puertos

### Patrones Regex (BackgroundTaskManager.ts)

Ordenados por especificidad:

```typescript
const PORT_DETECTION_PATTERNS: RegExp[] = [
  // URL completa: http://localhost:3000 o http://127.0.0.1:8080
  /https?:\/\/(?:localhost|127\.0\.0\.1):(\d{2,5})/i,

  // Vite con flecha: ->  Local:   http://localhost:5173/
  /➜\s+Local:\s+https?:\/\/[^:]+:(\d{2,5})/i,

  // Vite/Webpack: Local: http://localhost:5173/
  /\bLocal:\s+https?:\/\/[^:]+:(\d{2,5})/i,

  // Next.js: started server on 0.0.0.0:3000
  /started server on [^:]+:(\d{2,5})/i,

  // Express/Generic: Listening on port 3000
  /(?:listening on|running on)\s+(?:port\s+)?(\d{2,5})/i,

  // Flask/Werkzeug: * Running on http://127.0.0.1:5000
  /\*\s+Running on\s+https?:\/\/[^:]+:(\d{2,5})/i,

  // Generic: "port 3000" (evita "port 3000 is in use")
  /\bport[:\s]+(\d{2,5})\b(?!\s+is\s+in\s+use)/i,
];
```

### Patrones de Ignorar

```typescript
const NON_ACTIVE_PORT_PATTERNS: RegExp[] = [
  /\b(?:port|address)\s+\d{2,5}\s+is\s+in\s+use\b/i,
  /\beaddrinuse\b/i,
  /\btrying another one\b/i,
];
```

### Proceso de Extraccion

```typescript
function extractPortFromLine(line: string): number | null {
  // 1. Verificar si la linea menciona conflictos de puerto (ignorar)
  for (const pattern of NON_ACTIVE_PORT_PATTERNS) {
    if (pattern.test(line)) return null;
  }

  // 2. Probar cada patron de deteccion
  for (const pattern of PORT_DETECTION_PATTERNS) {
    const match = line.match(pattern);
    if (match?.[1]) {
      const port = parseInt(match[1], 10);
      // 3. Validar rango de puerto (1024-65535)
      if (port >= 1024 && port <= 65535) {
        return port;
      }
    }
  }
  return null;
}
```

### Cuando se Detecta un Puerto

```typescript
private addOutputLine(entry: TaskEntry, line: TaskOutputLine): void {
  // ... logica de almacenamiento de output ...

  // Deteccion de puerto: solo una vez por task
  if (entry.info.detectedPort === null && line.text.trim()) {
    const port = extractPortFromLine(line.text);
    if (port !== null) {
      entry.info.detectedPort = port;
      // Emitir evento al IPC
      this.emit('task:port-detected', entry.info.id, port, { ...entry.info });
    }
  }
}
```

---

## 8. Zustand Store - Estado Completo

```typescript
interface DetectedServer {
  taskId: string;              // UUID del background task
  port: number;                // Puerto HTTP (1024-65535)
  url: string;                 // "http://localhost:{port}"
  command: string;             // Comando del task (ej: "npm run dev")
  description?: string;        // Descripcion opcional del task
  detectedAt: number;          // Timestamp de deteccion
  isAlive: boolean;            // true mientras el task corre
}

interface WebPreviewState {
  servers: DetectedServer[];           // Todos los servidores detectados
  isPanelOpen: boolean;                 // Visibilidad del panel
  activeTaskId: string | null;          // Servidor actualmente mostrado
  pendingToast: DetectedServer | null;  // Notificacion toast

  // Acciones
  addServer(server): void;       // Agrega servidor (deduplica por taskId)
  markServerDead(taskId): void;  // Marca como muerto (isAlive = false)
  removeServer(taskId): void;    // Remueve del array
  openPanel(taskId?): void;      // Abre panel y selecciona servidor
  closePanel(): void;            // Cierra panel
  setActiveServer(taskId): void; // Cambia servidor mostrado
  clearToast(): void;            // Limpia toast pendiente
}
```

---

## 9. Hook useWebPreview - Detalle

```typescript
export function useWebPreview() {
  // 1. Suscripcion a eventos de deteccion de puertos
  useEffect(() => {
    const unsubscribe = window.levante.tasks.onPortDetected((data) => {
      addServer({
        taskId: data.taskId,
        port: data.port,
        url: `http://localhost:${data.port}`,
        command: data.command,
        description: data.description,
        detectedAt: Date.now(),
        isAlive: true,
      });
    });
    return unsubscribe;
  }, [addServer]);

  // 2. Reconciliacion de servidores con tasks corriendo cada 3 segundos
  useEffect(() => {
    const reconcileServers = async () => {
      const result = await window.levante.tasks.list({ status: 'running' });
      const runningTaskIds = new Set(result.data?.map(t => t.id) ?? []);

      // Remover servidores cuyo task ya no esta corriendo
      for (const server of servers) {
        if (!runningTaskIds.has(server.taskId)) {
          removeServer(server.taskId);
        }
      }
    };

    void reconcileServers();
    const intervalId = setInterval(() => void reconcileServers(), 3000);
    return () => clearInterval(intervalId);
  }, [removeServer]);
}
```

**Proposito**:
- Suscribe a eventos de deteccion de servidores del main process
- Mantiene el store sincronizado con los tasks realmente corriendo
- Auto-remueve servidores muertos de la lista

---

## 10. Integracion en ChatPage

```typescript
// Imports
import { WebPreviewPanel } from '@/components/chat/WebPreviewPanel';
import { WebPreviewToast } from '@/components/chat/WebPreviewToast';
import { useWebPreview } from '@/hooks/useWebPreview';

// Inicializar hook (suscribe a eventos y reconciliacion)
useWebPreview();

// Render
return (
  <>
    <WebPreviewToast />
    <div className="flex flex-row h-full relative">
      <div className="flex flex-col flex-1 relative">
        {/* Contenido del chat */}
      </div>
      {/* Panel lateral */}
      <WebPreviewPanel />
    </div>
  </>
);
```

El `WebPreviewButton` se integra via `ToolsMenu` en `ChatPromptInput`.

---

## 11. Seguridad

### Sandboxing del iframe

El iframe usa sandboxing comprensivo para prevenir XSS y otros problemas:

- Scripts confinados al origin (localhost)
- Same-origin policy previene requests cross-site
- Sin acceso a la ventana padre o DOM de la app principal
- Navegacion top-level solo via interaccion del usuario

### Sin Acceso IPC Directo

El iframe **no puede** acceder a `window.levante` ni a ningun IPC de Electron. Es un contexto web completamente aislado que solo puede:
- Cargar recursos desde localhost
- Ejecutar scripts dentro de restricciones de sandbox
- Comunicarse solo a traves de APIs web estandar

### CSP

El CSP configurado en `src/renderer/index.html` proporciona defense-in-depth adicional.

---

## 12. Ciclo de Vida del Servidor

```
Deteccion
    |
    v
Running (isAlive = true)
    +-- Mostrado en panel con indicador verde
    +-- Se puede interactuar (reload, abrir en browser)
    |
    v
Proceso Termina
    |
    v
Reconciliacion (cada 3 segundos)
    +-- Tasks no en lista de running son detectados
    +-- isAlive se setea a false
    |
    v
Dead (isAlive = false)
    +-- Mostrado con indicador rojo y badge "stopped"
    +-- No se puede recargar
    +-- Muestra mensaje "Server stopped" en area del iframe
    |
    v
Removido del Store (manual o automatico)
    |
    v
Cleanup
    +-- Servidor removido del array servers
    +-- Si no quedan servidores, panel se cierra automaticamente
    +-- Si era el activo, cambia a otro servidor vivo o null
```

---

## 13. Resumen

El sistema de web preview side panel es una solucion completa que:

1. **Detecta servidores** automaticamente via pattern matching regex en el output de tasks
2. **Notifica al usuario** via toast cuando aparecen servidores
3. **Muestra previews** en iframes aislados con sandbox
4. **Soporta multiples servidores** con interfaz de tabs
5. **Permite redimensionar** el panel manteniendo anchos minimos
6. **Se mantiene sincronizado** via reconciliacion periodica con tasks corriendo
7. **Maneja ciclo de vida** del servidor (running -> stopped)
8. **Provee controles** para recarga, navegador externo y cierre
9. **Mantiene seguridad** a traves de iframe sandboxing y sin acceso IPC
10. **Se integra** en la UI del chat como panel lateral colapsable
