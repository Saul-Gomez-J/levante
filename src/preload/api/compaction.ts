import { ipcRenderer } from 'electron';

export interface CompactRequest {
  sessionId: string;
  model: string;
}

export interface CompactResponse {
  success: boolean;
  summaryMessageId?: string;
  error?: string;
}

export const compactionApi = {
  compact: (input: CompactRequest): Promise<CompactResponse> =>
    ipcRenderer.invoke('levante/compaction/compact', input),
};
