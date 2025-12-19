
import { ipcMain, BrowserWindow } from 'electron';
import { getLogger } from '../logging';

const logger = getLogger();

export interface MermaidValidationResult {
    isValid: boolean;
    diagramType?: string;
    error?: string;
    errorLine?: number;
    suggestion?: string;
}

/**
 * Mermaid Validator using IPC to renderer process
 * Required because mermaid.parse() needs DOM environment
 */
class MermaidValidator {
    private pendingValidations = new Map<string, {
        resolve: (result: MermaidValidationResult) => void;
        reject: (error: Error) => void;
        timeout: NodeJS.Timeout;
    }>();

    constructor() {
        this.setupIpcHandlers();
    }

    private setupIpcHandlers() {
        // Receive validation results from renderer
        ipcMain.on('levante/mermaid/validation-result', (event, { requestId, result }) => {
            const pending = this.pendingValidations.get(requestId);
            if (pending) {
                clearTimeout(pending.timeout);
                this.pendingValidations.delete(requestId);
                pending.resolve(result);
            }
        });
    }

    async validate(code: string): Promise<MermaidValidationResult> {
        const requestId = `mermaid_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        return new Promise((resolve, reject) => {
            // Set timeout for validation (5 seconds)
            const timeout = setTimeout(() => {
                this.pendingValidations.delete(requestId);
                // Fallback to basic validation on timeout
                resolve(this.basicValidation(code));
            }, 5000);

            this.pendingValidations.set(requestId, { resolve, reject, timeout });

            // Send validation request to renderer
            const windows = BrowserWindow.getAllWindows();
            if (windows.length > 0 && !windows[0].isDestroyed()) {
                windows[0].webContents.send('levante/mermaid/validate', { requestId, code });
            } else {
                // No window available, use basic validation
                clearTimeout(timeout);
                this.pendingValidations.delete(requestId);
                resolve(this.basicValidation(code));
            }
        });
    }

    /**
     * Basic regex-based validation as fallback
     */
    private basicValidation(code: string): MermaidValidationResult {
        const trimmed = code.trim();

        // Detect diagram type from first line
        const diagramPatterns: Record<string, RegExp> = {
            'flowchart': /^(flowchart|graph)\s+(TB|TD|BT|RL|LR)/i,
            'sequenceDiagram': /^sequenceDiagram/i,
            'classDiagram': /^classDiagram/i,
            'stateDiagram': /^stateDiagram(-v2)?/i,
            'erDiagram': /^erDiagram/i,
            'gantt': /^gantt/i,
            'pie': /^pie/i,
            'gitGraph': /^gitGraph/i,
            'journey': /^journey/i,
            'mindmap': /^mindmap/i,
        };

        for (const [type, pattern] of Object.entries(diagramPatterns)) {
            if (pattern.test(trimmed)) {
                return {
                    isValid: true,
                    diagramType: type,
                };
            }
        }

        return {
            isValid: false,
            error: 'Unknown or invalid diagram type',
            suggestion: 'Start with a valid diagram declaration like "flowchart LR", "sequenceDiagram", etc.'
        };
    }
}

// Singleton instance
let validatorInstance: MermaidValidator | null = null;

export function getMermaidValidator(): MermaidValidator {
    if (!validatorInstance) {
        validatorInstance = new MermaidValidator();
    }
    return validatorInstance;
}

export function initializeMermaidValidator(): void {
    getMermaidValidator();
    logger.aiSdk.info('Mermaid validator initialized');
}
