import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, AlertCircle, X } from 'lucide-react';
import { useMCPStore } from '@/stores/mcpStore';
import { useOAuthStore } from '@/stores/oauthStore';
import { MCPServerConfig } from '@/types/mcp';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface FormMCPConfigProps {
  serverId: string | null;
  onClose: () => void;
  onConfigChange?: (config: any | null) => void;
}

type ConnectionType = 'stdio' | 'http';
type AuthType = 'none' | 'bearer';

interface EnvVariable {
  key: string;
  value: string;
}

interface CustomHeader {
  key: string;
  value: string;
}

// Generate a sanitized ID from the server name
const sanitizeNameToId = (name: string): string => {
  const sanitized = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')           // Replace spaces with hyphens
    .replace(/[^a-z0-9-_]/g, '')    // Remove special characters
    .replace(/-+/g, '-')            // Replace multiple hyphens with single
    .replace(/^-|-$/g, '');         // Remove leading/trailing hyphens

  return sanitized || `server-${Date.now()}`;
};

export function FormMCPConfig({ serverId, onClose, onConfigChange }: FormMCPConfigProps) {
  const { t } = useTranslation('mcp');
  const { addServer, connectServer } = useMCPStore();

  // Form state
  const [name, setName] = useState('');
  const [connectionType, setConnectionType] = useState<ConnectionType>('http');
  const [authType, setAuthType] = useState<AuthType>('none');

  // STDIO specific
  const [command, setCommand] = useState('');
  const [envVariables, setEnvVariables] = useState<EnvVariable[]>([]);

  // HTTP specific
  const [url, setUrl] = useState('');
  const [bearerToken, setBearerToken] = useState('');
  const [customHeaders, setCustomHeaders] = useState<CustomHeader[]>([]);

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Notify parent of config changes
  useEffect(() => {
    if (!onConfigChange) return;

    if (!name.trim()) {
      onConfigChange(null);
      return;
    }

    const config: any = {
      id: sanitizeNameToId(name),
      name: name.trim(),
      transport: connectionType,
    };

    if (connectionType === 'stdio') {
      if (!command.trim()) {
        onConfigChange(null);
        return;
      }
      const parts = command.trim().split(/\s+/);
      config.command = parts[0];
      config.args = parts.slice(1);

      const env: Record<string, string> = {};
      envVariables.forEach(({ key, value }) => {
        if (key.trim()) {
          env[key.trim()] = value;
        }
      });
      if (Object.keys(env).length > 0) {
        config.env = env;
      }
    } else {
      if (!url.trim()) {
        onConfigChange(null);
        return;
      }
      config.url = url.trim();

      const headers: Record<string, string> = {};

      if (authType === 'bearer' && bearerToken.trim()) {
        headers['Authorization'] = `Bearer ${bearerToken.trim()}`;
      }

      customHeaders.forEach(({ key, value }) => {
        if (key.trim()) {
          headers[key.trim()] = value;
        }
      });

      if (Object.keys(headers).length > 0) {
        config.headers = headers;
      }
    }

    onConfigChange(config);
  }, [name, connectionType, command, envVariables, url, authType, bearerToken, customHeaders, onConfigChange]);

  const handleAddEnvVariable = () => {
    setEnvVariables([...envVariables, { key: '', value: '' }]);
  };

  const handleRemoveEnvVariable = (index: number) => {
    setEnvVariables(envVariables.filter((_, i) => i !== index));
  };

  const handleEnvVariableChange = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...envVariables];
    updated[index][field] = value;
    setEnvVariables(updated);
  };

  const handleAddHeader = () => {
    setCustomHeaders([...customHeaders, { key: '', value: '' }]);
  };

  const handleRemoveHeader = (index: number) => {
    setCustomHeaders(customHeaders.filter((_, i) => i !== index));
  };

  const handleHeaderChange = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...customHeaders];
    updated[index][field] = value;
    setCustomHeaders(updated);
  };

  const validate = (): boolean => {
    if (!name.trim()) {
      setError(t('config.form.error_name_required'));
      return false;
    }

    if (connectionType === 'stdio') {
      if (!command.trim()) {
        setError(t('config.form.error_command_required'));
        return false;
      }
    } else {
      if (!url.trim()) {
        setError(t('config.form.error_url_required'));
        return false;
      }
      try {
        new URL(url.trim());
      } catch {
        setError(t('config.form.error_invalid_url'));
        return false;
      }
    }

    setError(null);
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;

    setIsSaving(true);
    setError(null);

    try {
      const serverConfig: MCPServerConfig = {
        id: sanitizeNameToId(name),
        name: name.trim(),
        transport: connectionType,
      };

      if (connectionType === 'stdio') {
        const parts = command.trim().split(/\s+/);
        serverConfig.command = parts[0];
        serverConfig.args = parts.slice(1);

        const env: Record<string, string> = {};
        envVariables.forEach(({ key, value }) => {
          if (key.trim()) {
            env[key.trim()] = value;
          }
        });
        if (Object.keys(env).length > 0) {
          serverConfig.env = env;
        }
      } else {
        serverConfig.url = url.trim();

        const headers: Record<string, string> = {};

        if (authType === 'bearer' && bearerToken.trim()) {
          headers['Authorization'] = `Bearer ${bearerToken.trim()}`;
        }

        customHeaders.forEach(({ key, value }) => {
          if (key.trim()) {
            headers[key.trim()] = value;
          }
        });

        if (Object.keys(headers).length > 0) {
          serverConfig.headers = headers;
        }
      }

      // 1. Guardar configuración
      await addServer(serverConfig);

      // 2. Intentar conectar automáticamente
      const toastId = toast.loading(t('messages.connecting', { name: serverConfig.name }));

      try {
        await connectServer(serverConfig);
        toast.success(t('messages.added', { name: serverConfig.name }), { id: toastId });
        onClose();
      } catch (connectError: any) {
        // Manejar OAuth requerido
        if (connectError.code === 'OAUTH_REQUIRED') {
          const { handleOAuthRequired } = useOAuthStore.getState();
          handleOAuthRequired({
            serverId: connectError.serverConfig?.id || serverConfig.id,
            mcpServerUrl: connectError.metadata?.mcpServerUrl || '',
            wwwAuth: connectError.metadata?.wwwAuth || ''
          });

          toast.info(t('messages.oauth_required', { name: serverConfig.name }), { id: toastId });
          onClose();
          return;
        }

        // Manejar errores de runtime
        if (connectError.errorCode === 'RUNTIME_NOT_FOUND' || connectError.message === 'RUNTIME_NOT_FOUND') {
          toast.error(t('messages.runtime_not_available'), { id: toastId });
          onClose();
          return;
        }

        // Otros errores: servidor guardado pero no conectado
        toast.warning(t('messages.added_not_connected', { name: serverConfig.name }), { id: toastId });
        onClose();
      }
    } catch (err) {
      setError(t('config.save_error'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Server Name */}
      <div className="space-y-2">
        <Label htmlFor="server-name">{t('config.form.name_label')}</Label>
        <Input
          id="server-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('config.form.name_placeholder')}
        />
      </div>

      {/* Connection Type + Command/URL (same line) */}
      <div className="space-y-2">
        <Label>{t('config.form.connection_type_label')}</Label>
        <div className="flex gap-2">
          <Select value={connectionType} onValueChange={(v) => setConnectionType(v as ConnectionType)}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stdio">STDIO</SelectItem>
              <SelectItem value="http">HTTP</SelectItem>
            </SelectContent>
          </Select>
          {connectionType === 'stdio' && (
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={t('config.form.command_placeholder')}
              className="flex-1"
            />
          )}
          {connectionType === 'http' && (
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('config.form.url_placeholder')}
              className="flex-1"
            />
          )}
        </div>
      </div>

      {/* STDIO Fields */}
      {connectionType === 'stdio' && (
        <>
          {/* Environment Variables */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('config.form.env_variables_label')}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddEnvVariable}
              >
                {t('config.form.add_env')}
              </Button>
            </div>
            {envVariables.length > 0 && (
              <div className="space-y-2">
                {envVariables.map((env, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      placeholder={t('config.form.env_key_placeholder')}
                      value={env.key}
                      onChange={(e) => handleEnvVariableChange(index, 'key', e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder={t('config.form.env_value_placeholder')}
                      value={env.value}
                      onChange={(e) => handleEnvVariableChange(index, 'value', e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveEnvVariable(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* HTTP Fields */}
      {connectionType === 'http' && (
        <>
          {/* Authentication */}
          <div className="space-y-2">
            <Label>{t('config.form.auth_label')}</Label>
            <Select value={authType} onValueChange={(v) => setAuthType(v as AuthType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('config.form.auth_none')}</SelectItem>
                <SelectItem value="bearer">{t('config.form.auth_bearer')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Bearer Token */}
          {authType === 'bearer' && (
            <div className="space-y-2">
              <Label htmlFor="bearerToken">{t('config.form.bearer_token_label')}</Label>
              <Input
                id="bearerToken"
                type="password"
                value={bearerToken}
                onChange={(e) => setBearerToken(e.target.value)}
                placeholder={t('config.form.bearer_token_placeholder')}
              />
            </div>
          )}

          {/* Custom Headers */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('config.form.custom_headers_label')}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddHeader}
              >
                {t('config.form.add_header')}
              </Button>
            </div>
            {customHeaders.length > 0 && (
              <div className="space-y-2">
                {customHeaders.map((header, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      placeholder={t('config.form.header_name_placeholder')}
                      value={header.key}
                      onChange={(e) => handleHeaderChange(index, 'key', e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder={t('config.form.header_value_placeholder')}
                      value={header.value}
                      onChange={(e) => handleHeaderChange(index, 'value', e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveHeader(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button
          variant="outline"
          onClick={onClose}
          disabled={isSaving}
        >
          {t('dialog.cancel')}
        </Button>
        <Button
          onClick={handleSave}
          disabled={isSaving || !name.trim()}
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              {t('config.saving')}
            </>
          ) : (
            t('config.form.add_server')
          )}
        </Button>
      </div>
    </div>
  );
}
