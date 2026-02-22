# RAM Book: Project-Scoped Skills (Global + Project Scope)

> Documento de referencia para implementacion completa (PRD + blueprint tecnico + checklist ejecutable)
> Producto: Levante Dev
> Fecha: 2026-02-21
> Estado: READY FOR IMPLEMENTATION (con alcance y contratos cerrados)

---

## 0. Como usar este RAM Book

Este documento esta escrito para que una IA pueda implementar la feature sin suposiciones. Todo comportamiento esperado, contrato de datos, flujo UI/IPC/Main y criterio de validacion esta explicitado.

Reglas de ejecucion:
- Implementar exactamente lo descrito aqui.
- No inventar contratos fuera de este documento.
- Si un punto no aparece aqui, se considera fuera de alcance.
- Priorizar seguridad de rutas y coherencia de estado por encima de conveniencia.

---

## 1. Objetivo de producto

Agregar soporte de skills con alcance por proyecto, sin romper comportamiento global actual.

Resultado esperado:
- Las skills pueden instalarse en scope `global` o `project`.
- El agente en chat de proyecto usa `global + project(actual)` con precedencia local.
- La UI muestra claramente el scope de cada instalacion.
- La desinstalacion es granular por scope.

---

## 2. Problemas detectados y decisiones cerradas

### 2.1 Problemas que este plan corrige

- Colision de estado cuando una misma `skill.id` existe en global y proyecto.
- Ambiguedad entre `projectId` y `projectCwd`.
- Riesgo de seguridad al confiar en `projectCwd` enviado por renderer para escribir/borrar.
- Cobertura incompleta de flujos UI (SkillsPage vs Details vs Deep Link).
- Desalineacion con arquitectura real de chat (se usa `ElectronChatTransport`, no `chatStore` para payload stream).

### 2.2 Decisiones finales (obligatorias)

- `projectCwd` NO se confia desde renderer para operaciones de escritura/borrado.
- Operaciones de `scope: project` resuelven `cwd` en main usando `projectId` via `projectService`.
- El merge con override por proyecto se usa solo para contexto de IA del proyecto activo.
- La vista de gestion de skills usa instalaciones por instancia (no solo por `skill.id`).
- Se introduce una clave canonica por instancia instalada para evitar colisiones de estado.

---

## 3. Alcance funcional

### 3.1 En alcance

- Instalacion de skill en scope global o en un proyecto especifico.
- Listado de instalaciones por scope (global + todos los proyectos con `cwd`).
- Inyeccion de skills en IA segun proyecto activo de la sesion.
- UI con badges de scope y filtro por alcance.
- Desinstalacion por scope especifico.

### 3.2 Fuera de alcance (v1)

- Migracion automatica de skills si cambia `project.cwd`.
- Sincronizacion cloud de `.levante/skills`.
- Deteccion de huerfanas en discos externos/no montados.

---

## 4. Estado actual verificado (codigo real)

- Skills globales: `~/levante/skills` via `directoryService.getSubdirPath('skills')`.
- `skillsService.listInstalledSkills()` hoy solo escanea global.
- `skillsHandlers` IPC recibe payloads simples (`skill`, `skillId`) sin `options`.
- `preload/api/skills.ts` y `LevanteAPI` tipan contratos antiguos.
- Chat stream se construye en `src/renderer/transports/ElectronChatTransport.ts`.
- `AIService.streamChat()` carga skills globales sin contexto de proyecto.
- `SkillsStore` usa `installedIds: Set<skillId>`, no soporta duplicados por scope.

---

## 5. Arquitectura objetivo

### 5.1 Capas

- Renderer: decide UX de scope (modales, filtros, badges).
- Preload: transporta contratos IPC tipados.
- Main IPC: valida payloads y delega.
- Services (main): resuelven proyecto/cwd, acceden filesystem, aplican merge.
- AI service: pide skills segun proyecto activo.

### 5.2 Reglas de precedencia

- Para IA en proyecto activo: `project` override sobre `global` por `skill.id`.
- Para UI de gestion: se muestran todas las instalaciones por instancia (sin dedupe cross-scope).

### 5.3 Regla de confianza

- `projectId` viene de renderer.
- `projectCwd` efectivo para filesystem se resuelve en main con `projectService`.
- Si `projectId` invalido, sin `cwd`, o inaccesible: error controlado.

---

## 6. Contratos de datos (fuente de verdad)

## 6.1 `src/types/skills.ts`

Agregar:

```ts
export type SkillScope = 'global' | 'project';

export interface InstalledSkill extends SkillDescriptor {
  installedAt: string;
  filePath: string;
  companionDir?: string;
  fileKeys?: string[];

  // NUEVO
  scope: SkillScope;
  // presente solo en scope project
  projectId?: string;
  projectName?: string;
  projectCwd?: string;

  // clave canonica por instancia para evitar colisiones por skill.id
  scopedKey: string; // format: "{scope}:{projectId|global}:{skillId}"
}

export interface InstallSkillOptions {
  scope?: SkillScope; // default 'global'
  projectId?: string; // requerido si scope === 'project'
}

export interface UninstallSkillOptions {
  scope: SkillScope;
  projectId?: string; // requerido si scope === 'project'
}

export type ListInstalledMode = 'global' | 'project-merged' | 'all-scopes';

export interface ListInstalledSkillsOptions {
  mode?: ListInstalledMode; // default 'global'
  projectId?: string; // requerido en mode 'project-merged'
}
```

Helper canonico (definido en `skillsService.ts` y replicable en renderer para indexado):

```ts
function buildScopedKey(scope: SkillScope, skillId: string, projectId?: string): string {
  return `${scope}:${scope === 'project' ? projectId ?? 'unknown' : 'global'}:${skillId}`;
}
```

## 6.2 Contratos IPC de skills

Canales y payloads:

- `levante/skills:install`
  - request: `{ bundle: SkillBundleResponse; options?: InstallSkillOptions }`
  - response: `IPCResult<InstalledSkill>`

- `levante/skills:uninstall`
  - request: `{ skillId: string; options: UninstallSkillOptions }`
  - response: `IPCResult<boolean>`

- `levante/skills:listInstalled`
  - request: `{ options?: ListInstalledSkillsOptions }`
  - response: `IPCResult<InstalledSkill[]>`

## 6.3 Chat request (stream)

Se agrega contexto de proyecto al request de chat:

- Archivo: `src/preload/types/index.ts`
- Archivo: `src/main/services/aiService.ts` (`ChatRequest`)

```ts
projectContext?: {
  projectId?: string;
}
```

Nota: no enviar `projectCwd` para decisiones de filesystem.

---

## 7. Especificacion backend (main)

## 7.1 `src/main/services/skillsService.ts`

### 7.1.1 Nuevos imports

- `projectService` desde `src/main/services/projectService.ts`.
- tipos nuevos desde `src/types/skills.ts`.

### 7.1.2 Helpers obligatorios

- `getGlobalSkillsDir(): string`
  - mantiene uso de `directoryService.getSubdirPath('skills')`.

- `getProjectSkillsDir(projectCwd: string): string`
  - `path.join(projectCwd, '.levante', 'skills')`.

- `buildScopedKey(scope, skillId, projectId?)`.

- `resolveProjectForScope(projectId)`
  - usa `projectService.getProject(projectId)`.
  - valida:
    - proyecto existe.
    - `cwd` presente.
    - `cwd` string no vacia.
  - retorna `{ id, name, cwd }`.

- `scanSkillsDir(input)`
  - input:
    - `dir: string`
    - `scope: SkillScope`
    - `project?: { id: string; name: string; cwd: string }`
  - salida: `InstalledSkill[]`
  - comportamiento:
    - si `dir` no existe: retorna `[]`.
    - parsea `.md` exactamente como hoy.
    - agrega `scope`, `projectId`, `projectName`, `projectCwd`, `scopedKey`.

### 7.1.3 API publica final

- `installSkill(bundle, options = {})`
  - default scope global.
  - si `scope === 'project'`:
    - exige `options.projectId`.
    - resuelve proyecto con `resolveProjectForScope`.
    - baseDir = `getProjectSkillsDir(project.cwd)`.
  - global:
    - baseDir = `getGlobalSkillsDir()`.
  - escribe skill y companion files en `baseDir`.
  - retorna `InstalledSkill` con metadata de scope y `scopedKey`.

- `uninstallSkill(skillId, options)`
  - `options` obligatorio para evitar desinstalaciones ambiguas.
  - resuelve baseDir por scope con mismas reglas de validacion.
  - borra archivo principal + companion dir del scope indicado.
  - no toca otras instalaciones con mismo `skillId`.

- `listInstalledSkills(options = {})`
  - `mode = 'global'` por defecto.

#### Modo `global`
- escanea solo global.
- retorna lista ordenada por `id` y `scope`.

#### Modo `project-merged`
- requiere `projectId`.
- resuelve proyecto -> escanea global + project.
- merge por `skill.id`: project pisa global.
- preserva metadata de scope resultante.

#### Modo `all-scopes`
- escanea global.
- obtiene proyectos via `projectService.listProjects()`.
- para cada proyecto con `cwd` valida/escanea `getProjectSkillsDir(cwd)`.
- concatena sin dedupe cross-scope.
- orden estable:
  - primero global por `id`.
  - luego project por `projectName` + `id`.

### 7.1.4 Politica de errores y logging

- Si un proyecto no tiene `cwd`: throw error claro en install/uninstall project.
- Si un directorio de proyecto no existe en listados: warning + continuar.
- `listInstalledSkills` nunca rompe todo por un proyecto fallido; continua con los demas.

---

## 8. Especificacion IPC (main)

## 8.1 `src/main/ipc/skillsHandlers.ts`

Actualizar handlers con payload objeto.

Install:
```ts
ipcMain.handle('levante/skills:install', async (_, payload: {
  bundle: SkillBundleResponse;
  options?: InstallSkillOptions;
}) => ...)
```

Uninstall:
```ts
ipcMain.handle('levante/skills:uninstall', async (_, payload: {
  skillId: string;
  options: UninstallSkillOptions;
}) => ...)
```

List:
```ts
ipcMain.handle('levante/skills:listInstalled', async (_, payload?: {
  options?: ListInstalledSkillsOptions;
}) => ...)
```

Validaciones minimas en handler antes de delegar:
- `install`: `payload?.bundle?.id` presente.
- `uninstall`: `payload?.skillId` y `payload?.options?.scope` presentes.
- `listInstalled`: valida combinacion `mode/projectId`.

---

## 9. Preload y API tipada

## 9.1 `src/preload/api/skills.ts`

Firmas finales:

```ts
install: (bundle: SkillBundleResponse, options?: InstallSkillOptions) =>
  ipcRenderer.invoke('levante/skills:install', { bundle, options }),

uninstall: (skillId: string, options: UninstallSkillOptions) =>
  ipcRenderer.invoke('levante/skills:uninstall', { skillId, options }),

listInstalled: (options?: ListInstalledSkillsOptions) =>
  ipcRenderer.invoke('levante/skills:listInstalled', { options }),
```

## 9.2 `src/preload/preload.ts`

Actualizar `LevanteAPI.skills` con las nuevas firmas exactas.

---

## 10. Integracion IA (chat)

## 10.1 Renderer: `src/renderer/transports/ElectronChatTransport.ts`

Agregar opcion por defecto:

```ts
projectId?: string | null;
```

Al construir `ChatRequest`:

```ts
...(projectId && {
  projectContext: { projectId }
}),
```

Actualizar:
- constructor `defaultOptions`.
- `updateOptions(...)`.
- factory `createElectronChatTransport(...)`.

## 10.2 Renderer: `src/renderer/pages/ChatPage.tsx`

Al crear/actualizar transport, pasar:

```ts
projectId: currentSession?.project_id ?? null
```

No mover esta logica a `chatStore`.

## 10.3 Main: `src/main/services/aiService.ts`

Actualizar `ChatRequest` con `projectContext`.

En `streamChat()`:
- extraer `projectId = request.projectContext?.projectId`.
- cargar skills asi:

```ts
installedSkills = await skillsService.listInstalledSkills(
  projectId
    ? { mode: 'project-merged', projectId }
    : { mode: 'global' }
);
```

Repetir mismo criterio en `sendSingleMessage()` para mantener paridad.

---

## 11. Renderer Store de skills

## 11.1 `src/renderer/stores/skillsStore.ts`

Objetivo: soportar multiples instalaciones de la misma `skill.id` en distintos scopes.

### 11.1.1 Estado

Mantener:
- `installedSkills: InstalledSkill[]`

Reemplazar `installedIds` por:
- `installedScopedKeys: Set<string>`

Agregar helpers:
- `getInstalledBySkillId(skillId): InstalledSkill[]`
- `isInstalledAnywhere(skillId): boolean`
- `isInstalledInScope(skillId, scope, projectId?): boolean`

### 11.1.2 Acciones

- `loadInstalled(options?: ListInstalledSkillsOptions)`
  - para SkillsPage usar `{ mode: 'all-scopes' }`.

- `installSkill(skill: SkillDescriptor, options?: InstallSkillOptions)`
  - descarga bundle y llama API install con options.
  - upsert por `scopedKey` (no por `id`).

- `uninstallSkill(skillId: string, options: UninstallSkillOptions)`
  - elimina solo la instancia matching `scope + projectId + skillId`.

### 11.1.3 Regla de consistencia

Toda actualizacion en estado usa `scopedKey` como identificador primario.

---

## 12. UI/UX detallado

## 12.1 Componentes nuevos

- `src/renderer/components/skills/SkillInstallScopeModal.tsx`
  - opciones:
    - `Global`
    - proyectos con `cwd`.
  - salida: `InstallSkillOptions`.

- `src/renderer/components/skills/SkillUninstallScopeModal.tsx`
  - recibe `skillId` + `installedInstances: InstalledSkill[]`.
  - permite elegir la instancia a desinstalar.
  - salida: `UninstallSkillOptions`.

## 12.2 `SkillsPage.tsx`

### 12.2.1 Carga inicial

- `loadCatalog()`
- `loadCategories()`
- `loadInstalled({ mode: 'all-scopes' })`
- Renderizar dos bloques en la pagina:
  - `Catalog` (skills del catalogo remoto).
  - `Installed Instances` (instancias instaladas reales con scope).

### 12.2.2 Scope filter obligatorio (US-3)

Agregar filtro de alcance:
- `all`
- `global`
- cada proyecto con `cwd`

Aplicar filtro sobre instalaciones para:
- badges en cards
- lista `Installed Instances` (obligatoria)

### 12.2.3 Instalacion

Flujo unico:
- si hay proyectos con `cwd`, abrir `SkillInstallScopeModal`.
- si no, install global directa.

### 12.2.4 Desinstalacion

- Si skill instalada en una sola instancia: desinstalar directo esa instancia.
- Si instalada en multiples scopes: abrir `SkillUninstallScopeModal`.

## 12.3 `SkillCard.tsx`

Mostrar estado por scope (no solo booleano).

Reglas:
- Badge `Global` si existe instancia global.
- Badges de proyecto para instancias project (max 2 visibles + `+N`).
- CTA:
  - `Install` siempre disponible.
  - `Remove` opera sobre scope seleccionado/instancia (via modal si ambiguo).

## 12.4 `SkillDetailsModal.tsx`

Debe usar mismo flujo de scope que `SkillsPage`:
- install abre selector de scope.
- uninstall usa selector de instancia si hay multiples scopes.

## 12.5 `SkillInstallDeepLinkModal.tsx`

Debe soportar seleccion de scope igual que los otros entry points.
No dejar instalacion forzada global por omision silenciosa.

## 12.6 `App.tsx` (flujo deep link)

En el handler de deep link `skill-install`, actualizar:

```ts
await Promise.all([
  store.loadCatalog(),
  store.loadInstalled({ mode: 'all-scopes' })
]);
```

Objetivo: cuando se abra el modal por deep link, el estado de instalaciones por scope ya esta completo.

---

## 13. Flujos funcionales finales

## 13.1 Instalacion

```text
UI (page/details/deeplink)
  -> selector scope
  -> skillsStore.installSkill(skill, options)
  -> preload.skills.install(bundle, options)
  -> IPC skills:install {bundle, options}
  -> skillsService.installSkill(bundle, options)
       - resolve project cwd server-side si scope=project
       - write .md + companion files en dir correcto
  -> return InstalledSkill con scopedKey
  -> store upsert por scopedKey
```

## 13.2 Desinstalacion

```text
UI decide instancia (scope + projectId)
  -> skillsStore.uninstallSkill(skillId, options)
  -> preload.skills.uninstall(skillId, options)
  -> IPC skills:uninstall
  -> skillsService.uninstallSkill(skillId, options)
       - borra solo ese scope
  -> store remove por scopedKey
```

## 13.3 Inyeccion IA

```text
ChatPage -> ElectronChatTransport
  request.projectContext.projectId
  -> AIService.streamChat(request)
  -> skillsService.listInstalledSkills(
       projectId ? {mode:'project-merged', projectId} : {mode:'global'}
     )
  -> buildSystemPrompt + skill_execute con skills merged
```

---

## 14. Seguridad

Controles obligatorios:
- No usar `projectCwd` de renderer para filesystem writes/deletes.
- Resolver proyecto por `projectId` en main.
- Sanitizar `skillId` y companion file segments como ya existe.
- No permitir uninstall ambiguo sin scope.
- Logs de warning para rutas inaccesibles sin romper global.

---

## 15. Performance

- `project-merged` escanea max 2 dirs (global + proyecto activo).
- `all-scopes` se usa en SkillsPage, no en cada mensaje de chat.
- Evitar queries redundantes en chat:
  - resolver proyecto activo una sola vez por request.

---

## 16. Plan de implementacion ejecutable

## Fase 1: Tipos y contratos

1. Actualizar `src/types/skills.ts` con `SkillScope`, options, `ListInstalledMode`, campos nuevos de `InstalledSkill`, `scopedKey`.
2. Actualizar `src/preload/types/index.ts` y `src/main/services/aiService.ts` `ChatRequest` con `projectContext.projectId`.
3. Actualizar `src/preload/preload.ts` `LevanteAPI.skills` con firmas nuevas.

Criterio de salida:
- `pnpm typecheck` falla solo por usos pendientes de firmas antiguas.

## Fase 2: SkillsService

4. Implementar helpers `getGlobalSkillsDir`, `getProjectSkillsDir`, `buildScopedKey`, `resolveProjectForScope`, `scanSkillsDir`.
5. Refactor `installSkill` con `options` y resolucion server-side de proyecto.
6. Refactor `uninstallSkill` con `UninstallSkillOptions` obligatorio.
7. Refactor `listInstalledSkills(options)` con modos `global`, `project-merged`, `all-scopes`.

Criterio de salida:
- servicio compila y retorna metadata de scope correcta.

## Fase 3: IPC y preload api

8. Actualizar `skillsHandlers.ts` a payloads objeto y validaciones.
9. Actualizar `preload/api/skills.ts` a nuevas firmas.

Criterio de salida:
- llamadas renderer->main funcionando con nuevos payloads.

## Fase 4: AI integration

10. `ElectronChatTransport`: agregar `projectId` en opciones/request.
11. `ChatPage`: pasar `currentSession?.project_id` al transport (create + update).
12. `AIService.streamChat` y `sendSingleMessage`: usar `listInstalledSkills` por modo.

Criterio de salida:
- chat de proyecto usa skills merged de su proyecto.
- chat sin proyecto usa solo global.

## Fase 5: Renderer skills store

13. Reemplazar indexado por `id` por indexado por `scopedKey`.
14. Adaptar `loadInstalled` a recibir opciones.
15. Adaptar `installSkill/uninstallSkill` con options.
16. Agregar selectors `getInstalledBySkillId`, `isInstalledAnywhere`, `isInstalledInScope`.

Criterio de salida:
- soporta coexistencia global+project del mismo `skillId`.

## Fase 6: UI

17. Crear `SkillInstallScopeModal`.
18. Crear `SkillUninstallScopeModal`.
19. Integrar modales en `SkillsPage`.
20. Actualizar `SkillCard` badges + CTA basado en instancias.
21. Actualizar `SkillDetailsModal` para usar mismos flujos.
22. Actualizar `SkillInstallDeepLinkModal` para usar mismos flujos.
23. Implementar filtro por scope en SkillsPage (US-3).

Criterio de salida:
- cualquier punto de instalacion/desinstalacion permite elegir scope correctamente.

## Fase 7: Tests y validacion

24. Añadir `src/main/services/__tests__/skillsService.test.ts` (vitest).
25. Añadir tests de store `src/renderer/stores/__tests__/skillsStore.test.ts`.
26. Añadir tests de transport/request para `projectContext` en `src/renderer/transports/__tests__/ElectronChatTransport.test.ts`.
27. Ejecutar:

```bash
pnpm typecheck
pnpm test
```

Criterio de salida:
- sin errores de tipos.
- tests nuevos verdes.

---

## 17. Casos de prueba obligatorios

## 17.1 Unit tests skillsService

- Instalar global escribe en `~/levante/skills/...` y retorna `scope=global`.
- Instalar project con `projectId` valido escribe en `{cwd}/.levante/skills/...` y retorna metadata project.
- Instalar project sin `projectId` falla.
- Instalar project con proyecto sin `cwd` falla.
- Uninstall global no borra instalacion project del mismo `skillId`.
- Uninstall project no borra instalacion global del mismo `skillId`.
- `listInstalledSkills({mode:'global'})` retorna solo global.
- `listInstalledSkills({mode:'project-merged', projectId})` mergea y prioriza project en conflictos.
- `listInstalledSkills({mode:'all-scopes'})` retorna todas las instancias sin dedupe cross-scope.

## 17.2 Unit tests skillsStore

- Upsert por `scopedKey` no pisa instancia de otro scope.
- Remove por `scopedKey` elimina solo instancia objetivo.
- `isInstalledAnywhere` true si existe al menos una instancia.
- `getInstalledBySkillId` retorna todas las instancias del skill.

## 17.3 Integration tests chat context

- Request de chat incluye `projectContext.projectId` desde transport.
- `AIService` pide modo `project-merged` cuando hay `projectId`.
- `AIService` pide modo `global` cuando no hay `projectId`.

## 17.4 Manual QA

- Instalar skill en global y en proyecto A.
- Ver badges correctos y filtro por scope.
- En chat de proyecto A la skill local overridea global.
- En chat de proyecto B no aparece la local de A.
- Desinstalar solo global mantiene project.
- Desinstalar solo project mantiene global.
- Deep link install respeta selector de scope.

---

## 18. Impacto por archivo

Archivos a modificar:
- `src/types/skills.ts`
- `src/main/services/skillsService.ts`
- `src/main/ipc/skillsHandlers.ts`
- `src/preload/api/skills.ts`
- `src/preload/preload.ts`
- `src/preload/types/index.ts`
- `src/main/services/aiService.ts`
- `src/renderer/transports/ElectronChatTransport.ts`
- `src/renderer/pages/ChatPage.tsx`
- `src/renderer/stores/skillsStore.ts`
- `src/renderer/pages/SkillsPage.tsx`
- `src/renderer/App.tsx`
- `src/renderer/components/skills/SkillCard.tsx`
- `src/renderer/components/skills/SkillDetailsModal.tsx`
- `src/renderer/components/skills/SkillInstallDeepLinkModal.tsx`
- `src/renderer/components/skills/SkillInstallScopeModal.tsx` (nuevo)
- `src/renderer/components/skills/SkillUninstallScopeModal.tsx` (nuevo)
- `src/main/services/__tests__/skillsService.test.ts` (nuevo)
- `src/renderer/stores/__tests__/skillsStore.test.ts` (nuevo)
- `src/renderer/transports/__tests__/ElectronChatTransport.test.ts` (nuevo)

---

## 19. Criterios de aceptacion finales (DoD)

US-1 Instalar en proyecto:
- Selector de scope visible cuando existan proyectos con cwd.
- Instalacion project se guarda en `{project.cwd}/.levante/skills/...`.

US-2 IA recibe skills correctas:
- Sesion con proyecto: global + local del proyecto activo (con override local).
- Sesion sin proyecto: solo global.

US-3 Visualizar por alcance:
- Badges por scope en UI.
- Filtro funcional por alcance.

US-4 Desinstalar por scope:
- Se puede desinstalar global sin tocar project.
- Se puede desinstalar project sin tocar global.

No regresiones:
- Deep link install sigue funcionando.
- `pnpm typecheck` y `pnpm test` verdes.

---

## 20. Riesgos residuales y mitigacion

Riesgo: proyecto movido/eliminado deja skills locales inaccesibles.
- Mitigacion: warning no bloqueante en listados; no rompe skills globales.

Riesgo: costo de `all-scopes` con muchos proyectos.
- Mitigacion: usar solo en SkillsPage y no en path de chat.

Riesgo: inconsistencias UI si se mantiene logica vieja de `installedIds`.
- Mitigacion: migrar por completo a `scopedKey`.

---

## 21. Notas de implementacion obligatorias

- No introducir dependencia de `projectCwd` desde renderer para escrituras.
- No dejar `uninstall(skillId)` sin scope porque seria ambiguo.
- No deduplicar por `id` en UI de gestion de instalaciones.
- No mover payload de stream a `chatStore`; la fuente real es `ElectronChatTransport`.

---

## 22. Secuencia recomendada de commit

1. `types + skills service core`
2. `ipc + preload contracts`
3. `chat integration`
4. `renderer store + ui modals + filters`
5. `tests`

Cada commit debe pasar `pnpm typecheck`.
