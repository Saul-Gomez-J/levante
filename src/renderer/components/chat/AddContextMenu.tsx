/**
 * AddContextMenu Component
 *
 * A "+" button dropdown menu that allows users to add context to their chat:
 * - MCP server resources
 * - MCP server prompts (with variable input modal)
 * - File uploads
 *
 * Replaces the standalone AttachmentButton with a unified context menu
 * similar to Claude Desktop's implementation.
 */

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Plus, Upload, Server, FileText, Loader2, MessageSquare, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMCPResources, type MCPResource, type MCPPrompt } from '@/hooks/useMCPResources';
import { PromptInputModal } from './PromptInputModal';
import { getRendererLogger } from '@/services/logger';

const logger = getRendererLogger();

interface MCPServer {
  id: string;
  name?: string;
  connected: boolean;
}

interface ServerContent {
  resources: MCPResource[];
  prompts: MCPPrompt[];
}

interface AddContextMenuProps {
  onFilesSelected: (files: File[]) => void;
  onResourceSelected?: (serverId: string, serverName: string, resource: MCPResource) => void;
  onPromptSelected?: (serverId: string, serverName: string, prompt: MCPPrompt, args?: Record<string, any>) => void;
  disabled?: boolean;
  fileAccept?: string;
}

export function AddContextMenu({
  onFilesSelected,
  onResourceSelected,
  onPromptSelected,
  disabled = false,
  fileAccept = 'image/*,audio/*',
}: AddContextMenuProps) {
  const { t } = useTranslation('chat');
  const {
    listResources,
    listPrompts,
    selectResource,
    selectPrompt,
    isServerLoading,
    resourcesCache,
    promptsCache,
  } = useMCPResources();

  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [loadingServers, setLoadingServers] = useState<Record<string, boolean>>({});
  const [serverContent, setServerContent] = useState<Record<string, ServerContent>>({});

  // Search state for filtering servers
  const [searchQuery, setSearchQuery] = useState('');

  // Modal state for prompt input
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<{
    server: MCPServer;
    prompt: MCPPrompt;
  } | null>(null);

  // Fetch connected MCP servers on mount
  useEffect(() => {
    const loadServers = async () => {
      try {
        // Get all servers
        const serversResult = await window.levante.mcp.listServers();
        if (!serversResult.success || !serversResult.data) {
          return;
        }

        // Get connection status
        const statusResult = await window.levante.mcp.connectionStatus();
        const connectionStatus = statusResult.data || {};

        // Map servers with connection status
        const servers: MCPServer[] = serversResult.data
          .filter(s => s.enabled !== false) // Only enabled servers
          .map(s => ({
            id: s.id,
            name: s.name || s.id,
            connected: connectionStatus[s.id] === 'connected',
          }))
          .filter(s => s.connected); // Only show connected servers

        setMcpServers(servers);
      } catch (error) {
        logger.mcp.error('Failed to load MCP servers', {
          error: error instanceof Error ? error.message : error,
        });
      }
    };

    loadServers();
  }, []);

  // Handle hovering over a server to load resources and prompts
  const handleServerHover = async (serverId: string) => {
    // Skip if already loaded or loading
    if (serverContent[serverId] || loadingServers[serverId]) {
      return;
    }

    // Check cache first
    const cachedResources = resourcesCache[serverId];
    const cachedPrompts = promptsCache[serverId];
    if (cachedResources && cachedPrompts) {
      setServerContent(prev => ({
        ...prev,
        [serverId]: { resources: cachedResources, prompts: cachedPrompts },
      }));
      return;
    }

    setLoadingServers(prev => ({ ...prev, [serverId]: true }));

    try {
      // Load both resources and prompts in parallel
      const [resources, prompts] = await Promise.all([
        listResources(serverId).catch(() => [] as MCPResource[]),
        listPrompts(serverId).catch(() => [] as MCPPrompt[]),
      ]);

      setServerContent(prev => ({
        ...prev,
        [serverId]: { resources, prompts },
      }));
    } catch (error) {
      logger.mcp.error('Failed to load content for server', {
        serverId,
        error: error instanceof Error ? error.message : error,
      });
      // Set empty content to avoid repeated attempts
      setServerContent(prev => ({
        ...prev,
        [serverId]: { resources: [], prompts: [] },
      }));
    } finally {
      setLoadingServers(prev => ({ ...prev, [serverId]: false }));
    }
  };

  // Handle file upload click
  const handleFileUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = fileAccept;
    input.onchange = (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      if (files.length > 0) {
        onFilesSelected(files);
      }
    };
    input.click();
  };

  // Handle resource selection
  const handleResourceSelect = (server: MCPServer, resource: MCPResource) => {
    if (onResourceSelected) {
      onResourceSelected(server.id, server.name || server.id, resource);
    } else {
      // Use internal hook if no external handler
      selectResource(server.id, server.name || server.id, resource);
    }
  };

  // Handle prompt click - open modal if has arguments, otherwise add directly
  const handlePromptClick = (server: MCPServer, prompt: MCPPrompt) => {
    if (prompt.arguments && prompt.arguments.length > 0) {
      // Open modal to input arguments
      setPendingPrompt({ server, prompt });
      setPromptModalOpen(true);
    } else {
      // No arguments needed, add directly
      handlePromptSelect(server, prompt);
    }
  };

  // Handle prompt selection with arguments
  const handlePromptSelect = (server: MCPServer, prompt: MCPPrompt, args?: Record<string, any>) => {
    if (onPromptSelected) {
      onPromptSelected(server.id, server.name || server.id, prompt, args);
    } else {
      // Use internal hook if no external handler
      selectPrompt(server.id, server.name || server.id, prompt, args);
    }
  };

  // Handle modal submit
  const handlePromptModalSubmit = (args: Record<string, string>) => {
    if (pendingPrompt) {
      handlePromptSelect(pendingPrompt.server, pendingPrompt.prompt, args);
      setPendingPrompt(null);
    }
  };

  const connectedServers = mcpServers.filter(s => s.connected);

  // Filter servers by search query
  const filteredServers = useMemo(() => {
    if (!searchQuery.trim()) return connectedServers;
    const query = searchQuery.toLowerCase();
    return connectedServers.filter(
      s => s.name?.toLowerCase().includes(query) || s.id.toLowerCase().includes(query)
    );
  }, [connectedServers, searchQuery]);

  // Show search when there are 3+ servers
  const showSearch = connectedServers.length >= 3;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            title={t('add_context.button_title', 'Add context')}
          >
            <Plus className="size-4" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-56">
          {/* Upload File Option - First */}
          <DropdownMenuItem onClick={handleFileUpload} className="gap-2">
            <Upload className="size-4" />
            {t('add_context.upload_file', 'Upload a file')}
          </DropdownMenuItem>

          {/* Separator and MCP servers if there are any */}
          {connectedServers.length > 0 && (
            <>
              <DropdownMenuSeparator />

              {/* Search input when 3+ servers */}
              {showSearch && (
                <div className="px-2 py-1.5">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder={t('add_context.search_mcp', 'Search MCP...')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 pl-7 text-sm"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>
              )}

              {/* MCP Servers with Resources and Prompts */}
              {filteredServers.length === 0 && searchQuery ? (
                <DropdownMenuItem disabled className="text-muted-foreground text-sm">
                  {t('add_context.no_results', 'No matching servers')}
                </DropdownMenuItem>
              ) : (
                filteredServers.map(server => (
                  <DropdownMenuSub key={server.id}>
                    <DropdownMenuSubTrigger
                      onMouseEnter={() => handleServerHover(server.id)}
                      onFocus={() => handleServerHover(server.id)}
                      className="gap-2"
                    >
                      <Server className="size-4" />
                      <span className="truncate">
                        {server.name}
                      </span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-64 max-h-80 overflow-y-auto">
                      {loadingServers[server.id] || isServerLoading(server.id) ? (
                        <DropdownMenuItem disabled className="gap-2">
                          <Loader2 className="size-4 animate-spin" />
                          {t('add_context.loading', 'Loading...')}
                        </DropdownMenuItem>
                      ) : !serverContent[server.id] ||
                        (serverContent[server.id].resources.length === 0 &&
                          serverContent[server.id].prompts.length === 0) ? (
                        <DropdownMenuItem disabled className="text-muted-foreground">
                          {t('add_context.no_resources', 'No resources available')}
                        </DropdownMenuItem>
                      ) : (
                        <>
                          {/* Prompts Section */}
                          {serverContent[server.id].prompts.length > 0 && (
                            <>
                              <DropdownMenuLabel className="text-xs text-muted-foreground">
                                {t('add_context.prompts', 'Prompts')}
                              </DropdownMenuLabel>
                              {serverContent[server.id].prompts.map(prompt => (
                                <DropdownMenuItem
                                  key={prompt.name}
                                  onClick={() => handlePromptClick(server, prompt)}
                                  className="gap-2"
                                >
                                  <MessageSquare className="size-4 shrink-0 text-blue-500" />
                                  <div className="min-w-0 flex-1">
                                    <span className="block truncate">{prompt.name}</span>
                                    {prompt.description && (
                                      <span className="block truncate text-xs text-muted-foreground">
                                        {prompt.description}
                                      </span>
                                    )}
                                  </div>
                                </DropdownMenuItem>
                              ))}
                            </>
                          )}

                          {/* Separator between prompts and resources */}
                          {serverContent[server.id].prompts.length > 0 &&
                            serverContent[server.id].resources.length > 0 && (
                              <DropdownMenuSeparator />
                            )}

                          {/* Resources Section */}
                          {serverContent[server.id].resources.length > 0 && (
                            <>
                              <DropdownMenuLabel className="text-xs text-muted-foreground">
                                {t('add_context.resources', 'Resources')}
                              </DropdownMenuLabel>
                              {serverContent[server.id].resources.map(resource => (
                                <DropdownMenuItem
                                  key={resource.uri}
                                  onClick={() => handleResourceSelect(server, resource)}
                                  className="gap-2"
                                >
                                  <FileText className="size-4 shrink-0" />
                                  <div className="min-w-0 flex-1">
                                    <span className="block truncate">{resource.name}</span>
                                    {resource.description && (
                                      <span className="block truncate text-xs text-muted-foreground">
                                        {resource.description}
                                      </span>
                                    )}
                                  </div>
                                </DropdownMenuItem>
                              ))}
                            </>
                          )}
                        </>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ))
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Prompt Input Modal */}
      <PromptInputModal
        open={promptModalOpen}
        onOpenChange={setPromptModalOpen}
        prompt={pendingPrompt?.prompt || null}
        serverName={pendingPrompt?.server.name || ''}
        onSubmit={handlePromptModalSubmit}
      />
    </>
  );
}
