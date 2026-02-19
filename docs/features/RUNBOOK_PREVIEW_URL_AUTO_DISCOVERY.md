# Runbook: Auto-discovery de URLs para Preview Window

## 0) Proposito

Este runbook define, de forma ejecutable, como implementar deteccion automatica de una o multiples URLs locales para Preview Window.

Objetivo:
- Si hay un solo servicio, abrirlo rapido.
- Si hay varios, listarlos y permitir seleccion explicita.

Este documento corrige y sustituye versiones previas del plan.

---

## 1) Contexto y dependencia obligatoria

Prerequisito:
- El runbook base de preview debe estar aplicado: `docs/features/preview-window.md`.

Arquitectura real que se debe respetar:
- Main process preview: `src/main/preview/*`
- Preload principal (main window): `src/preload/preload.ts` + `src/preload/preview/api.ts`
- Preload dedicado de la barra de preview: `src/preload/preview/navPreload.ts`
- Renderer de barra preview: `src/renderer/preview/*`
- Tipos de preview: `src/types/preview/*`

Regla critica:
- La UI de `preview/nav.html` usa `window.levantePreviewNav`, no `window.levante`.
- Por lo tanto, discovery para la barra debe exponerse en `navPreload`.

Decisiones cerradas para v1:
- Discovery por polling en renderer (`PreviewNavBar`) cada 10-15s.
- No implementar pipeline push de discovery en v1.
- No implementar i18n de `preview/nav` en v1 (textos fijos); i18n queda para v2.

---

## 2) Objetivo funcional v1

Al abrir Preview Window:
1. La app detecta URLs candidatas de servicios web locales.
2. Si detecta servicios online, calcula recomendacion.
3. La barra muestra lista de servicios detectados.
4. El usuario puede refrescar manualmente.
5. Se refresca automaticamente por polling mientras la ventana siga abierta.

No objetivo v1:
- Descubrir servicios publicos remotos.
- Escanear rangos masivos de puertos.
- Ejecutar comandos shell para inferir procesos.

---

## 3) Requisitos no funcionales

- Seguridad:
  - No ejecutar shell.
  - Probes solo HTTP/HTTPS locales esperados.
  - No seguir redirects a dominios externos (usar `redirect: 'manual'` en probe).
  - Cualquier URL final se valida con la allowlist existente al cargar (`loadPreviewUrl`).
- Rendimiento:
  - Timeout por intento: 400-700ms.
  - Concurrencia limitada (max 4-6 probes paralelos).
  - Presupuesto total de discovery: 1800ms; al agotarse se devuelve resultado parcial.
- UX:
  - Lista clara y ordenada.
  - Estado vacio accionable.
  - Error no bloqueante si discovery falla.

---

## 4) Diseno tecnico

## 4.1 Estrategia de deteccion

1. Generar puertos candidatos usando `coworkModeCwd`:
- `.env`, `.env.local`, `.env.development` (`PORT=...`).
- `package.json` scripts (`--port`, `-p`, `PORT=...`, patrones explicitos).
- fallback de puertos comunes.

2. Probar salud HTTP por candidato:
- Base: `http://localhost:<port>`.
- Fallback opcional: `http://127.0.0.1:<port>`.
- `fetch` con timeout corto + `AbortController`.
- `redirect: 'manual'`.
- Online si responde status HTTP.

3. Fingerprint liviano:
- `<title>` (si aplica),
- `x-powered-by`,
- heuristica framework.

4. Dedupe y orden:
- No deduplicar por URL literal.
- Deduplicar por servicio canonico (priorizar `localhost` sobre `127.0.0.1` para el mismo puerto).
- Ordenar por `score` desc, luego `port` asc.

## 4.2 Scoring recomendado

- +50 si viene de `.env`.
- +40 si viene de script explicito.
- +20 si viene de common ports.
- +10 si responde HTML.
- +5 si fingerprint reconocible.

---

## 5) Contratos de tipos

Crear `src/types/preview/discovery.ts`:

```ts
export type DiscoverySource = 'env' | 'package-script' | 'common-port' | 'saved-preference';

export interface DiscoveredPreviewService {
  id: string;
  url: string;
  host: string;
  port: number;
  scope: 'loopback' | 'lan';
  status: 'online' | 'offline';
  source: DiscoverySource[];
  score: number;
  title?: string;
  poweredBy?: string;
  frameworkGuess?: string;
  lastCheckedAt: number;
  responseTimeMs?: number;
}

export interface PreviewDiscoveryResult {
  success: boolean;
  cwd: string | null;
  services: DiscoveredPreviewService[];
  recommendedUrl: string | null;
  error?: string;
  durationMs: number;
}

export interface PreviewDiscoveryOptions {
  forceRefresh?: boolean;
  includeOffline?: boolean;
}
```

Nota:
- `host` no debe limitarse a `'localhost' | '127.0.0.1'` para evitar inconsistencias futuras.

---

## 6) Archivos a crear/modificar

## 6.1 Nuevos

- `src/types/preview/discovery.ts`
- `src/main/preview/urlDiscovery.ts`

## 6.2 Modificados (obligatorio)

- `src/types/preview/index.ts` (exportar tipos discovery)
- `src/main/preview/ipc.ts`
- `src/preload/preview/navPreload.ts`
- `src/renderer/preview/stores/previewStore.ts`
- `src/renderer/preview/pages/PreviewNavBar.tsx`
- `src/renderer/preview/components/NavigationBar.tsx`

## 6.3 Modificados (opcional, si quieres exponer discovery al main window tambien)

- `src/preload/preview/api.ts`
- `src/preload/preload.ts`

## 6.4 i18n en v1

No se modifica i18n en este runbook v1.
La barra de preview usa strings fijos y la localizacion se planifica para v2.

---

## 7) Implementacion por fases

## FASE 0 - Baseline

1. Ejecutar:
```bash
pnpm typecheck
pnpm lint
```

2. Confirmar estado actual:
```bash
rg -n "preview.*discover|discover-urls|urlDiscovery|discovery-updated" src
```

Salida:
- Baseline conocido.

---

## FASE 1 - Tipos de discovery

1. Crear `src/types/preview/discovery.ts`.
2. Exportar desde `src/types/preview/index.ts`.

Verificacion:
```bash
pnpm typecheck
```

---

## FASE 2 - Servicio main de deteccion

Crear `src/main/preview/urlDiscovery.ts`.

API publica:

```ts
export async function discoverPreviewUrls(
  cwd: string | null,
  options?: PreviewDiscoveryOptions
): Promise<PreviewDiscoveryResult>;

export function getCommonPorts(): number[];
```

Interno minimo:
- `readPortsFromEnvFiles(cwd)`
- `readPortsFromPackageScripts(cwd)`
- `mergeCandidatePorts(...)`
- `probeService(...)`
- `dedupeServices(...)`

Reglas de probe:
- timeout por intento 400-700ms.
- `redirect: 'manual'`.
- concurrencia limitada.
- deadline total 1800ms.

Resultado:
- por defecto incluir solo `online`.
- `recommendedUrl` = mayor score.
- ordenar por score desc y port asc.

---

## FASE 3 - IPC main para discovery

Modificar `src/main/preview/ipc.ts`.

Agregar handler invoke:
- `levante/preview/discover-urls` payload `{ forceRefresh?: boolean; includeOffline?: boolean }`
- return `PreviewDiscoveryResult`

Comportamiento:
1. leer `coworkModeCwd` desde preferencias.
2. llamar `discoverPreviewUrls(cwd, options)`.
3. devolver resultado.

Para v1:
- no agregar eventos push de discovery.
- no agregar `start/stop` de discovery server-side.

---

## FASE 4 - Preload dedicado de nav bar (obligatorio)

Modificar `src/preload/preview/navPreload.ts`.

Agregar:

```ts
discoverUrls: (options?: { forceRefresh?: boolean; includeOffline?: boolean }) =>
  ipcRenderer.invoke('levante/preview/discover-urls', options)
```

Verificacion:
- `window.levantePreviewNav.discoverUrls` disponible en `preview/nav`.

---

## FASE 5 - Preload principal (opcional)

Solo si discovery tambien debe usarse desde main window:
- agregar `discoverUrls` en `src/preload/preview/api.ts`.
- tipar en `src/preload/preload.ts`.

No es requisito para que funcione la barra de preview.

---

## FASE 6 - Estado renderer de discovery

Modificar `src/renderer/preview/stores/previewStore.ts`.

Agregar estado:
- `discoveredServices: DiscoveredPreviewService[]`
- `recommendedUrl: string | null`
- `isDiscovering: boolean`
- `lastDiscoveryAt: number | null`
- `discoveryError: string | null`

Agregar acciones:
- `setDiscoveryResult(result)`
- `setDiscovering(boolean)`
- `setDiscoveryError(string | null)`

---

## FASE 7 - UI de seleccion multi-servicio

## 7.1 `src/renderer/preview/pages/PreviewNavBar.tsx`

Al montar:
1. ejecutar `window.levantePreviewNav.discoverUrls()`.
2. almacenar resultado en store.
3. si `currentUrl` vacio y existe `recommendedUrl`, navegar con `window.levantePreviewNav.navigateTo(recommendedUrl)`.

Agregar boton `Refresh discovery`.

Polling v1 (obligatorio):
- cada 10-15s.
- cleanup en unmount.
- evitar race conditions con request token incremental.

## 7.2 `src/renderer/preview/components/NavigationBar.tsx`

Agregar dropdown de servicios detectados:
- etiqueta: `Detected services`
- item: `frameworkGuess · host:port`
- seleccionar -> navegar a `service.url`

Estado vacio:
- texto: `No running local services detected`
- accion: `Refresh`

---

## FASE 8 - i18n (diferido, no v1)

No realizar cambios de i18n en esta implementacion.
Registrar ticket/nota para v2:
1. inicializar i18n en `src/renderer/preview/nav.tsx`.
2. agregar claves de discovery en `en/chat.json` y `es/chat.json`.

---

## FASE 9 - Opcional: persistencia por CWD

Si se quiere recordar URL por proyecto:
1. preferencia `previewLastUrlByCwd: Record<string, string>`.
2. schema en `preferencesService`.
3. al seleccionar URL, guardar por `cwd`.
4. en discovery, priorizar guardada si sigue online.

---

## 8) Seguridad y limites

Obligatorio:
- No abrir automaticamente URLs fuera de allowlist.
- No usar shell.
- No escaneo masivo de puertos.
- `redirect: 'manual'` en probes.
- validar siempre al cargar via `loadPreviewUrl`.

---

## 9) Matriz de pruebas manuales

Caso A: un servicio
1. levantar Vite en 5173.
2. abrir preview.
3. debe detectar 5173 y recomendarla.

Caso B: dos servicios
1. levantar frontend 5173 y admin 3000.
2. abrir preview.
3. debe listar ambos y permitir switch.

Caso C: sin servicios
1. no levantar nada.
2. abrir preview.
3. lista vacia + mensaje + refresh.

Caso D: allowlist bloquea
1. forzar URL no permitida.
2. intentar navegar.
3. debe bloquear por validacion existente.

Caso E: cambio dinamico con polling
1. abrir preview con polling.
2. levantar nuevo servicio.
3. debe aparecer tras refresh/polling.

Caso F: contexto correcto de API
1. verificar desde nav bar que se usa `window.levantePreviewNav.discoverUrls`.
2. confirmar que no depende de `window.levante.preview`.

---

## 10) Definition of Done

- [ ] `discoverUrls` devuelve multiples servicios online.
- [ ] barra permite elegir servicio detectado.
- [ ] recomendacion se aplica si no hay URL actual.
- [ ] manejo correcto de vacio/error.
- [ ] polling activo (10-15s) con cleanup correcto.
- [ ] contratos IPC/preload alineados con `levantePreviewNav`.
- [ ] sin cambios de i18n en v1 (strings fijos en nav).
- [ ] `pnpm typecheck` verde.
- [ ] `pnpm lint` verde (o preexistentes documentados).

---

## 11) Orden de ejecucion

1. FASE 0
2. FASE 1
3. FASE 2
4. FASE 3
5. FASE 4
6. FASE 5 (opcional)
7. FASE 6
8. FASE 7
9. FASE 8 (diferido, no ejecutar en v1)
10. FASE 9 (opcional)
11. pruebas seccion 9
12. checklist seccion 10

---

## 12) Riesgos y mitigaciones

1. Falsos positivos de puertos.
- Mitigacion: considerar activo solo si responde HTTP.

2. Latencia alta de probes.
- Mitigacion: timeout corto + concurrencia limitada + deadline global.

3. Recomendacion incorrecta.
- Mitigacion: mostrar lista y permitir override manual.

4. Inconsistencias por polling.
- Mitigacion: request token y descarte de respuestas stale.

5. Ruptura por contexto IPC equivocado.
- Mitigacion: consumir discovery desde `navPreload` en la barra.

6. Alcance extra por i18n en v1.
- Mitigacion: dejar i18n fuera de este entregable y planificar v2.

---

## 13) Comandos de verificacion final

```bash
pnpm typecheck
pnpm lint
pnpm dev
```

Smoke:
- abrir preview,
- comprobar deteccion,
- cambiar entre servicios,
- validar bloqueos de allowlist,
- confirmar refresh manual y polling.
