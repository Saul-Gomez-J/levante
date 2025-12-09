import React, { useEffect, useState } from 'react';
import { SettingsSection } from './SettingsSection';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { RuntimeInfo } from '../../../types/runtime';
import { Trash2, RefreshCw, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const RuntimesSection = () => {
    const { t } = useTranslation();
    const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [preferSystemRuntimes, setPreferSystemRuntimes] = useState(false);

    const fetchRuntimes = async () => {
        setLoading(true);
        try {
            const result = await window.levante.mcp.getRuntimes();
            if (result.success && result.data) {
                setRuntimes(result.data);
            } else {
                console.error('Failed to fetch runtimes:', result.error);
            }
        } catch (error) {
            console.error('Failed to fetch runtimes:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleCleanup = async () => {
        try {
            setLoading(true);
            const result = await window.levante.mcp.cleanupRuntimes();
            if (!result.success) {
                console.error('Failed to cleanup runtimes:', result.error);
            }
            await fetchRuntimes();
        } catch (error) {
            console.error('Failed to cleanup runtimes:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleInstall = async (type: 'node' | 'python') => {
        try {
            setLoading(true);
            const version = type === 'node' ? '22.11.0' : '3.13.0';
            const result = await window.levante.mcp.installRuntime(type, version);
            if (!result.success) {
                console.error('Failed to install runtime:', result.error);
            }
            await fetchRuntimes();
        } catch (error) {
            console.error('Failed to install runtime:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const loadPreference = async () => {
            try {
                const result = await window.levante.preferences.get('runtime');
                if (result.success && result.data) {
                    setPreferSystemRuntimes(result.data.preferSystemRuntimes);
                }
            } catch (error) {
                console.error('Failed to load runtime preference:', error);
            }
        };

        loadPreference();
        fetchRuntimes();
    }, []);

    const handlePreferenceChange = async (checked: boolean) => {
        try {
            setPreferSystemRuntimes(checked);
            await window.levante.preferences.set('runtime', {
                preferSystemRuntimes: checked
            });
        } catch (error) {
            console.error('Failed to save runtime preference:', error);
        }
    };

    return (
        <SettingsSection icon={<Zap className="w-5 h-5" />} title={t('settings:runtimes.title')}>
            <p className="text-sm text-muted-foreground mb-4">
                {t('settings:runtimes.description')}
            </p>

            {/* Runtime Preference Toggle */}
            <div className="flex items-start justify-between mb-6 p-4 border rounded-lg bg-muted/30">
                <div className="space-y-2 flex-1 mr-4">
                    <div className="flex items-center gap-2">
                        <Label htmlFor="preferSystemRuntimes" className="text-base font-medium">
                            {t('settings:runtimes.preference.title')}
                        </Label>
                        {!preferSystemRuntimes && (
                            <Badge variant="default" className="text-xs">
                                {t('settings:runtimes.preference.recommended')}
                            </Badge>
                        )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                        {preferSystemRuntimes
                            ? t('settings:runtimes.preference.system_desc')
                            : t('settings:runtimes.preference.levante_desc')
                        }
                    </p>
                </div>
                <Switch
                    id="preferSystemRuntimes"
                    checked={preferSystemRuntimes}
                    onCheckedChange={handlePreferenceChange}
                />
            </div>

            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <p className="text-sm text-muted-foreground">
                        {t('settings:runtimes.auto_manage')}
                    </p>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleInstall('node')} disabled={loading}>
                            {t('settings:runtimes.buttons.install_node')}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleInstall('python')} disabled={loading}>
                            {t('settings:runtimes.buttons.install_python')}
                        </Button>
                        <Button variant="outline" size="sm" onClick={fetchRuntimes} disabled={loading}>
                            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                            {t('settings:runtimes.buttons.refresh')}
                        </Button>
                        <Button variant="destructive" size="sm" onClick={handleCleanup} disabled={loading}>
                            <Trash2 className="h-4 w-4 mr-2" />
                            {t('settings:runtimes.buttons.cleanup')}
                        </Button>
                    </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    {runtimes.map((runtime) => (
                        <Card key={`${runtime.type}-${runtime.version}`}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium capitalize flex items-center gap-2">
                                    {runtime.type}
                                    {runtime.usedBy && runtime.usedBy.length > 0 && (
                                        <Badge variant="secondary" className="text-xs font-normal">
                                            {runtime.usedBy.length} {runtime.usedBy.length === 1
                                                ? t('settings:runtimes.servers_count', { count: runtime.usedBy.length })
                                                : t('settings:runtimes.servers_count_plural', { count: runtime.usedBy.length })
                                            }
                                        </Badge>
                                    )}
                                </CardTitle>
                                <Badge variant="secondary">v{runtime.version}</Badge>
                            </CardHeader>
                            <CardContent>
                                <div className="text-xs text-muted-foreground break-all">
                                    {runtime.path}
                                </div>
                                <div className="mt-2 text-xs text-muted-foreground">
                                    {t('settings:runtimes.source')}: <span className="capitalize">{runtime.source}</span>
                                </div>

                                {/* Show servers using this runtime */}
                                {runtime.usedBy && runtime.usedBy.length > 0 && (
                                    <div className="mt-3 pt-3 border-t">
                                        <p className="text-xs font-medium mb-2">{t('settings:runtimes.used_by')}:</p>
                                        <div className="flex flex-wrap gap-1">
                                            {runtime.usedBy.map(serverId => (
                                                <Badge key={serverId} variant="outline" className="text-xs">
                                                    {serverId}
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    ))}

                    {runtimes.length === 0 && !loading && (
                        <div className="col-span-2 text-center py-8 text-muted-foreground text-sm border rounded-lg border-dashed">
                            {t('settings:runtimes.empty_state')}
                        </div>
                    )}
                </div>
            </div>
        </SettingsSection>
    );
};
