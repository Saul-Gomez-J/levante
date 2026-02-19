import { ipcRenderer } from 'electron';

export interface SelectWorkingDirectoryResult {
  success: boolean;
  data?: { path: string; canceled: boolean };
  error?: string;
}

export const coworkApi = {
  selectWorkingDirectory: (options?: {
    title?: string;
    defaultPath?: string;
    buttonLabel?: string;
  }): Promise<SelectWorkingDirectoryResult> =>
    ipcRenderer.invoke('levante/cowork/select-working-directory', options),
};
