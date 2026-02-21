# Runbook de implementación: Skills en el contexto del agente

## 1) Objetivo funcional
Hacer que todas las skills instaladas en `~/levante/skills/{category}/{name}.md`:
1. Sean visibles para el agente en el `system prompt` al inicio de cada conversación.
2. Se puedan ejecutar mediante una tool dedicada (`skill_execute`).
3. Se usen tanto por invocación explícita del usuario como por decisión autónoma del agente.

Estado actual: las skills se instalan/listan correctamente, pero no se inyectan en el contexto del agente.

---

## 2) Decisiones cerradas para esta implementación
Estas decisiones son obligatorias en esta versión:

1. **Mostrar todas las skills sin filtrar**.
   No se filtra por `userInvocable`. Si la skill está instalada, se expone al agente.

2. **`sendSingleMessage()` queda fuera de alcance**.
   No se modifica. Solo se implementa en el flujo de `streamChat()`.

3. **Se asume riesgo de prompt injection en descripciones**.
   No se añade saneamiento extra en esta versión.

4. **Se asume riesgo de colisión de nombres**.
   No se implementa desambiguación. Se mantiene estrategia “primera coincidencia”.

5. **Cualquier skill instalada puede ejecutarse**.
   No hay restricciones adicionales en `skill_execute`.

6. **Se acepta presupuesto fijo de tokens para skills**.
   No se ajusta dinámicamente por modelo/context window en esta versión.

7. **No se limita tamaño de `instructions` devuelto por la tool**.
   La calidad/longitud de la skill es responsabilidad del creador de la skill.

8. **El agente debe consultar skill primero cuando detecte que aplica**.
   La descripción de tool debe reforzar ejecución inmediata.

9. **No se toca robustez adicional de parser/listado existente**.
   Se reutiliza tal cual la infraestructura actual.

---

## 3) Alcance exacto

### Incluido
- Crear módulo nuevo para:
  - construir sección `# Available Skills` del system prompt,
  - construir tool `skill_execute`.
- Registrar `skill_execute` como built-in tool cuando existan skills.
- Cargar skills instaladas en `streamChat()` y pasarlas:
  - a `getBuiltInTools(...)`,
  - a `buildSystemPrompt(...)`.

### Excluido
- Cambios en renderer/UI.
- Cambios en `skillsService`/parser.
- Cambios en `sendSingleMessage()`.
- Soporte de skills por proyecto (`.levante/skills`).

---

## 4) Componentes existentes que se reutilizan
- `src/main/services/skillsService.ts`
  - `listInstalledSkills()`
  - singleton `skillsService`
- `src/types/skills.ts`
  - `InstalledSkill`
  - `SkillDescriptor`
- `src/main/services/directoryService.ts`
  - `getSubdirPath('skills')`

No reimplementar lectura de disco de skills.

---

## 5) Arquitectura resultante

```text
streamChat()
  -> skillsService.listInstalledSkills()
  -> getBuiltInTools({ mermaidValidation, mcpDiscovery, skills })
       -> registra skill_execute si skills.length > 0
  -> buildSystemPrompt(..., skills)
       -> añade sección # Available Skills
  -> streamText({ tools, system, messages, ... })

Durante la ejecución:
  Modelo llama skill_execute({ skill, args? })
  -> tool localiza la skill instalada
  -> devuelve { skillId, skillName, instructions, args? }
  -> modelo sigue instrucciones de la skill
```

---

## 6) Cambios por archivo (implementación detallada)

## 6.1 Crear `src/main/services/ai/skillsContextBuilder.ts`
Responsabilidades:
1. Construir sección de prompt con skills instaladas.
2. Definir tool `skill_execute` para AI SDK.

Implementar exactamente este módulo:

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import type { InstalledSkill } from '../../../types/skills';
import { getLogger } from '../logging';

const logger = getLogger();

// Presupuesto fijo aceptado para esta versión.
const SKILLS_TOKEN_BUDGET = 4000;

export function buildSkillsContext(skills: InstalledSkill[]): string {
  // Decisión cerrada: no filtrar por userInvocable.
  if (skills.length === 0) return '';

  let usedTokens = 0;
  const entries: string[] = [];

  for (const skill of skills) {
    const desc = skill.description?.trim() || skill.content.slice(0, 100).replace(/\n/g, ' ');
    const entry = `- ${skill.id}: ${desc}`;
    const tokens = Math.ceil(entry.length / 4);

    if (usedTokens + tokens > SKILLS_TOKEN_BUDGET) break;

    entries.push(entry);
    usedTokens += tokens;
  }

  if (entries.length === 0) return '';

  return `\n# Available Skills\nThe following skills are available. Use the skill_execute tool to load and follow a skill's instructions when relevant:\n${entries.join('\n')}\n`;
}

export function createSkillTool(skills: InstalledSkill[]) {
  return tool({
    description: `Execute a skill to help complete the user's task.

Use this tool when:
- The user explicitly asks to use a skill by name or ID (e.g., "use the git-commit skill", "run coding/email-pro")
- You identify that an available skill matches the user's request and would help complete it more effectively

How to identify the right skill:
- Match by exact skill ID (e.g., "coding/git-commit")
- Match by skill name (case insensitive)
- Match by the name segment after "/" (e.g., "git-commit" matches "coding/git-commit")

Important:
- When a skill is relevant, invoke this tool IMMEDIATELY as your first action
- After receiving the skill content, read and follow its instructions carefully
- Do not invoke a skill that is already running in the current turn`,

    inputSchema: z.object({
      skill: z.string().describe(
        'The skill ID (e.g., "coding/git-commit") or name (e.g., "git-commit"). Use the exact ID from the Available Skills list when possible.'
      ),
      args: z.string().optional().describe('Optional arguments or context to pass to the skill'),
    }),

    execute: async ({ skill, args }) => {
      logger.aiSdk.info('Skill tool invoked', { skill, hasArgs: !!args });

      let found: InstalledSkill | undefined;

      // 1) ID exacto
      found = skills.find((s) => s.id === skill);

      // 2) Nombre exacto (case insensitive)
      if (!found) {
        found = skills.find((s) => s.name.toLowerCase() === skill.toLowerCase());
      }

      // 3) Segmento final del ID (tras '/') o nombre
      if (!found) {
        const namePart = skill.includes('/') ? skill.split('/').pop()! : skill;
        found = skills.find((s) => {
          const idName = s.id.split('/').pop() ?? '';
          return (
            idName.toLowerCase() === namePart.toLowerCase() ||
            s.name.toLowerCase() === namePart.toLowerCase()
          );
        });
      }

      if (!found) {
        const available = skills.map((s) => `${s.id} ("${s.name}")`).join(', ');
        logger.aiSdk.warn('Skill not found', { requested: skill });
        return {
          error: `Skill "${skill}" not found.`,
          availableSkills: available || 'No skills installed',
        };
      }

      logger.aiSdk.info('Skill loaded', {
        skillId: found.id,
        contentLength: found.content.length,
      });

      return {
        skillId: found.id,
        skillName: found.name,
        instructions: found.content,
        ...(args ? { args } : {}),
      };
    },
  });
}
```

---

## 6.2 Modificar `src/main/services/ai/builtInTools.ts`

### A) Imports
Agregar:
```typescript
import type { InstalledSkill } from '../../../types/skills';
import { createSkillTool } from './skillsContextBuilder';
```

### B) Extender configuración
Actualizar interfaz:
```typescript
export interface BuiltInToolsConfig {
  mermaidValidation: boolean;
  mcpDiscovery: boolean;
  skills?: InstalledSkill[];
}
```

### C) Registrar tool
Dentro de `getBuiltInTools(config?)`, después de las tools existentes:
```typescript
if (config?.skills && config.skills.length > 0) {
  tools['skill_execute'] = createSkillTool(config.skills);
  logger.aiSdk.debug('Skill tool registered', { skillCount: config.skills.length });
}
```

Mantener el log final `Built-in tools created`.

---

## 6.3 Modificar `src/main/services/ai/systemPromptBuilder.ts`

### A) Imports
Agregar:
```typescript
import type { InstalledSkill } from '../../../types/skills';
import { buildSkillsContext } from './skillsContextBuilder';
```

### B) Firma de `buildSystemPrompt(...)`
Agregar parámetro opcional al final:
```typescript
projectDescription?: string,
skills?: InstalledSkill[]
```

### C) Inyección de sección de skills
Antes del log final y antes del `return`:
```typescript
const skillsSection = buildSkillsContext(skills ?? []);
if (skillsSection) {
  systemPrompt += skillsSection;
}
```

No tocar el resto de secciones existentes (personalization, MCP discovery, Mermaid, etc.).

---

## 6.4 Modificar `src/main/services/aiService.ts` (solo `streamChat`)

### A) Imports
Agregar:
```typescript
import type { InstalledSkill } from '../../types/skills';
import { skillsService } from './skillsService';
```

### B) Carga de skills instaladas en `streamChat()`
Ubicar bloque donde se construyen built-in tools y añadir antes de `getBuiltInTools(...)`:

```typescript
let installedSkills: InstalledSkill[] = [];
try {
  installedSkills = await skillsService.listInstalledSkills();
  this.logger.aiSdk.debug('Loaded installed skills for agent context', {
    count: installedSkills.length,
    ids: installedSkills.map((s) => s.id),
  });
} catch (error) {
  this.logger.aiSdk.warn('Failed to load installed skills', {
    error: error instanceof Error ? error.message : String(error),
  });
}
```

### C) Pasar skills a built-in tools
Cambiar la llamada:
```typescript
const builtInTools = await getBuiltInTools({
  ...builtInToolsConfig,
  skills: installedSkills,
});
```

### D) Pasar skills al system prompt
En `streamText({...})`, cambiar `buildSystemPrompt(...)` para incluir `installedSkills` al final:
```typescript
system: await buildSystemPrompt(
  webSearch,
  enableMCP,
  Object.keys(tools).length,
  builtInToolsConfig.mermaidValidation,
  builtInToolsConfig.mcpDiscovery,
  projectDescription,
  installedSkills
),
```

### E) Restricción explícita
No modificar `sendSingleMessage()` en esta implementación.

---

## 7) Contratos de comportamiento

## 7.1 Sección esperada en system prompt
Con skills instaladas, el prompt debe incluir:

```text
# Available Skills
The following skills are available. Use the skill_execute tool to load and follow a skill's instructions when relevant:
- coding/git-commit: Crea commits de git con mensajes descriptivos
- writing/email-pro: Redacta emails profesionales
```

Si no hay skills, no se añade esa sección.

## 7.2 Tool contract: `skill_execute`
Input:
```json
{ "skill": "coding/git-commit", "args": "optional" }
```

Output éxito:
```json
{
  "skillId": "coding/git-commit",
  "skillName": "Git Commit",
  "instructions": "...contenido completo markdown...",
  "args": "optional"
}
```

Output error:
```json
{
  "error": "Skill \"x\" not found.",
  "availableSkills": "coding/git-commit (\"Git Commit\"), ..."
}
```

---

## 8) Orden de implementación recomendado
1. Crear `skillsContextBuilder.ts`.
2. Integrar tool en `builtInTools.ts`.
3. Integrar sección skills en `systemPromptBuilder.ts`.
4. Cargar y propagar skills desde `streamChat()` en `aiService.ts`.
5. Ejecutar validación manual (sección 9).

---

## 9) Validación manual obligatoria

1. **Sin skills instaladas**:
   - `skill_execute` no debe registrarse.
   - `# Available Skills` no debe aparecer en el prompt.

2. **Con skills instaladas**:
   - `skill_execute` debe aparecer en `toolNames` de logs.
   - `# Available Skills` debe aparecer en `fullPrompt` de logs.

3. **Invocación explícita por ID**:
   - prompt usuario: “usa la skill coding/git-commit”.
   - verificar `tool-call` a `skill_execute` y `tool-result` con `instructions`.

4. **Invocación por nombre corto**:
   - prompt usuario: “usa la skill git-commit”.
   - verificar resolución por cascada y retorno correcto.

5. **Skill no encontrada**:
   - prompt usuario: skill inexistente.
   - verificar retorno con `error` + `availableSkills`.

6. **Con `enableMCP=false`**:
   - confirmar que built-in tools siguen activos y skills siguen disponibles en `streamChat`.

---

## 10) Riesgos aceptados en esta versión
- Sin saneamiento adicional de descripciones para prompt.
- Sin desambiguación de colisiones de nombres.
- Sin ajuste dinámico de token budget por modelo.
- Sin truncado/fragmentación de `instructions` en tool result.
- Sin cambios en `sendSingleMessage()`.

Estos puntos son decisiones explícitas y no deben bloquear el release de esta feature.

---

## 11) Resumen final de archivos

### Crear
- `src/main/services/ai/skillsContextBuilder.ts`

### Modificar
- `src/main/services/ai/builtInTools.ts`
- `src/main/services/ai/systemPromptBuilder.ts`
- `src/main/services/aiService.ts` (solo `streamChat`)

### No tocar
- `src/main/services/skillsService.ts`
- `src/types/skills.ts`
- `src/main/services/directoryService.ts`
- Renderer/UI
- `sendSingleMessage()`

---

## 12) TODO futuro (fuera de esta entrega)
Soporte de skills a nivel de proyecto (`.levante/skills`) con precedencia sobre globales por `id`.
