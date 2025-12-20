
import { tool } from "ai";
import { z } from "zod";
import { getLogger } from '../logging';
import { getMermaidValidator } from './mermaidValidator';

const logger = getLogger();

export interface BuiltInToolsConfig {
    mermaidValidation: boolean;
}

/**
 * Creates built-in tools that are always available to LLMs
 * Independent of MCP servers
 */
export async function getBuiltInTools(config?: BuiltInToolsConfig): Promise<Record<string, any>> {
    const tools: Record<string, any> = {};

    // Only add mermaid validation if enabled
    if (config?.mermaidValidation !== false) {
        const mermaidTool = await createMermaidValidationTool();
        if (mermaidTool) {
            tools['builtin_validate_mermaid'] = mermaidTool;
        }
    }

    logger.aiSdk.debug('Built-in tools created', {
        toolCount: Object.keys(tools).length,
        toolNames: Object.keys(tools)
    });

    return tools;
}

async function createMermaidValidationTool() {
    const validator = getMermaidValidator();

    return tool({
        description: `Validate Mermaid diagram syntax before delivering to user.
IMPORTANT: You MUST use this tool to validate ANY Mermaid code block before including it in your response.
Returns: isValid (boolean), diagramType (if valid), and error details (if invalid).
If validation fails, fix the syntax and validate again before delivering.`,

        parameters: z.object({
            code: z.string().describe('The Mermaid diagram code to validate (without the ```mermaid wrapper)'),
        }),

        execute: async (args: { code: string }) => {
            try {
                logger.aiSdk.debug('Validating Mermaid code', {
                    codeLength: args.code.length,
                    codePreview: args.code.substring(0, 100)
                });

                const result = await validator.validate(args.code);

                logger.aiSdk.info('Mermaid validation result', {
                    isValid: result.isValid,
                    diagramType: result.diagramType,
                    hasError: !!result.error
                });

                return result;
            } catch (error) {
                logger.aiSdk.error('Mermaid validation failed', {
                    error: error instanceof Error ? error.message : error
                });

                return {
                    isValid: false,
                    error: error instanceof Error ? error.message : 'Validation failed',
                    suggestion: 'Check syntax and try again'
                };
            }
        },
    });
}
