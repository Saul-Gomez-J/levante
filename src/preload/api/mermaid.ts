import { ipcRenderer } from 'electron';

export const mermaidApi = {
    mermaid: {
        onValidate: (
            callback: (data: { requestId: string; code: string }) => void
        ) => {
            const subscription = (_event: any, data: any) => callback(data);
            ipcRenderer.on('levante/mermaid/validate', subscription);
            return () => {
                ipcRenderer.removeListener('levante/mermaid/validate', subscription);
            };
        },

        sendResult: (data: { requestId: string; result: any }) => {
            ipcRenderer.send('levante/mermaid/validation-result', data);
        },
    },
};
