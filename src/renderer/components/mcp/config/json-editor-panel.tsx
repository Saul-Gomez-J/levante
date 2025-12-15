import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { useThemeDetector } from '@/hooks/useThemeDetector';
import { useMCPStore } from '@/stores/mcpStore';
import { MCPServerConfig, MCPTool } from '@/types/mcp';
import { MCPServerPreview } from './mcp-server-preview';
import { RuntimeChoiceDialog, RuntimeErrorType } from '@/components/runtime/RuntimeChoiceDialog';
import { toast } from 'sonner';

interface JSONEditorPanelProps {
  serverId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function JSONEditorPanel({ serverId, isOpen, onClose }: JSONEditorPanelProps) {
  const { getServerById, getRegistryEntryById, updateServer, addServer } = useMCPStore();
  const theme = useThemeDetector();

  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [isLoadingTools, setIsLoadingTools] = useState(false);

  const [runtimeDialogState, setRuntimeDialogState] = useState<{
    isOpen: boolean;
    errorType: RuntimeErrorType | null;
    serverName: string;
    testConfig: MCPServerConfig | null;
    metadata: {
      systemPath?: string;
      runtimeType?: 'node' | 'python';
      runtimeVersion?: string;
    };
  }>({
    isOpen: false,
    errorType: null,
    serverName: '',
    testConfig: null,
    metadata: {},
  });

  const server = serverId ? getServerById(serverId) : null;
  const registryEntry = serverId ? getRegistryEntryById(serverId) : null;
  const isNewServer = !server;

  useEffect(() => {
    if (isOpen && serverId) {
      // Load initial JSON
      if (server) {
        // Existing server - load current config (only include non-empty fields)
        const config: Record<string, any> = {
          transport: server.transport,
        };

        // Include name if present
        if (server.name) {
          config.name = server.name;
        }

        // STDIO specific fields
        if (server.command) {
          config.command = server.command;
        }
        if (server.args && server.args.length > 0) {
          config.args = server.args;
        }
        if (server.env && Object.keys(server.env).length > 0) {
          config.env = server.env;
        }

        // HTTP specific fields (prefer url over baseUrl)
        const serverUrl = server.url || server.baseUrl;
        if (serverUrl) {
          config.url = serverUrl;
        }
        if (server.headers && Object.keys(server.headers).length > 0) {
          config.headers = server.headers;
        }

        setJsonText(JSON.stringify(config, null, 2));
      } else if (registryEntry?.configuration?.template) {
        // New server - load template
        setJsonText(JSON.stringify(registryEntry.configuration.template, null, 2));
      } else {
        // Fallback empty template
        setJsonText(JSON.stringify({
          transport: 'stdio',
          command: ''
        }, null, 2));
      }
      setJsonError(null);
      setTestResult(null);
    }
  }, [isOpen, serverId, server, registryEntry]);

  const validateJSON = (text: string): { valid: boolean; data?: any; error?: string } => {
    try {
      const parsed = JSON.parse(text);

      // Support both 'transport' (new) and 'type' (legacy)
      const transportType = parsed.transport || parsed.type;

      // Validate required fields
      if (!transportType) {
        return { valid: false, error: 'Missing required field: transport' };
      }

      if (transportType === 'stdio' && !parsed.command) {
        return { valid: false, error: 'Missing required field: command (for stdio transport)' };
      }

      // Support both 'url' (new) and 'baseUrl' (legacy)
      const serverUrl = parsed.url || parsed.baseUrl;
      if ((transportType === 'http' || transportType === 'sse' || transportType === 'streamable-http') && !serverUrl) {
        return { valid: false, error: 'Missing required field: url (for http/sse/streamable-http transport)' };
      }

      return { valid: true, data: parsed };
    } catch (error) {
      return { valid: false, error: 'Invalid JSON syntax' };
    }
  };

  const handleJSONChange = (text: string) => {
    setJsonText(text);
    const validation = validateJSON(text);
    setJsonError(validation.error || null);
  };

  const handleTestConnection = async () => {
    const validation = validateJSON(jsonText);
    if (!validation.valid || !validation.data) {
      setJsonError(validation.error || 'Invalid JSON');
      return;
    }

    setIsTestingConnection(true);
    setIsLoadingTools(true);
    setTestResult(null);
    setTools([]);

    try {
      // Support both 'transport'/'type' and 'url'/'baseUrl' field names
      const transportType = validation.data.transport || validation.data.type;
      const serverUrl = validation.data.url || validation.data.baseUrl;

      const testConfig: MCPServerConfig = {
        id: `test-${Date.now()}`,
        name: validation.data.name || registryEntry?.name || 'Test Server',
        transport: transportType,
        command: validation.data.command,
        args: validation.data.args,
        env: validation.data.env,
        url: serverUrl,
        headers: validation.data.headers
      };

      // Call IPC directly to get tools
      const result = await window.levante.mcp.testConnection(testConfig);

      // Handle runtime-specific errors
      if (!result.success && ((result as any).errorCode === 'RUNTIME_CHOICE_REQUIRED' || (result as any).errorCode === 'RUNTIME_NOT_FOUND')) {
        setIsTestingConnection(false);
        setIsLoadingTools(false);
        setRuntimeDialogState({
          isOpen: true,
          errorType: (result as any).errorCode,
          serverName: testConfig.name || 'Test Server',
          testConfig,
          metadata: (result as any).metadata || {},
        });
        return;
      }

      setTestResult({
        success: result.success,
        message: result.success
          ? 'Connection test successful! Server is responding correctly.'
          : result.error || 'Connection test failed. Please check your configuration.'
      });

      // Set tools from the result
      if (result.success && result.data) {
        setTools(result.data);
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: 'Connection test failed with an unexpected error.'
      });
    } finally {
      setIsTestingConnection(false);
      setIsLoadingTools(false);
    }
  };

  const handleSave = async () => {
    const validation = validateJSON(jsonText);
    if (!validation.valid || !validation.data || !serverId) {
      setJsonError(validation.error || 'Invalid JSON');
      return;
    }

    setIsSaving(true);

    try {
      // Support both 'transport'/'type' and 'url'/'baseUrl' field names
      const transportType = validation.data.transport || validation.data.type;
      const serverUrl = validation.data.url || validation.data.baseUrl;

      const serverConfig: MCPServerConfig = {
        id: serverId,
        name: validation.data.name || registryEntry?.name || serverId,
        transport: transportType,
        command: validation.data.command,
        args: validation.data.args,
        env: validation.data.env,
        url: serverUrl,
        headers: validation.data.headers
      };

      if (isNewServer) {
        await addServer(serverConfig);
      } else {
        await updateServer(serverId, {
          name: serverConfig.name,
          command: serverConfig.command,
          args: serverConfig.args,
          env: serverConfig.env,
          transport: serverConfig.transport,
          url: serverConfig.url,
          headers: serverConfig.headers
        });
      }

      onClose();
    } catch (error) {
      setJsonError('Failed to save server configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRuntimeUseSystem = async () => {
    if (!runtimeDialogState.testConfig) return;

    setIsTestingConnection(true);
    setIsLoadingTools(true);

    try {
      const modifiedConfig = {
        ...runtimeDialogState.testConfig,
        runtime: {
          ...runtimeDialogState.testConfig.runtime!,
          source: 'system' as const
        }
      };

      const result = await window.levante.mcp.testConnection(modifiedConfig);

      setTestResult({
        success: result.success,
        message: result.success
          ? 'Connection test successful using system runtime!'
          : result.error || 'Connection test failed'
      });

      if (result.success && result.data) {
        setTools(result.data);
      }
    } catch (error: any) {
      setTestResult({
        success: false,
        message: error.message || 'Failed to test with system runtime'
      });
    } finally {
      setIsTestingConnection(false);
      setIsLoadingTools(false);
    }
  };

  const handleRuntimeInstallLevante = async () => {
    if (!runtimeDialogState.testConfig) return;

    setIsTestingConnection(true);
    setIsLoadingTools(true);

    try {
      const toastId = toast.loading(`Installing runtime...`);

      const installResult = await window.levante.mcp.installRuntime(
        runtimeDialogState.metadata.runtimeType!,
        runtimeDialogState.metadata.runtimeVersion!
      );

      if (!installResult.success) {
        throw new Error(installResult.error || 'Failed to install runtime');
      }

      // Test again after installation
      const result = await window.levante.mcp.testConnection(runtimeDialogState.testConfig);

      toast.success('Runtime installed successfully!', { id: toastId });

      setTestResult({
        success: result.success,
        message: result.success
          ? 'Connection test successful with new runtime!'
          : result.error || 'Connection test failed'
      });

      if (result.success && result.data) {
        setTools(result.data);
      }
    } catch (error: any) {
      toast.error(`Failed to install runtime: ${error.message}`);
      setTestResult({
        success: false,
        message: error.message || 'Failed to install runtime'
      });
    } finally {
      setIsTestingConnection(false);
      setIsLoadingTools(false);
    }
  };

  const validation = validateJSON(jsonText);
  const serverName = registryEntry?.name || serverId || 'MCP Server';

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="w-[900px] sm:max-w-[90vw] overflow-y-auto" showClose={false}>
        <SheetHeader>
          <SheetTitle>
            {isNewServer ? 'Configure' : 'Edit'} {serverName}
          </SheetTitle>
        </SheetHeader>

        <div className="py-6">
          <div className="grid grid-cols-2 gap-6">
            {/* Left Column: JSON Editor */}
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Server Configuration (JSON)
                </label>
                <div className="border rounded-md overflow-hidden">
                  <CodeMirror
                    value={jsonText}
                    height="500px"
                    extensions={[json()]}
                    theme={theme === 'dark' ? oneDark : 'light'}
                    onChange={(value) => handleJSONChange(value)}
                    placeholder="Enter JSON configuration..."
                    basicSetup={{
                      lineNumbers: true,
                      highlightActiveLineGutter: true,
                      highlightActiveLine: true,
                      foldGutter: true,
                      bracketMatching: true,
                      autocompletion: true,
                    }}
                  />
                </div>
              </div>

              {/* Validation Error */}
              {jsonError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{jsonError}</AlertDescription>
                </Alert>
              )}
            </div>

            {/* Right Column: Server Preview */}
            <div>
              <label className="text-sm font-medium mb-2 block">
                Server Preview
              </label>
              <MCPServerPreview
                serverName={serverName}
                isValidJSON={validation.valid}
                testResult={testResult}
                tools={tools}
                isTestingConnection={isTestingConnection}
                isLoadingTools={isLoadingTools}
                onTestConnection={handleTestConnection}
              />
            </div>
          </div>
        </div>

        <SheetFooter className="gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!!jsonError || isTestingConnection || isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </Button>
        </SheetFooter>
      </SheetContent>

      {/* Runtime Choice Dialog */}
      <RuntimeChoiceDialog
        open={runtimeDialogState.isOpen}
        onClose={() => setRuntimeDialogState({ isOpen: false, errorType: null, serverName: '', testConfig: null, metadata: {} })}
        errorType={runtimeDialogState.errorType!}
        serverName={runtimeDialogState.serverName}
        metadata={runtimeDialogState.metadata}
        onUseSystem={handleRuntimeUseSystem}
        onInstallLevante={handleRuntimeInstallLevante}
      />
    </Sheet>
  );
}
