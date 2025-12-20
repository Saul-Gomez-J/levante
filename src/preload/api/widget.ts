import { ipcRenderer } from 'electron';

export interface WidgetStoreResult {
  success: boolean;
  url?: string;
  widgetId?: string;
  error?: string;
}

export interface WidgetRemoveResult {
  success: boolean;
  error?: string;
}

export interface WidgetProxyInfo {
  success: boolean;
  port?: number;
  secret?: string;
  error?: string;
}

/**
 * Widget protocol types for bridge selection
 */
export type WidgetProtocol = 'mcp-apps' | 'openai-sdk' | 'mcp-ui' | 'none';

/**
 * Bridge options for widget initialization
 */
export interface WidgetBridgeOptions {
  toolInput?: Record<string, unknown>;
  toolOutput?: Record<string, unknown>;
  responseMetadata?: Record<string, unknown>;
  locale?: string;
  theme?: 'light' | 'dark' | 'system';
  serverId?: string;
}

/**
 * Options for storing widget content
 */
export interface WidgetStoreOptions {
  protocol?: WidgetProtocol;
  bridgeOptions?: WidgetBridgeOptions;
  baseUrl?: string;
}

export const widgetApi = {
  /**
   * Store widget HTML content and get proxy URL
   * Returns an http://127.0.0.1:{port}/proxy/{id}?secret={token} URL
   * @param html - HTML content to store
   * @param options - Storage options (protocol, bridgeOptions, baseUrl) or legacy baseUrl string
   */
  store: (html: string, options?: WidgetStoreOptions | string): Promise<WidgetStoreResult> =>
    ipcRenderer.invoke('levante/widget/store', html, options),

  /**
   * Remove widget content from store
   */
  remove: (widgetId: string): Promise<WidgetRemoveResult> =>
    ipcRenderer.invoke('levante/widget/remove', widgetId),

  /**
   * Get proxy server info (port and secret)
   */
  getProxyInfo: (): Promise<WidgetProxyInfo> =>
    ipcRenderer.invoke('levante/widget/getProxyInfo'),
};
