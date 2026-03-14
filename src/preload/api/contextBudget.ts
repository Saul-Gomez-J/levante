import { ipcRenderer } from 'electron';

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

export const contextBudgetApi = {
  estimate: (
    input: ContextBudgetEstimateInput
  ): Promise<{ success: boolean; data?: ContextBudgetEstimate; error?: string }> =>
    ipcRenderer.invoke('levante/context-budget/estimate', input),
};
