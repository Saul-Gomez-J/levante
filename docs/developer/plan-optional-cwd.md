# Plan: CWD Opcional al Crear Proyecto — Auto-creación en ~/levante/projects/

## Objetivo

Cuando un usuario crea un nuevo proyecto y **no selecciona una carpeta** manualmente, el sistema debe crear automáticamente una carpeta en `~/levante/projects/{nombre-del-proyecto}/` y asignarla como CWD del proyecto.

---

## Archivos a Modificar

| # | Archivo | Cambio |
|---|---------|--------|
| 1 | `src/main/services/projectService.ts` | Añadir lógica de auto-creación de carpeta en `createProject()` |
| 2 | `src/main/services/directoryService.ts` | Añadir método `ensureProjectDir(projectName)` |
| 3 | `src/renderer/components/projects/ProjectModal.tsx` | Actualizar UI: hint de que la carpeta es auto-generada si se deja vacío |
| 4 | `src/renderer/locales/en/chat.json` | Añadir texto de hint en inglés |
| 5 | `src/renderer/locales/es/chat.json` | Añadir texto de hint en español |

---

## Paso a Paso Detallado

### Paso 1: `src/main/services/directoryService.ts` — Añadir `ensureProjectDir`

Añadir un método que sanitiza el nombre del proyecto y crea la carpeta dentro de `~/levante/projects/`.

**Código a añadir** (antes de `static readonly FILES`):

```typescript
  /**
   * Sanitize a project name into a safe directory name
   */
  private sanitizeProjectName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9áéíóúñü\s-]/g, '')  // keep alphanumeric, accented chars, spaces, hyphens
      .replace(/\s+/g, '-')                    // spaces to hyphens
      .replace(/-+/g, '-')                     // collapse multiple hyphens
      .replace(/^-|-$/g, '')                   // trim leading/trailing hyphens
      .substring(0, 50)                        // limit length
      || 'project';                            // fallback if everything was stripped
  }

  /**
   * Ensure a project directory exists inside ~/levante/projects/
   * Returns the full absolute path to the project directory.
   * If the name already exists, appends a numeric suffix.
   */
  async ensureProjectDir(projectName: string): Promise<string> {
    const projectsBase = path.join(this.baseDir, 'projects');
    await fs.mkdir(projectsBase, { recursive: true });

    let dirName = this.sanitizeProjectName(projectName);
    let projectPath = path.join(projectsBase, dirName);

    // Avoid collisions: append -2, -3, etc. if needed
    let suffix = 1;
    while (true) {
      try {
        await fs.access(projectPath);
        // Path exists, try next suffix
        suffix++;
        projectPath = path.join(projectsBase, `${dirName}-${suffix}`);
      } catch {
        // Path doesn't exist — we can use it
        break;
      }
    }

    await fs.mkdir(projectPath, { recursive: true });
    this.logger.core.info('Project directory created', { projectName, projectPath });
    return projectPath;
  }
```

**Ubicación exacta**: Antes de la línea `static readonly FILES = {` (línea ~191).

---

### Paso 2: `src/main/services/projectService.ts` — Modificar `createProject()`

Modificar el método `createProject` para que, cuando `input.cwd` sea `undefined` o vacío, llame a `directoryService.ensureProjectDir(input.name)` y use la ruta devuelta como CWD.

**Código actual** (líneas 31-58):
```typescript
async createProject(input: CreateProjectInput): Promise<DatabaseResult<Project>> {
    const id = this.generateId();
    const now = Date.now();
    const project: Project = {
      id,
      name: input.name,
      cwd: input.cwd ?? null,
      description: input.description ?? null,
      created_at: now,
      updated_at: now,
    };
    // ... INSERT ...
```

**Código nuevo**:
```typescript
async createProject(input: CreateProjectInput): Promise<DatabaseResult<Project>> {
    const id = this.generateId();
    const now = Date.now();

    // Auto-create project directory if no CWD provided
    let cwd = input.cwd ?? null;
    if (!cwd) {
      try {
        cwd = await directoryService.ensureProjectDir(input.name);
        this.logger.database.info('Auto-created project directory', { projectId: id, cwd });
      } catch (error) {
        this.logger.database.error('Failed to auto-create project directory', {
          error: error instanceof Error ? error.message : error,
        });
        // Continue without CWD rather than failing project creation
      }
    }

    const project: Project = {
      id,
      name: input.name,
      cwd,
      description: input.description ?? null,
      created_at: now,
      updated_at: now,
    };
    // ... rest stays the same ...
```

**Importación necesaria**: Añadir `import { directoryService } from './directoryService';` al inicio del archivo (después de las otras importaciones).

---

### Paso 3: `src/renderer/components/projects/ProjectModal.tsx` — Hint en la UI

Añadir un texto de ayuda debajo del campo CWD indicando que si se deja vacío, se creará automáticamente.

**Código actual** (líneas 103-123, sección CWD):
```tsx
{/* CWD */}
<div className="space-y-1">
  <Label>{t('chat_list.project_modal.cwd_label')}</Label>
  <div className="flex gap-2">
    <Input
      value={cwd}
      onChange={(e) => setCwd(e.target.value)}
      placeholder={t('chat_list.project_modal.cwd_placeholder')}
      className="flex-1"
    />
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleSelectDirectory}
      className="shrink-0"
    >
      <FolderOpen size={14} />
    </Button>
  </div>
</div>
```

**Código nuevo**:
```tsx
{/* CWD */}
<div className="space-y-1">
  <Label>{t('chat_list.project_modal.cwd_label')}</Label>
  <div className="flex gap-2">
    <Input
      value={cwd}
      onChange={(e) => setCwd(e.target.value)}
      placeholder={t('chat_list.project_modal.cwd_placeholder')}
      className="flex-1"
    />
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleSelectDirectory}
      className="shrink-0"
    >
      <FolderOpen size={14} />
    </Button>
  </div>
  {!isEditing && !cwd && (
    <p className="text-xs text-muted-foreground">
      {t('chat_list.project_modal.cwd_auto_hint')}
    </p>
  )}
</div>
```

El hint solo se muestra al **crear** (no al editar) y solo cuando el campo CWD está vacío.

---

### Paso 4: `src/renderer/locales/en/chat.json` — Añadir key de hint

**Dentro del bloque `project_modal`**, añadir después de `"cwd_placeholder"`:

```json
"cwd_auto_hint": "If left empty, a folder will be created automatically in ~/levante/projects/"
```

**Resultado del bloque completo**:
```json
"project_modal": {
  "title_create": "New Project",
  "title_edit": "Edit Project",
  "name_label": "Name",
  "name_placeholder": "My project...",
  "cwd_label": "Working directory (CWD)",
  "cwd_placeholder": "Select a directory...",
  "cwd_auto_hint": "If left empty, a folder will be created automatically in ~/levante/projects/",
  "description_label": "Description / Instructions",
  "description_placeholder": "Context that will be injected into the system prompt...",
  "save": "Save",
  "cancel": "Cancel"
},
```

---

### Paso 5: `src/renderer/locales/es/chat.json` — Añadir key de hint

**Dentro del bloque `project_modal`**, añadir después de `"cwd_placeholder"`:

```json
"cwd_auto_hint": "Si se deja vacío, se creará una carpeta automáticamente en ~/levante/projects/"
```

**Resultado del bloque completo**:
```json
"project_modal": {
  "title_create": "Nuevo Proyecto",
  "title_edit": "Editar Proyecto",
  "name_label": "Nombre",
  "name_placeholder": "Mi proyecto...",
  "cwd_label": "Directorio de trabajo (CWD)",
  "cwd_placeholder": "Seleccionar un directorio...",
  "cwd_auto_hint": "Si se deja vacío, se creará una carpeta automáticamente en ~/levante/projects/",
  "description_label": "Descripción / Instrucciones",
  "description_placeholder": "Contexto que se inyectará en el system prompt...",
  "save": "Guardar",
  "cancel": "Cancelar"
},
```

---

## Flujo Resultante

```
Usuario crea proyecto "Mi App Web" sin seleccionar carpeta
  ↓
ProjectModal envía CreateProjectInput { name: "Mi App Web", cwd: undefined }
  ↓
IPC → projectService.createProject()
  ↓
cwd es undefined → llama a directoryService.ensureProjectDir("Mi App Web")
  ↓
directoryService:
  1. Crea ~/levante/projects/ si no existe
  2. Sanitiza nombre: "mi-app-web"
  3. Verifica que ~/levante/projects/mi-app-web/ no exista
  4. Crea ~/levante/projects/mi-app-web/
  5. Retorna "/Users/user/levante/projects/mi-app-web"
  ↓
projectService guarda el proyecto con cwd = "/Users/user/levante/projects/mi-app-web"
  ↓
El proyecto ya tiene CWD funcional para:
  - Cowork Mode (bash, file browser)
  - Skills scoping (.levante/skills/)
  - Sidebar file browser
```

---

## Archivos NO modificados (sin cambios necesarios)

| Archivo | Razón |
|---------|-------|
| `src/types/database.ts` | `CreateProjectInput.cwd` ya es opcional (`cwd?: string`) |
| `src/main/ipc/projectHandlers.ts` | Solo pasa `input` al servicio, sin lógica propia |
| `src/preload/api/projects.ts` | Solo bridge IPC, sin lógica |
| `src/renderer/stores/projectStore.ts` | Solo llama a IPC, sin lógica |
| `src/renderer/App.tsx` | `handleProjectSave` ya funciona sin cambios |
| `database/migrations/` | No se necesitan cambios de schema |

---

## Consideraciones

1. **Colisión de nombres**: Si ya existe `~/levante/projects/mi-app-web/`, se crea `mi-app-web-2`, `mi-app-web-3`, etc.
2. **Error graceful**: Si falla la creación de carpeta (permisos, disco lleno), el proyecto se crea igual pero sin CWD (comportamiento actual).
3. **Solo para creación**: Al editar un proyecto, si se borra el CWD manualmente, NO se auto-crea uno nuevo (el usuario lo está haciendo intencionalmente).
4. **No se eliminan carpetas**: Borrar un proyecto NO elimina la carpeta auto-creada del disco. Esto es intencional para evitar pérdida de datos.
