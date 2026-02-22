import path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import type { InstalledSkill } from '../../../types/skills';
import { getLogger } from '../logging';

const logger = getLogger();

// Presupuesto fijo aceptado para esta versión.
const SKILLS_TOKEN_BUDGET = 4000;

export function buildSkillsContext(skills: InstalledSkill[]): string {
  if (skills.length === 0) return '';

  let usedTokens = 0;
  const entries: string[] = [];

  for (const skill of skills) {
    if (skill.userInvocable === false) continue;

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

      const baseDir = path.dirname(found.filePath);
      const content = args ? `${found.content}\n\n---\nContext provided: ${args}` : found.content;
      return `Base directory for this skill: ${baseDir}\n\n${content}`;
    },
  });
}
