# Plan de Implementación: Skills en el Chat UI

## Resumen

Añadir gestión de skills directamente desde el input del chat, siguiendo el mismo patrón visual que los MCP Tools. El usuario podrá ver, activar y desactivar skills instaladas (globales y de proyecto) sin salir del chat.

---
---

## Arquitectura actual relevante

### Componentes del chat (punto de entrada)

```
ChatPromptInput.tsx
└── PromptInputTools (barra izquierda)
    ├── ToolsMenu (gear + wrench icons)
    │   ├── Settings Dropdown (gear)
    │   │   ├── Cowork Mode
    │   │   ├── Cowork Directory
    │   │   └── Tools (MCP) ← aquí añadimos "Skills"
    │   └── Tools Dropdown (wrench) ← aquí añadimos icono de Skills
    └── ...
```

### Stack de datos actual (MCP como referencia)

```
mcpStore (Zustand)
  ↕ IPC
mcpHandlers.ts + preload/api/mcp.ts
  ↕
window.levante.mcp.*
```

### Stack de datos de Skills (actual)

```
skillsStore (Zustand)          ← ya existe, gestiona catalog + installed
  ↕ IPC
skillsHandlers.ts              ← ya existe, falta handler de toggle
  ↕
window.levante.skills.*        ← ya existe, falta método toggleUserInvocable
```

---

## Qué hay que construir

### Capa 1: Backend — nuevo IPC para toggle

**Archivo:** `src/main/services/skillsService.ts`

Añadir método:
```typescript
async setUserInvocable(
  skillId: string,
  userInvocable: boolean,
  options: { scope: SkillScope; projectId?: string }
): Promise<InstalledSkill>
```

Implementación:
1. Localizar el `skill.md` del skill (por scopedKey o por búsqueda)
2. Parsear su frontmatter
3. Actualizar el campo `user-invocable`
4. Re-serializar y escribir el archivo (sin tocar el contenido markdown)
5. Devolver el `InstalledSkill` actualizado

**Archivo:** `src/main/ipc/skillsHandlers.ts`

Añadir handler:
```typescript
// levante/skills:setUserInvocable
ipcMain.handle('levante/skills:setUserInvocable', async (_, { skillId, userInvocable, scope, projectId }) => {
  const result = await skillsService.setUserInvocable(skillId, userInvocable, { scope, projectId });
  return { success: true, data: result };
});
```

**Archivo:** `src/preload/api/skills.ts`

Añadir al objeto expuesto:
```typescript
setUserInvocable: (skillId: string, userInvocable: boolean, options: { scope: SkillScope; projectId?: string }) =>
  ipcRenderer.invoke('levante/skills:setUserInvocable', { skillId, userInvocable, ...options }),
```

**Archivo:** `src/preload/preload.ts`

Actualizar la declaración de tipos de `window.levante.skills` para incluir el nuevo método.

---

### Capa 2: Store — skillsStore

**Archivo:** `src/renderer/stores/skillsStore.ts`

Añadir al store:

```typescript
// Estado adicional
activeProjectId: string | null;   // para saber qué skills de proyecto mostrar

// Acciones adicionales
setActiveProject: (projectId: string | null) => void;

toggleUserInvocable: (
  skill: InstalledSkill,
  enabled: boolean
) => Promise<void>;

loadInstalledForChat: (projectId?: string) => Promise<void>;
// Carga global + project-merged según si hay proyecto activo
```

La acción `toggleUserInvocable`:
1. Llama a `window.levante.skills.setUserInvocable(...)`
2. Actualiza optimísticamente `installedSkills` en el store
3. En caso de error, revierte el cambio
#### 4.2 — Añadir icono de Skills al lado del wrench de MCP

Actualmente hay un botón con icono `Wrench` para abrir el panel de MCP. Añadir al lado un botón con icono `BookOpen` (o similar) para las skills, **visible solo si `enableSkills === true`**:

```tsx
{/* Botón Skills — solo visible cuando skills están activas */}
{enableSkills && (
  <DropdownMenu open={skillsOpen} onOpenChange={setSkillsOpen}>
    <DropdownMenuTrigger asChild>
      <PromptInputButton
        tooltip="Skills"
        className={cn(
          'rounded-full',
          skillsOpen && 'ring-2 ring-ring ring-offset-1'
        )}
      >
        <BookOpen className="h-4 w-4" />
      </PromptInputButton>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="start"
      side="top"
      sideOffset={8}
      className="w-80 p-0"
    >
      <SkillsPanel projectId={projectId} />
    </DropdownMenuContent>
  </DropdownMenu>
)}
```

---

### Capa 5: Integrar en ChatPromptInput

**Archivo:** `src/renderer/components/chat/ChatPromptInput.tsx`

Añadir estado y preferencia para skills:

```typescript
const [enableSkills, setEnableSkills] = usePreference('enableSkills'); // nueva preferencia
const { projectId } = useCurrentProject(); // hook existente o similar
```

Pasar props a `ToolsMenu`:
```tsx
<ToolsMenu
  // ... props existentes ...
  enableSkills={enableSkills ?? true}
  onSkillsChange={setEnableSkills}
  projectId={projectId}
/>
```

---

### Capa 6: Nueva preferencia

**Archivo:** `src/main/services/preferences/PreferencesService.ts` (o donde se definen los defaults)

Añadir:
```typescript
enableSkills: boolean;  // default: true
```

---

## Flujo completo tras la implementación

```
Usuario abre Settings Dropdown
  → Ve fila "Skills" con toggle
  → Activa Skills

Usuario ve icono BookOpen al lado del wrench MCP
  → Lo pulsa

Se abre SkillsPanel
  → skillsStore.loadInstalledForChat(projectId) es llamado
  → IPC: levante/skills:listInstalled { mode: 'project-merged', projectId }
  → Se devuelven skills globales + de proyecto activo

Usuario ve lista de skills agrupadas por enabled/disabled
  → Pulsa Switch de una skill

skillsStore.toggleUserInvocable(skill, false)
  → IPC: levante/skills:setUserInvocable { skillId, userInvocable: false, scope, projectId }
  → skillsService escribe skill.md actualizado en disco
  → skillsStore actualiza installedSkills optimísticamente

En el próximo mensaje del usuario:
  → aiService llama listInstalledSkills
  → skillsContextBuilder filtra por userInvocable !== false
  → Solo skills activas aparecen en el prompt de la IA
```

---

## Archivos a crear/modificar

| Acción | Archivo |
|--------|---------|
| **Modificar** | `src/main/services/skillsService.ts` — añadir `setUserInvocable()` |
| **Modificar** | `src/main/ipc/skillsHandlers.ts` — añadir handler IPC |
| **Modificar** | `src/preload/api/skills.ts` — exponer nuevo método |
| **Modificar** | `src/preload/preload.ts` — actualizar tipos |
| **Modificar** | `src/renderer/stores/skillsStore.ts` — añadir acciones de toggle y carga para chat |
| **Crear** | `src/renderer/components/chat/SkillsPanel.tsx` — componente panel |
| **Modificar** | `src/renderer/components/chat/ToolsMenu.tsx` — añadir fila Settings + botón icono |
| **Modificar** | `src/renderer/components/chat/ChatPromptInput.tsx` — pasar nuevas props |
| **Modificar** | `src/main/services/skillsService.ts:192` — **fix bug userInvocable parsing** |

---

## Orden de implementación recomendado

1. **Fix bug** de parsing `userInvocable` en `skillsService.ts:192`
2. **Backend**: `setUserInvocable()` en SkillsService + handler IPC + preload
3. **Store**: ampliar `skillsStore` con `toggleUserInvocable` y `loadInstalledForChat`
4. **Componente**: crear `SkillsPanel.tsx`
5. **ToolsMenu**: añadir fila Settings + botón icono BookOpen con dropdown
6. **ChatPromptInput**: integrar preferencia `enableSkills` y pasar props

---

## Notas de diseño

- **Icono sugerido**: `BookOpen` de lucide-react (representa habilidades/conocimiento, coherente con el concepto de skills)
- **Scope visual**: cada skill muestra badge `project` o `global` para claridad
- **Estado por defecto**: `enableSkills: true` — skills activas al instalar
- **Sin estado intermedio**: el toggle cambia directamente el `user-invocable` en disco, sin capa de preferencias adicional. La preferencia `enableSkills` solo controla si el icono/panel aparece en el chat.
- **Agrupación**: la lista muestra primero skills de proyecto (más relevantes), luego globales, dentro de cada tab Enabled/Disabled
- **No hay "select all"**: a diferencia de MCP Tools, cada skill es independiente — no tiene sub-herramientas
