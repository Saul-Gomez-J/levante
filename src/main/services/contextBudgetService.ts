import { getLogger } from './logging';
import { buildSystemPrompt } from './ai/systemPromptBuilder';
import { getMCPTools } from './ai/mcpToolsAdapter';
import { skillsService } from './skillsService';
import type { InstalledSkill } from '../../types/skills';

const logger = getLogger();

export interface ContextBudgetEstimateInput {
  model: string;
  enableMCP: boolean;
  webSearch: boolean;
  projectDescription?: string;
  projectContext?: { projectId?: string };
  codeMode?: {
    enabled: boolean;
    cwd?: string;
    tools?: Record<string, boolean>;
  };
}

export interface ContextBudgetEstimate {
  systemPromptTokens: number;
  toolsTokens: number;
  skillsTokens: number;
  providerSlackTokens: number;
  staticOverheadTokens: number;
  toolCount: number;
}

const CHARS_PER_TOKEN = 4;
const PROVIDER_SLACK_TOKENS = 500;

function estimateTokensFromChars(chars: number): number {
  return Math.max(0, Math.round(chars / CHARS_PER_TOKEN));
}

class ContextBudgetService {
  async estimate(input: ContextBudgetEstimateInput): Promise<ContextBudgetEstimate> {
    try {
      // 1. Resolve skills
      const projectId = input.projectContext?.projectId;
      let installedSkills: InstalledSkill[] = [];
      try {
        installedSkills = await skillsService.listInstalledSkills(
          projectId
            ? { mode: 'project-merged', projectId }
            : { mode: 'global' }
        );
      } catch (error) {
        logger.aiSdk.warn('contextBudgetService: failed to load skills', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // 2. Get built-in tools config
      const { preferencesService } = await import('./preferencesService');
      const aiPrefs = preferencesService.get('ai') as any;
      const mermaidValidation = aiPrefs?.mermaidValidation !== false;
      const mcpDiscovery = aiPrefs?.mcpDiscovery !== false;

      // 3. Build system prompt (same logic as aiService)
      const { getCodeModeSystemPrompt } = await import('./ai/mcpToolsAdapter');
      const codeModePrompt = input.codeMode?.enabled ? getCodeModeSystemPrompt() : null;

      // Count tools
      let toolCount = 0;
      let toolsSerialized = '';

      // Built-in tools
      const { getBuiltInTools } = await import('./ai/builtInTools');
      const builtInTools = await getBuiltInTools({
        mermaidValidation,
        mcpDiscovery,
        skills: installedSkills,
      });
      toolCount += Object.keys(builtInTools).length;

      // Serialize built-in tool schemas
      for (const [name, tool] of Object.entries(builtInTools)) {
        const t = tool as any;
        toolsSerialized += `${name} ${t.description || ''} ${JSON.stringify(t.parameters || {})} `;
      }

      // MCP tools (if enabled)
      if (input.enableMCP) {
        try {
          await preferencesService.initialize();
          const prefs = await preferencesService.getAll();
          const disabledTools = prefs.mcp?.disabledTools;
          const mcpTools = await getMCPTools({ disabledTools });
          const mcpToolCount = Object.keys(mcpTools).length;
          toolCount += mcpToolCount;

          for (const [name, tool] of Object.entries(mcpTools)) {
            const t = tool as any;
            toolsSerialized += `${name} ${t.description || ''} ${JSON.stringify(t.parameters || {})} `;
          }
        } catch (error) {
          logger.aiSdk.warn('contextBudgetService: failed to load MCP tools', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Coding tools (if enabled)
      if (input.codeMode?.enabled) {
        const { getCodingTools } = await import('./ai/codingTools');
        const codingTools = getCodingTools({
          cwd: input.codeMode.cwd || process.cwd(),
          enabled: input.codeMode.tools,
        });
        toolCount += Object.keys(codingTools).length;

        for (const [name, tool] of Object.entries(codingTools)) {
          const t = tool as any;
          toolsSerialized += `${name} ${t.description || ''} ${JSON.stringify(t.parameters || {})} `;
        }
      }

      // 4. Build real system prompt to estimate its size
      const systemPrompt = await buildSystemPrompt(
        input.webSearch,
        input.enableMCP,
        toolCount,
        mermaidValidation,
        mcpDiscovery,
        input.projectDescription,
        installedSkills,
        codeModePrompt
      );

      const systemPromptTokens = estimateTokensFromChars(systemPrompt.length);
      const toolsTokens = estimateTokensFromChars(toolsSerialized.length);

      // Skills tokens are already included in systemPrompt, estimate separately
      // by checking what buildSkillsContext would add
      let skillsTokens = 0;
      if (installedSkills.length > 0) {
        const { buildSkillsContext } = await import('./ai/skillsContextBuilder');
        const skillsSection = buildSkillsContext(installedSkills);
        skillsTokens = skillsSection ? estimateTokensFromChars(skillsSection.length) : 0;
      }

      const staticOverheadTokens =
        systemPromptTokens + toolsTokens + PROVIDER_SLACK_TOKENS;

      logger.aiSdk.debug('contextBudgetService: estimate computed', {
        systemPromptTokens,
        toolsTokens,
        skillsTokens,
        providerSlackTokens: PROVIDER_SLACK_TOKENS,
        staticOverheadTokens,
        toolCount,
      });

      return {
        systemPromptTokens,
        toolsTokens,
        skillsTokens,
        providerSlackTokens: PROVIDER_SLACK_TOKENS,
        staticOverheadTokens,
        toolCount,
      };
    } catch (error) {
      logger.aiSdk.error('contextBudgetService: estimate failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Return conservative fallback
      return {
        systemPromptTokens: 2000,
        toolsTokens: 0,
        skillsTokens: 0,
        providerSlackTokens: PROVIDER_SLACK_TOKENS,
        staticOverheadTokens: 2500,
        toolCount: 0,
      };
    }
  }
}

export const contextBudgetService = new ContextBudgetService();
