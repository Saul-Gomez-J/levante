# Análisis del Sistema de Skills en Levante

> Investigación realizada el 2026-02-21

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Almacenamiento y disponibilidad](#2-almacenamiento-y-disponibilidad)
3. [Flujo de instalación](#3-flujo-de-instalación)
4. [Inyección en contexto de IA](#4-inyección-en-contexto-de-ia)
5. [Flujo de deep link](#5-flujo-de-deep-link)
6. [Mapa de archivos críticos](#6-mapa-de-archivos-críticos)
7. [Seguridad y validaciones](#7-seguridad-y-validaciones)

---

## 1. Resumen ejecutivo

El sistema de skills implementa un flujo **tripartito** completamente integrado:

| Fase | Descripción |
|------|-------------|
| **Disponibilidad** | Skills almacenadas en `~/levante/skills/{category}/{name}.md` con frontmatter YAML. Escaneadas en cada inicio de chat. |
| **Instalación** | Descarga desde `https://services.levanteapp.com/api/skills/{category}/{name}/bundle`, con cache local (TTL 1h) y fallback offline. |
| **Inyección en IA** | Dos vías: lista resumida en system prompt (4000 tokens máx.) + tool `skill_execute` que carga las instrucciones completas bajo demanda. |

---

## 2. Almacenamiento y disponibilidad

### 2.1 Estructura de disco

Las skills instaladas se guardan en el directorio de datos del usuario:

```
~/levante/
└── skills/
    ├── coding/
    │   ├── git-commit.md
    │   ├── git-commit/          ← archivos compañeros (opcional)
    │   │   └── rules/
    │   │       └── conventions.md
    │   └── debugging.md
    └── development/
        └── react-patterns.md
```

Cada `.md` contiene frontmatter YAML con metadatos seguido del contenido de instrucciones:

```markdown
---
id: "coding/git-commit"
name: "Git Commit Helper"
description: "Helps write conventional git commit messages"
category: "coding"
author: "levante"
version: "1.0.0"
installed-at: "2026-02-21T10:30:00.000Z"
---

# Instrucciones para el agente
...
```

### 2.2 Tipos de datos

**Archivo:** `src/types/skills.ts`

```typescript
export interface InstalledSkill extends SkillDescriptor {
  installedAt: string;       // ISO 8601
  filePath: string;          // ~/levante/skills/{category}/{name}.md
  companionDir?: string;     // ~/levante/skills/{category}/{name}/
  fileKeys?: string[];       // rutas relativas de archivos compañeros
}
```

### 2.3 Escaneo de skills disponibles

**Archivo:** `src/main/services/skillsService.ts` — `listInstalledSkills()` (línea 318)

El proceso ocurre en cada inicio de chat:

```
skillsService.listInstalledSkills()
    │
    ├─ Lee ~/levante/skills/
    ├─ Itera subdirectorios (categorías)
    ├─ Para cada .md:
    │   ├─ Lee contenido
    │   ├─ Parsea frontmatter YAML (parseFrontmatter, línea 101)
    │   └─ Construye objeto InstalledSkill
    └─ Retorna array ordenado
```

### 2.4 Catálogo remoto con cache

**Archivo:** `src/main/services/skillsService.ts` — `getCatalog()` (línea 148)

Estrategia de 3 intentos:

```
1. Cache local válido?     ──► ~/levante/skills-cache.json (TTL 1h)
       │ No
       ▼
2. Fetch remoto            ──► https://services.levanteapp.com/api/skills.json
       │ Error
       ▼
3. Cache stale (offline)   ──► Mismo archivo aunque expirado
```

Escritura atómica para evitar corrupción:
```typescript
const tmpPath = `${cachePath}.tmp`;
await fs.writeFile(tmpPath, JSON.stringify(cacheEntry), 'utf-8');
await fs.rename(tmpPath, cachePath); // operación atómica
```

---

## 3. Flujo de instalación

### 3.1 Diagrama completo

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUJO DE INSTALACIÓN                         │
└─────────────────────────────────────────────────────────────────┘

RENDERER
  SkillsPage.tsx (línea 54)
    └─ handleInstall(skill: SkillDescriptor)
         └─ skillsStore.installSkill(skill)
              │
              ├─ [1] getBundle(skill.id) ─────────────────────────┐
              │                                                    │
              └─ [2] install(bundleData) ──────────────────────┐  │

IPC BRIDGE                                                     │  │
  preload/api/skills.ts                                        │  │
    ├─ levante/skills:getBundle  ◄─────────────────────────────┘  │
    └─ levante/skills:install    ◄─────────────────────────────────┘

MAIN PROCESS
  skillsHandlers.ts
    ├─ getBundle handler
    │    └─ skillsService.getBundle(skillId)
    │         └─ apiFetch('/api/skills/{category}/{name}/bundle')
    │              Retorna: SkillBundleResponse
    │              { id, name, description, content, files: {...} }
    │
    └─ install handler
         └─ skillsService.installSkill(bundle)
              ├─ Valida skill.id
              ├─ ensureBaseDir()
              ├─ buildInstalledPath(skill.id)
              │    └─ Sanitiza rutas (categoría + nombre)
              │    └─ Genera: ~/levante/skills/{category}/{name}.md
              ├─ buildSkillFile(skill, installedAt)
              │    └─ Crea frontmatter YAML + content
              ├─ fs.writeFile() → archivo .md principal
              ├─ Para cada archivo en skill.files:
              │    └─ fs.writeFile() → ~/levante/skills/{category}/{name}/{path}
              └─ Retorna: InstalledSkill

RENDERER (actualización)
  skillsStore: set({ installedSkills: [...], installedIds: Set })
  Toast: "Skill instalada correctamente"
```

### 3.2 Paso a paso detallado

**[1] Descarga del bundle**

```typescript
// skillsStore.ts, línea 96
const bundleResult = await window.levante.skills.getBundle(skill.id);
```

El bundle contiene:
- Contenido markdown de la skill
- Archivos compañeros (`files: { "relativePath": "contenido" }`)
- Metadatos completos

**[2] Instalación en disco**

```typescript
// skillsService.ts, línea 221
async installSkill(skill: SkillBundleResponse): Promise<InstalledSkill> {
  // Sanitiza y construye ruta
  const { category, name, filePath } = buildInstalledPath(skill.id);

  // Crea directorio de categoría
  await fs.mkdir(categoryDir, { recursive: true });

  // Escribe archivo principal
  const fileContent = buildSkillFile(skill, installedAt);
  await fs.writeFile(filePath, fileContent, 'utf-8');

  // Escribe archivos compañeros
  for (const [relativePath, content] of Object.entries(skill.files ?? {})) {
    const fullPath = path.join(companionDir, ...sanitizedSegments);
    await fs.writeFile(fullPath, content, 'utf-8');
  }
}
```

### 3.3 Construcción del frontmatter

**Archivo:** `src/main/services/skillsService.ts` — `buildSkillFile()` (línea 74)

```typescript
function buildSkillFile(skill: SkillDescriptor, installedAt: string): string {
  const lines = ['---'];
  lines.push(`id: ${yamlString(skill.id)}`);
  lines.push(`name: ${yamlString(skill.name)}`);
  lines.push(`description: ${yamlString(skill.description)}`);
  lines.push(`category: ${yamlString(skill.category)}`);
  // ... campos opcionales: author, version, tags, model, etc.
  lines.push(`installed-at: ${yamlString(installedAt)}`);
  lines.push('---');
  lines.push('');
  lines.push(skill.content ?? '');
  return lines.join('\n');
}
```

---

## 4. Inyección en contexto de IA

El sistema usa **dos vías complementarias** para que la IA conozca las skills:

### 4.1 Vía 1: System prompt (lista de skills)

**Archivo:** `src/main/services/ai/systemPromptBuilder.ts` (línea 216)
**Archivo:** `src/main/services/ai/skillsContextBuilder.ts` — `buildSkillsContext()` (línea 11)

```typescript
// systemPromptBuilder.ts, línea 216-219
const skillsSection = buildSkillsContext(skills ?? []);
if (skillsSection) {
  systemPrompt += skillsSection;
}
```

El texto generado tiene esta forma:

```
# Available Skills
The following skills are available. Use the skill_execute tool to load and
follow a skill's instructions when relevant:
- coding/git-commit: Git Commit Helper
- coding/debugging: Advanced Debugging Techniques
- development/react-patterns: React Design Patterns
```

**Presupuesto máximo:** 4000 tokens (`SKILLS_TOKEN_BUDGET`, línea 9). Si la lista supera ese límite, se trunca priorizando las primeras skills (orden alfabético).

### 4.2 Vía 2: Tool `skill_execute`

**Archivo:** `src/main/services/ai/skillsContextBuilder.ts` — `createSkillTool()` (línea 34)
**Registro:** `src/main/services/ai/builtInTools.ts` (línea 67)

La IA puede invocar la tool cuando necesite las instrucciones completas de una skill:

```typescript
// Input schema del tool
{
  skill: z.string(),          // ID ("coding/git-commit") o nombre ("Git Commit Helper")
  args: z.string().optional() // Contexto adicional
}

// Output del tool
{
  skillId: "coding/git-commit",
  skillName: "Git Commit Helper",
  instructions: "# Contenido completo del archivo .md",
  args?: "argumentos opcionales"
}
```

**Estrategia de búsqueda al ejecutar** (líneas 64-81):

| Prioridad | Estrategia | Ejemplo |
|-----------|-----------|---------|
| 1 | ID exacto | `"coding/git-commit"` |
| 2 | Nombre exacto (case-insensitive) | `"Git Commit Helper"` |
| 3 | Segmento final del ID | `"git-commit"` coincide con `"coding/git-commit"` |

### 4.3 Punto de carga: antes de cada chat

**Archivo:** `src/main/services/aiService.ts` (línea 1039)

```typescript
// Carga skills en CADA inicio de chat
let installedSkills: InstalledSkill[] = [];
try {
  installedSkills = await skillsService.listInstalledSkills();
} catch (error) { /* continúa sin skills */ }

const builtInTools = await getBuiltInTools({
  ...builtInToolsConfig,
  skills: installedSkills, // ← skills inyectadas
});
```

Esto garantiza que las skills recién instaladas estén disponibles sin reiniciar la app.

### 4.4 Diagrama de inyección

```
AIService.streamText()  (aiService.ts, línea 1188)
    │
    ├─ [A] listInstalledSkills()
    │        └─ Escanea ~/levante/skills/
    │
    ├─ [B] buildSystemPrompt({ skills })
    │        └─ buildSkillsContext(skills)
    │             └─ "# Available Skills\n- id: name\n..."
    │
    └─ [C] getBuiltInTools({ skills })
             └─ createSkillTool(skills)
                  └─ Tool: skill_execute
                       ├─ description: "Execute a skill..."
                       ├─ inputSchema: { skill, args? }
                       └─ execute: busca en installedSkills
                                   retorna instructions completas

streamText({
  model,
  messages,
  system: "...# Available Skills\n- coding/git-commit: ...",
  tools: { skill_execute: Tool, ...otherTools }
})
```

---

## 5. Flujo de deep link

Permite instalar skills desde URLs externas (e.g., desde el marketplace web):

```
levante://skill/install?id=coding%2Fgit-commit
```

**Archivo:** `src/renderer/App.tsx` (línea 1594)

```
1. Sistema operativo lanza la app con la URL
2. deepLinkService.parseDeepLink() detecta tipo "skill-install"
3. App navega a la página Skills
4. loadCatalog() + loadInstalled() en paralelo
5. Busca skill en catalog por skillId
6. Abre SkillInstallDeepLinkModal con los detalles
7. Usuario confirma → llama installSkill() (Flujo estándar)
```

**Archivo del modal:** `src/renderer/components/skills/SkillInstallDeepLinkModal.tsx`

---

## 6. Mapa de archivos críticos

### Tipos

| Archivo | Responsabilidad |
|---------|----------------|
| `src/types/skills.ts` | Interfaces compartidas: `SkillDescriptor`, `InstalledSkill`, `SkillBundleResponse` |

### Main process

| Archivo | Líneas clave | Responsabilidad |
|---------|-------------|----------------|
| `src/main/services/skillsService.ts` | 48-272, 318-377 | Gestión completa: catálogo, instalación, listado, desinstalación |
| `src/main/ipc/skillsHandlers.ts` | 19-116 | Handlers IPC: getCatalog, getBundle, install, uninstall, listInstalled |
| `src/main/services/ai/skillsContextBuilder.ts` | 11-106 | Construye sección del prompt y tool `skill_execute` |
| `src/main/services/ai/builtInTools.ts` | 47-77 | Registra `skill_execute` junto a otros built-in tools |
| `src/main/services/ai/systemPromptBuilder.ts` | 216-219 | Incluye sección skills en el system prompt |
| `src/main/services/aiService.ts` | 1039-1055 | Carga installedSkills antes de cada streamText() |

### Preload (bridge)

| Archivo | Responsabilidad |
|---------|----------------|
| `src/preload/api/skills.ts` | Expone API de skills al renderer via `ipcRenderer.invoke` |
| `src/preload/preload.ts` (línea 68) | Registra `skillsApi` en la API global `window.levante` |

### Renderer

| Archivo | Responsabilidad |
|---------|----------------|
| `src/renderer/stores/skillsStore.ts` | Zustand store: catalog, installedSkills, actions |
| `src/renderer/pages/SkillsPage.tsx` | Página principal con grid y handlers |
| `src/renderer/components/skills/SkillCard.tsx` | Card con botones install/uninstall |
| `src/renderer/components/skills/SkillDetailsModal.tsx` | Modal con detalles completos |
| `src/renderer/components/skills/SkillInstallDeepLinkModal.tsx` | Modal de confirmación para deep link |
| `src/renderer/App.tsx` (línea 1594) | Handler de deep link skill-install |

---

## 7. Seguridad y validaciones

### 7.1 Sanitización de rutas

**Archivo:** `src/main/services/skillsService.ts` (línea 48)

```typescript
function sanitizePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_') // Solo caracteres seguros
    .replace(/\.{2,}/g, '_')           // Previene path traversal con ".."
    .replace(/^\.+/, '')               // Elimina puntos al inicio
    .slice(0, 120);                    // Limita longitud
}
```

Garantiza que un `skillId` malicioso como `"../../etc/passwd"` no pueda escribir fuera de `~/levante/skills/`.

### 7.2 Validación de frontmatter

```typescript
// skillsService.ts, línea 101
const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
if (!match) throw new Error('Invalid skill file: missing YAML frontmatter');
```

### 7.3 Escritura atómica del cache

```typescript
// Evita archivos de cache corruptos si el proceso muere a mitad
const tmpPath = `${cachePath}.tmp`;
await fs.writeFile(tmpPath, JSON.stringify(cacheEntry), 'utf-8');
await fs.rename(tmpPath, cachePath); // rename es atómico en el mismo filesystem
```

### 7.4 Timeout en peticiones remotas

```typescript
// Timeout de 10 segundos para fetch del catálogo y bundles
const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
```
