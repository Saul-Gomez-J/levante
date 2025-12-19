
import mermaid from 'mermaid';

interface ValidationRequest {
    requestId: string;
    code: string;
}

async function validateMermaidCode(code: string): Promise<{ isValid: boolean; diagramType?: string; error?: string; suggestion?: string }> {
    try {
        const diagramType = await mermaid.parse(code);
        return { isValid: true, diagramType };
    } catch (error) {
        return {
            isValid: false,
            error: error instanceof Error ? error.message : 'Parse error',
            suggestion: extractSuggestionFromError(error),
        };
    }
}

export function setupMermaidValidationHandler(): void {
    // Initialize mermaid for parsing only
    mermaid.initialize({ startOnLoad: false });

    // Listen for validation requests from main process
    const removeListener = window.levante.mermaid.onValidate(async (event) => {
        const { requestId, code } = event;

        try {
            // Validate code using mermaid
            // We need to use mermaid.parse to validate
            const validationResult = await validateMermaidCode(code);

            // Send result back to main process
            window.levante.mermaid.sendResult({ requestId, result: validationResult });
        } catch (error) {
            console.error('Mermaid validation service error:', error);

            // Send error result
            window.levante.mermaid.sendResult({
                requestId,
                result: {
                    isValid: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                }
            });
        }
    });
}

function extractSuggestionFromError(error: unknown): string {
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('unexpected')) {
            return 'Check for syntax errors like missing arrows, brackets, or invalid characters';
        }
        if (msg.includes('expecting')) {
            return 'There may be a missing keyword or declaration';
        }
    }
    return 'Review the Mermaid syntax documentation';
}
