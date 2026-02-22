# Flujo de inyección de Skills en el prompt del agente

> Investigación completa del flujo desde que se instala una skill hasta lo que ve el modelo de IA.

---

## 1. Tipos de datos principales

**Archivo:** `src/types/skills.ts`

```typescript
export interface SkillDescriptor {
  id: string;          // Formato: "category/name" (e.g., "coding/git-commit")
  name: string;
  description: string;
  category: string;
  author?: string;
  version?: string;
  content: string;     // Markdown sin frontmatter — esto es lo que lee el agente
  // ...otros campos
}

export interface InstalledSkill extends SkillDescriptor {
  installedAt: string;       // ISO 8601
  filePath: string;          // Ruta completa al .md en disco
  scope: SkillScope;         // 'global' | 'project'
  projectId?: string;
  scopedKey: string;         // "{scope}:{projectId|global}:{skillId}"
}
```

---

## 2. Almacenamiento en disco

Cuando se instala una skill, `skillsService.installSkill()` la guarda como un `.md` con frontmatter YAML:

```
~/levante/skills/{category}/{name}.md          ← scope global
{projectCwd}/.levante/skills/{category}/{name}.md  ← scope proyecto
```

Formato del archivo en disco:
```markdown
---
id: "coding/git-commit"
name: "Git Commit"
description: "Guided process for well-structured commits"
category: "coding"
author: "levante"
version: "1.0.0"
installed-at: "2026-02-22T10:00:00.000Z"
---

# Git Commit Best Practices

Follow these steps to create an effective commit...

1. Stage your changes
2. Write a meaningful message...
```

---

## 3. Flujo completo de inyección

### Paso 1 — El usuario envía un mensaje

`src/renderer/pages/ChatPage.tsx` captura el `projectId` activo y lo pasa al transport:

```typescript
// src/renderer/transports/ElectronChatTransport.ts (Lines 119-135)
const request: ChatRequest = {
  messages,
  model,
  ...(projectId && {
    projectContext: { projectId }   // ← Se propaga al main process
  }),
};
```

---

### Paso 2 — `aiService.streamChat()` carga las skills instaladas

`src/main/services/aiService.ts` (Lines 1043-1066):

```typescript
const projectId = projectContext?.projectId;

const installedSkills = await skillsService.listInstalledSkills(
  projectId
    ? { mode: 'project-merged', projectId }  // Global + proyecto (proyecto overrides)
    : { mode: 'global' }                      // Solo global
);
```

El modo `'project-merged'` aplica la siguiente lógica de merge:
- Las skills globales se cargan primero.
- Las skills del proyecto sobreescriben por `skill.id` si hay colisión.
- El agente siempre ve la versión más específica.

---

### Paso 3 — Se registra la herramienta `skill_execute`

`src/main/services/ai/builtInTools.ts` (Lines 47-77):

```typescript
if (config?.skills && config.skills.length > 0) {
  tools['skill_execute'] = createSkillTool(config.skills);
}
```

La herramienta `skill_execute` recibe en memoria la lista completa de `InstalledSkill[]`. Cuando el agente la invoca, busca por ID o nombre y devuelve el `content` completo de la skill.

---

### Paso 4 — Se construye el system prompt con la sección de skills

`src/main/services/ai/systemPromptBuilder.ts` llama a:

```typescript
const skillsSection = buildSkillsContext(skills ?? []);
if (skillsSection) {
  systemPrompt += skillsSection;
}
```

`buildSkillsContext()` en `src/main/services/ai/skillsContextBuilder.ts`:

```typescript
export function buildSkillsContext(skills: InstalledSkill[]): string {
  const SKILLS_TOKEN_BUDGET = 4000;  // Presupuesto máximo en tokens

  const entries: string[] = [];
  let usedTokens = 0;

  for (const skill of skills) {
    const desc = skill.description?.trim() || skill.content.slice(0, 100);
    const entry = `- ${skill.id}: ${desc}`;
    const tokens = Math.ceil(entry.length / 4);

    if (usedTokens + tokens > SKILLS_TOKEN_BUDGET) break;

    entries.push(entry);
    usedTokens += tokens;
  }

  return `\n# Available Skills\nThe following skills are available. Use the skill_execute tool to load and follow a skill's instructions when relevant:\n${entries.join('\n')}\n`;
}
```

---

### Paso 5 — El modelo recibe el prompt + tool

`streamText()` recibe:
- `system`: prompt completo (con sección de skills al final)
- `tools`: objeto que incluye `skill_execute`
- `messages`: historial de la conversación

---

## 4. Diagrama del flujo

```
Usuario envía mensaje
        │
        ▼
ChatPage.tsx  ──── projectId ────►  ElectronChatTransport.ts
                                            │
                                            ▼ IPC
                                    aiService.streamChat()
                                            │
                          ┌─────────────────┼──────────────────┐
                          ▼                                     ▼
             skillsService.listInstalledSkills()     buildSystemPrompt()
             (scope-aware: global | project-merged)       │
                          │                                     │
                          ▼                                     ▼
             InstalledSkill[]  ──────────►  buildSkillsContext()
                          │                (genera "# Available Skills\n- id: desc...")
                          │                                     │
                          ▼                                     │
             createSkillTool(skills)                            │
             (registra skill_execute)                           │
                          │                                     │
                          └──────────── streamText() ◄──────────┘
                                         │ system prompt
                                         │ tools { skill_execute, ... }
                                         │ messages
                                         ▼
                                    MODELO DE IA
                                         │
                          ┌──────────────┴──────────────┐
                          │  Ve skills en system prompt  │
                          │  Invoca skill_execute(id)    │
                          └──────────────┬──────────────┘
                                         │
                                         ▼
                              createSkillTool.execute()
                              Busca por id/name en memoria
                              Devuelve { skillId, skillName, instructions }
                                         │
                                         ▼
                              El agente lee el markdown completo
                              y sigue las instrucciones
```

---

## 5. Lo que ve exactamente el agente

### 5a. En el system prompt (resumen de skills disponibles)

Con 3 skills instaladas, al final del system prompt el agente ve:

```
# Available Skills
The following skills are available. Use the skill_execute tool to load and follow a skill's instructions when relevant:
- coding/git-commit: Provides a guided process for creating well-structured git commits with detailed commit messages
- coding/email-pro: Professional email composition best practices for business communication
- utils/data-transform: Transform and manipulate data formats efficiently
```

> Solo `id` y `description` (o primeros 100 chars del content). Budget máximo: 4000 tokens.

---

### 5b. Al invocar `skill_execute`

El agente llama:
```json
{
  "tool": "skill_execute",
  "args": {
    "skill": "coding/git-commit",
    "args": "feature branch, small change"
  }
}
```

Y recibe el resultado:
```json
{
  "skillId": "coding/git-commit",
  "skillName": "Git Commit",
  "instructions": "# Git Commit Best Practices\n\nFollow these steps...\n\n1. Stage your changes carefully\n2. Write a meaningful subject line (50 chars max)\n3. Use imperative mood: 'Add feature' not 'Added feature'\n4. Include body for complex changes\n...",
  "args": "feature branch, small change"
}
```

El campo `instructions` contiene el **markdown completo** de la skill (todo lo que hay tras el frontmatter YAML).

---

### 5c. Ejemplo con múltiples skills — vista completa del system prompt (extracto)

```
You are a helpful assistant. Today's date is Saturday, February 22, 2026...

[personalización del usuario, contexto del proyecto, capacidades MCP...]

PROJECT CONTEXT:
My Electron app for desktop AI chat. Uses React, TypeScript, SQLite.

# Available Skills
The following skills are available. Use the skill_execute tool to load and follow a skill's instructions when relevant:
- coding/git-commit: Guided process for creating well-structured git commits
- coding/code-review: Best practices for reviewing pull requests and suggesting improvements
- writing/changelog: Format and write changelog entries following Keep a Changelog spec
- utils/regex-builder: Step-by-step regex construction with explanation

You have access to specialized tools through the Model Context Protocol (MCP)...
```

---

## 6. Resolución de skills por nombre

`createSkillTool.execute()` en `src/main/services/ai/skillsContextBuilder.ts` intenta localizar la skill en 3 pasos:

```typescript
// 1. Coincidencia exacta por ID
let found = skills.find(s => s.id === skill);

// 2. Coincidencia exacta por nombre (case-insensitive)
if (!found) found = skills.find(s => s.name.toLowerCase() === skill.toLowerCase());

// 3. Coincidencia parcial: parte después de "/" en el ID
if (!found) {
  const namePart = skill.includes('/') ? skill.split('/').pop()! : skill;
  found = skills.find(s => {
    const idName = s.id.split('/').pop() ?? '';
    return idName.toLowerCase() === namePart.toLowerCase()
        || s.name.toLowerCase() === namePart.toLowerCase();
  });
}
```

Esto permite que el agente invoque con `"git-commit"`, `"Git Commit"` o `"coding/git-commit"` y obtenga el mismo resultado.

---

## 7. Archivos clave y líneas de referencia

| Propósito | Archivo | Líneas |
|-----------|---------|--------|
| Tipos `SkillDescriptor`, `InstalledSkill` | `src/types/skills.ts` | 1-87 |
| Instalación y listado de skills | `src/main/services/skillsService.ts` | 260-614 |
| Handlers IPC | `src/main/ipc/skillsHandlers.ts` | 24-148 |
| Carga de skills + llamada a prompt builder | `src/main/services/aiService.ts` | 1043-1211 |
| Construcción del system prompt | `src/main/services/ai/systemPromptBuilder.ts` | 11-239 |
| `buildSkillsContext` + `createSkillTool` | `src/main/services/ai/skillsContextBuilder.ts` | 11-106 |
| Registro de `skill_execute` tool | `src/main/services/ai/builtInTools.ts` | 47-77 |
| API preload | `src/preload/api/skills.ts` | 13-34 |
| Store Zustand (renderer) | `src/renderer/stores/skillsStore.ts` | 42-173 |
| Paso de `projectContext` via IPC | `src/renderer/transports/ElectronChatTransport.ts` | 119-135 |

---

## 8. Notas de diseño

- **Lazy loading del contenido**: El agente solo recibe el `content` completo de una skill cuando invoca `skill_execute`. El system prompt solo contiene el resumen (`id: description`) para ahorrar tokens.
- **Budget de 4000 tokens**: Si hay muchas skills instaladas, las que excedan el presupuesto se omiten del system prompt (pero siguen disponibles via `skill_execute` si el agente las conoce por otro medio).
- **Scope merge**: Las skills de proyecto tienen prioridad sobre las globales con el mismo ID. Útil para personalizar comportamientos por proyecto.
- **Tool siempre disponible**: `skill_execute` se registra incluso si hay 0 skills — aunque en ese caso el code path en `builtInTools.ts` lo omite (`config.skills.length > 0`).
