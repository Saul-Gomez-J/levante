import { useState, useCallback } from 'react';
import { getRendererLogger } from '@/services/logger';

const logger = getRendererLogger();

// Types matching the preload/main types
export interface MCPResource {
  name: string;
  uri: string;
  description?: string;
  mimeType?: string;
  annotations?: {
    audience?: ('user' | 'assistant')[];
    priority?: number;
    lastModified?: string;
  };
}

export interface MCPResourceContent {
  uri: string;
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: ArrayBuffer;
  }>;
}

export interface MCPPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: MCPPromptArgument[];
}

export interface MCPPromptMessage {
  role: 'user' | 'assistant' | 'system';
  content: {
    type: 'text' | 'image';
    text?: string;
    data?: string;
    mimeType?: string;
  };
}

export interface MCPPromptResult {
  description?: string;
  messages: MCPPromptMessage[];
}

export interface SelectedResource {
  serverId: string;
  serverName: string;
  resource: MCPResource;
  content?: MCPResourceContent;
  status: 'pending' | 'loading' | 'loaded' | 'error';
  error?: string;
}

export interface SelectedPrompt {
  serverId: string;
  serverName: string;
  prompt: MCPPrompt;
  args?: Record<string, any>;
  result?: MCPPromptResult;
  status: 'pending' | 'loading' | 'loaded' | 'error';
  error?: string;
}

// Combined type for unified display
export type SelectedContext =
  | { type: 'resource'; data: SelectedResource }
  | { type: 'prompt'; data: SelectedPrompt };

export function useMCPResources() {
  const [selectedResources, setSelectedResources] = useState<SelectedResource[]>([]);
  const [selectedPrompts, setSelectedPrompts] = useState<SelectedPrompt[]>([]);
  const [resourcesCache, setResourcesCache] = useState<Record<string, MCPResource[]>>({});
  const [promptsCache, setPromptsCache] = useState<Record<string, MCPPrompt[]>>({});
  const [loadingServers, setLoadingServers] = useState<Set<string>>(new Set());

  /**
   * List resources from an MCP server (with caching)
   */
  const listResources = useCallback(async (serverId: string): Promise<MCPResource[]> => {
    // Return cached if available
    if (resourcesCache[serverId]) {
      return resourcesCache[serverId];
    }

    setLoadingServers(prev => new Set(prev).add(serverId));

    try {
      const result = await window.levante.mcp.listResources(serverId);

      if (!result.success) {
        throw new Error(result.error || 'Failed to list resources');
      }

      const resources = result.data || [];

      // Cache the results
      setResourcesCache(prev => ({ ...prev, [serverId]: resources }));

      logger.mcp.debug('Listed resources from server', {
        serverId,
        count: resources.length,
      });

      return resources;
    } catch (error) {
      logger.mcp.error('Failed to list resources', {
        serverId,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    } finally {
      setLoadingServers(prev => {
        const next = new Set(prev);
        next.delete(serverId);
        return next;
      });
    }
  }, [resourcesCache]);

  /**
   * List prompts from an MCP server (with caching)
   */
  const listPrompts = useCallback(async (serverId: string): Promise<MCPPrompt[]> => {
    // Return cached if available
    if (promptsCache[serverId]) {
      return promptsCache[serverId];
    }

    setLoadingServers(prev => new Set(prev).add(serverId));

    try {
      const result = await window.levante.mcp.listPrompts(serverId);

      if (!result.success) {
        throw new Error(result.error || 'Failed to list prompts');
      }

      const prompts = result.data || [];

      // Cache the results
      setPromptsCache(prev => ({ ...prev, [serverId]: prompts }));

      logger.mcp.debug('Listed prompts from server', {
        serverId,
        count: prompts.length,
      });

      return prompts;
    } catch (error) {
      logger.mcp.error('Failed to list prompts', {
        serverId,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    } finally {
      setLoadingServers(prev => {
        const next = new Set(prev);
        next.delete(serverId);
        return next;
      });
    }
  }, [promptsCache]);

  /**
   * Select a resource and load its content
   */
  const selectResource = useCallback(async (
    serverId: string,
    serverName: string,
    resource: MCPResource
  ) => {
    // Check if already selected
    const alreadySelected = selectedResources.some(
      r => r.resource.uri === resource.uri && r.serverId === serverId
    );
    if (alreadySelected) {
      return;
    }

    // Add to selected with loading status
    const newResource: SelectedResource = {
      serverId,
      serverName,
      resource,
      status: 'loading',
    };

    setSelectedResources(prev => [...prev, newResource]);

    try {
      // Fetch content
      const result = await window.levante.mcp.readResource(serverId, resource.uri);

      if (result.success && result.data) {
        setSelectedResources(prev =>
          prev.map(r =>
            r.resource.uri === resource.uri && r.serverId === serverId
              ? { ...r, content: result.data, status: 'loaded' as const }
              : r
          )
        );

        logger.mcp.debug('Resource loaded', {
          serverId,
          uri: resource.uri,
          contentsCount: result.data.contents?.length || 0,
        });
      } else {
        throw new Error(result.error || 'Failed to read resource');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      setSelectedResources(prev =>
        prev.map(r =>
          r.resource.uri === resource.uri && r.serverId === serverId
            ? { ...r, status: 'error' as const, error: errorMessage }
            : r
        )
      );

      logger.mcp.error('Failed to load resource', {
        serverId,
        uri: resource.uri,
        error: errorMessage,
      });
    }
  }, [selectedResources]);

  /**
   * Select a prompt and load its result with provided arguments
   */
  const selectPrompt = useCallback(async (
    serverId: string,
    serverName: string,
    prompt: MCPPrompt,
    args?: Record<string, any>
  ) => {
    // Check if already selected with same args
    const alreadySelected = selectedPrompts.some(
      p => p.prompt.name === prompt.name &&
           p.serverId === serverId &&
           JSON.stringify(p.args) === JSON.stringify(args)
    );
    if (alreadySelected) {
      return;
    }

    // Add to selected with loading status
    const newPrompt: SelectedPrompt = {
      serverId,
      serverName,
      prompt,
      args,
      status: 'loading',
    };

    setSelectedPrompts(prev => [...prev, newPrompt]);

    try {
      // Fetch prompt result
      const result = await window.levante.mcp.getPrompt(serverId, prompt.name, args);

      if (result.success && result.data) {
        setSelectedPrompts(prev =>
          prev.map(p =>
            p.prompt.name === prompt.name &&
            p.serverId === serverId &&
            JSON.stringify(p.args) === JSON.stringify(args)
              ? { ...p, result: result.data, status: 'loaded' as const }
              : p
          )
        );

        logger.mcp.debug('Prompt loaded', {
          serverId,
          name: prompt.name,
          messagesCount: result.data.messages?.length || 0,
        });
      } else {
        throw new Error(result.error || 'Failed to get prompt');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      setSelectedPrompts(prev =>
        prev.map(p =>
          p.prompt.name === prompt.name &&
          p.serverId === serverId &&
          JSON.stringify(p.args) === JSON.stringify(args)
            ? { ...p, status: 'error' as const, error: errorMessage }
            : p
        )
      );

      logger.mcp.error('Failed to load prompt', {
        serverId,
        name: prompt.name,
        error: errorMessage,
      });
    }
  }, [selectedPrompts]);

  /**
   * Remove a selected resource
   */
  const removeResource = useCallback((serverId: string, uri: string) => {
    setSelectedResources(prev =>
      prev.filter(r => !(r.resource.uri === uri && r.serverId === serverId))
    );
  }, []);

  /**
   * Remove a selected prompt
   */
  const removePrompt = useCallback((serverId: string, name: string) => {
    setSelectedPrompts(prev =>
      prev.filter(p => !(p.prompt.name === name && p.serverId === serverId))
    );
  }, []);

  /**
   * Clear all selected resources and prompts
   */
  const clearResources = useCallback(() => {
    setSelectedResources([]);
    setSelectedPrompts([]);
  }, []);

  /**
   * Clear cached resources and prompts for a server (useful after reconnection)
   */
  const clearCache = useCallback((serverId?: string) => {
    if (serverId) {
      setResourcesCache(prev => {
        const next = { ...prev };
        delete next[serverId];
        return next;
      });
      setPromptsCache(prev => {
        const next = { ...prev };
        delete next[serverId];
        return next;
      });
    } else {
      setResourcesCache({});
      setPromptsCache({});
    }
  }, []);

  /**
   * Convert selected resources and prompts to context string for AI prompt
   */
  const getContextString = useCallback((): string => {
    const resourceContexts = selectedResources
      .filter(r => r.status === 'loaded' && r.content)
      .map(r => {
        const textContent = r.content?.contents
          .filter(c => c.text)
          .map(c => c.text)
          .join('\n');

        return `<resource uri="${r.resource.uri}" name="${r.resource.name}" server="${r.serverName}">\n${textContent}\n</resource>`;
      });

    const promptContexts = selectedPrompts
      .filter(p => p.status === 'loaded' && p.result)
      .map(p => {
        const messagesText = p.result?.messages
          .filter(m => m.content.text)
          .map(m => `[${m.role}]: ${m.content.text}`)
          .join('\n');

        return `<prompt name="${p.prompt.name}" server="${p.serverName}">\n${messagesText}\n</prompt>`;
      });

    return [...resourceContexts, ...promptContexts].join('\n\n');
  }, [selectedResources, selectedPrompts]);

  /**
   * Check if a server is currently loading
   */
  const isServerLoading = useCallback((serverId: string): boolean => {
    return loadingServers.has(serverId);
  }, [loadingServers]);

  /**
   * Get all selected context items (resources + prompts) for unified display
   */
  const getAllSelectedContext = useCallback((): SelectedContext[] => {
    const resources: SelectedContext[] = selectedResources.map(r => ({
      type: 'resource' as const,
      data: r,
    }));
    const prompts: SelectedContext[] = selectedPrompts.map(p => ({
      type: 'prompt' as const,
      data: p,
    }));
    return [...resources, ...prompts];
  }, [selectedResources, selectedPrompts]);

  return {
    // Resources
    selectedResources,
    listResources,
    selectResource,
    removeResource,
    resourcesCache,
    // Prompts
    selectedPrompts,
    listPrompts,
    selectPrompt,
    removePrompt,
    promptsCache,
    // Common
    clearResources,
    clearCache,
    getContextString,
    isServerLoading,
    getAllSelectedContext,
  };
}
