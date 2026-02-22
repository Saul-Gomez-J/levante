# Correcciones del sistema de Skills — Comparación con referencia open-claude-code

Análisis de las diferencias entre la implementación actual y la implementación de referencia.
Las correcciones están ordenadas por criticidad.

---

## Corrección 1 — `SKILL.md` vs `skill.md` (CRÍTICA)

### Problema

`skillsService.ts` busca el archivo principal de cada skill con el nombre `SKILL.md` (mayúsculas):

```typescript
// skillsService.ts:161
const filePath = path.join(skillDir, 'SKILL.md');

// skillsService.ts:363
await fs.access(path.join(skillDir, 'SKILL.md'));
```

El comentario en el mismo archivo (línea 304) dice:
```
// Write all files from bundle.files as-is (includes SKILL.md and companion files)
```

La convención acordada es que el archivo principal se llama `skill.md` (minúsculas). El servidor de bundles envía los archivos con ese nombre. En macOS el sistema de archivos es insensible a mayúsculas, por lo que funciona accidentalmente. En Linux (contenedores, CI, servidores de producción) fallará silenciosamente — la skill se instala pero nunca se puede leer.

### Referencia (open-claude-code)

El archivo principal de cada skill es siempre el `.md` que está en `.claude/skills/{name}.md`, sin convención de nombre especial más allá del nombre de la skill. La clave es la consistencia entre escritura y lectura.

### Corrección

Cambiar todas las referencias `'SKILL.md'` por `'skill.md'` en `skillsService.ts`:

```typescript
// skillsService.ts:161 → cambiar a:
const filePath = path.join(skillDir, 'skill.md');

// skillsService.ts:317 → cambiar a:
const filePath = path.join(skillDir, 'skill.md');

// skillsService.ts:363 → cambiar a:
await fs.access(path.join(skillDir, 'skill.md'));
```

**Archivos afectados:** `src/main/services/skillsService.ts`

---

## Corrección 2 — Formato del `tool_result`: JSON wrapper vs contenido directo (IMPORTANTE)

### Problema

`createSkillTool.execute()` en `skillsContextBuilder.ts` devuelve el contenido de la skill **envuelto en un objeto JSON**:

```typescript
// skillsContextBuilder.ts:98-103
return {
  skillId: found.id,
  skillName: found.name,
  instructions: found.content,   // ← el agente debe "desempaquetar"
  ...(args ? { args } : {}),
};
```

Lo que el agente recibe como `tool_result`:
```json
{
  "skillId": "coding/git-commit",
  "skillName": "Git Commit",
  "instructions": "# Git Commit Best Practices\n\nFollow these steps..."
}
```

El agente tiene que inferir que debe leer el campo `instructions` para obtener sus instrucciones. Esto añade una capa de indirección innecesaria y puede hacer que el agente responda al JSON en lugar de seguir las instrucciones.

### Referencia (open-claude-code)

```javascript
// skill.mjs:205-209
} else if (skillDef.content) {
  output = typeof skillDef.content === 'function'
    ? await skillDef.content(args)
    : skillDef.content    // ← el body del .md como string plano
}

// skill.mjs:107-109
renderResultForAssistant({ skill, output, error }) {
  if (error) return `Skill error: ${error}`
  return output || `Skill "${skill}" executed successfully.`
}
```

El agente recibe el body del markdown **directamente**, sin envoltorio. Las instrucciones son el resultado completo del tool_result.

### Corrección

Cambiar `execute()` para devolver el contenido directamente como string:

```typescript
// skillsContextBuilder.ts:98-103 → cambiar a:
return found.content;
// O, si se quiere añadir el contexto del args:
return args
  ? `${found.content}\n\n---\nContext provided: ${args}`
  : found.content;
```

El Vercel AI SDK pasa el string directamente en el `tool_result` sin envoltorio adicional.

**Archivos afectados:** `src/main/services/ai/skillsContextBuilder.ts`

---

## Corrección 3 — Filtrado por `userInvocable` en el system prompt (MENOR)

### Problema

`buildSkillsContext()` en `skillsContextBuilder.ts` incluye **todas las skills instaladas** en el system prompt, ignorando el campo `userInvocable`:

```typescript
// skillsContextBuilder.ts:12
// Decisión cerrada: no filtrar por userInvocable.
```

### Referencia (open-claude-code)

```javascript
// skills-discovery.mjs:192-213
// Para cada skill userInvocable:
const desc = skill.description || skill.prompt.slice(0, 100)
```

Solo las skills con `userInvocable: true` (que es el valor por defecto) aparecen en el system prompt. Las skills de agente interno o de soporte no expuestas al usuario no deberían listarse.

### Corrección

```typescript
// skillsContextBuilder.ts — en buildSkillsContext():
for (const skill of skills) {
  // Solo incluir skills que el usuario puede invocar (default: true)
  if (skill.userInvocable === false) continue;

  const desc = skill.description?.trim() || skill.content.slice(0, 100).replace(/\n/g, ' ');
  // ...
}
```

**Nota**: Si actualmente ninguna skill tiene `userInvocable: false`, este cambio no tiene efecto visible pero alinea la implementación con el estándar para cuando haya skills internas.

**Archivos afectados:** `src/main/services/ai/skillsContextBuilder.ts`

---

## Corrección 4 — La descripción de la tool en el system prompt no usa formato slash-command (MENOR)

### Problema

El texto en el system prompt actual:

```
# Available Skills
The following skills are available. Use the skill_execute tool to load and follow a skill's instructions when relevant:
- coding/git-commit: Provides a guided process...
```

El agente ve el `id` de la skill (`coding/git-commit`) sin formato de slash command.

### Referencia (open-claude-code)

```
# Available Skills
The following skills are available as slash commands:
- /commit: Create and push git commits with AI assistance
```

El agente ve el nombre corto con prefijo `/`, que le indica explícitamente cómo el usuario puede invocarlo.

### Corrección

Dos opciones:

**Opción A** — Mostrar el nombre corto con `/` (más cercano a la referencia):
```typescript
const shortName = skill.id.split('/').pop() ?? skill.id;
const entry = `- /${shortName}: ${desc}`;
```

**Opción B** — Mantener el ID completo pero aclarar la invocación (mejor para IDs con categoría):
```typescript
const entry = `- ${skill.id} (/${skill.id.split('/').pop()}): ${desc}`;
```

**Nota**: Dado que Levante usa IDs con categoría (`coding/git-commit`) en lugar de nombres planos (`commit`), la Opción A podría causar ambigüedades si hay `coding/commit` y `writing/commit`. La Opción B es más segura para este caso.

**Archivos afectados:** `src/main/services/ai/skillsContextBuilder.ts`

---

## Corrección 5 — `allowedTools` no se comunica al agente (MENOR)

### Problema

El tipo `InstalledSkill` tiene el campo `allowedTools?: string`, y `createSkillTool.execute()` lo lee (`found.allowedTools`) pero no se comunica al agente en el resultado:

```typescript
// Actual: allowedTools existe en InstalledSkill pero no se usa al retornar
return {
  skillId: found.id,
  skillName: found.name,
  instructions: found.content,
  // ← found.allowedTools no se menciona
};
```

### Referencia (open-claude-code)

```javascript
skillDef = {
  content: discovered.prompt,
  allowedTools: discovered.allowedTools,   // ← se pasa al executor
  context: discovered.context,
}
```

El executor de open-claude-code usa `allowedTools` para restringir qué herramientas puede usar el agente durante la ejecución de la skill.

### Corrección mínima

Incluir `allowedTools` en el resultado si está definido, para que el agente lo tome en cuenta:

```typescript
// Con la corrección 2 aplicada (string plano), añadir al final del contenido:
const allowedToolsNote = found.allowedTools
  ? `\n\n---\nDuring this skill execution, only use these tools: ${found.allowedTools}`
  : '';

return `${found.content}${allowedToolsNote}`;
```

**Nota**: La implementación completa requeriría restricción a nivel de executor (como hace open-claude-code), lo cual es más complejo y puede quedar como mejora futura.

**Archivos afectados:** `src/main/services/ai/skillsContextBuilder.ts`

---

## Corrección 6 — Campo `once` no implementado (BACKLOG)

### Problema

El tipo `InstalledSkill` no tiene el campo `once`. La referencia lo define como "ejecutar solo una vez por sesión".

### Referencia (open-claude-code)

```javascript
once,  // ejecutar solo una vez por sesión
```

Si `once: true`, la skill no debería poder invocarse dos veces en la misma conversación.

### Corrección

1. Añadir `once?: boolean` al tipo `SkillDescriptor` en `src/types/skills.ts`
2. Parsearlo del frontmatter en `parseFrontmatter()` de `skillsService.ts`
3. En `createSkillTool.execute()`, mantener un `Set<string>` de skills ya ejecutadas en la sesión actual y devolver un error si se intenta re-ejecutar

**Archivos afectados:** `src/types/skills.ts`, `src/main/services/skillsService.ts`, `src/main/services/ai/skillsContextBuilder.ts`

---

## Resumen de correcciones por prioridad

| # | Corrección | Prioridad | Archivos |
|---|-----------|-----------|---------|
| 1 | `SKILL.md` → `skill.md` | CRÍTICA | `skillsService.ts` |
| 2 | `tool_result` como string directo, no JSON wrapper | IMPORTANTE | `skillsContextBuilder.ts` |
| 3 | Filtrar por `userInvocable` en system prompt | MENOR | `skillsContextBuilder.ts` |
| 4 | Formato de entrada en system prompt (slash vs ID) | MENOR | `skillsContextBuilder.ts` |
| 5 | Comunicar `allowedTools` al agente en el resultado | MENOR | `skillsContextBuilder.ts` |
| 6 | Implementar campo `once` | BACKLOG | Múltiples |

---

## Lo que está correcto en la implementación actual

Los siguientes aspectos están alineados con la referencia y **no requieren cambio**:

- **Estructura de directorios**: `{scope}/{name}/skill.md` — directorio por skill, correcto
- **Presupuesto de tokens**: 4000 tokens para el fragmento de skills en el system prompt, igual que la referencia
- **Lazy loading**: El body completo solo llega al agente vía `tool_result`, no en el system prompt
- **Resolución de nombre**: Busca por ID exacto → nombre → segmento del ID (3 pasos), robusto
- **Scope merge**: Proyecto sobreescribe global por `skill.id`, correcto
- **Frontmatter parsing**: Lee `id`, `name`, `description`, `category`, `user-invocable`, `installed-at`, correcto
- **Budget de 4000 tokens** en `buildSkillsContext()`: igual que la referencia
- **`context: fork`**: No implementado, pero tampoco lo está en la referencia completa (lo parsean, no lo usan)
