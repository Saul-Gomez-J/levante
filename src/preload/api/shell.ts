import { shell } from 'electron';

export const shellApi = {
  showItemInFolder: (path: string) => {
    shell.showItemInFolder(path);
  },
};
