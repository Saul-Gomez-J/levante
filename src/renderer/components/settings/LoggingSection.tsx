import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { InfoIcon, CheckCircle2, AlertCircle, FileText } from 'lucide-react';
import { SettingsSection } from './SettingsSection';

export function LoggingSection() {
    const [maxSize, setMaxSize] = useState(10); // MB
    const [maxFiles, setMaxFiles] = useState(5);
    const [maxAge, setMaxAge] = useState(7);
    const [compress, setCompress] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const result = await (window as any).levante.preferences.get('logging');
            if (result?.success && result.data?.rotation) {
                const rotation = result.data.rotation;
                setMaxSize(Math.round(rotation.maxSize / (1024 * 1024))); // bytes to MB
                setMaxFiles(rotation.maxFiles);
                setMaxAge(rotation.maxAge);
                setCompress(rotation.compress);
            }
        } catch (error) {
            console.error('Failed to load logging settings:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setSaveStatus('idle');

        try {
            const result = await (window as any).levante.preferences.set('logging', {
                rotation: {
                    maxSize: maxSize * 1024 * 1024, // MB to bytes
                    maxFiles,
                    maxAge,
                    compress,
                    datePattern: 'YYYY-MM-DD-HHmmss'
                }
            });

            if (result?.success) {
                setSaveStatus('success');
                setTimeout(() => setSaveStatus('idle'), 3000);
            } else {
                setSaveStatus('error');
            }
        } catch (error) {
            console.error('Failed to save logging settings:', error);
            setSaveStatus('error');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return null;
    }

    return (
        <SettingsSection
            icon={<FileText className="w-5 h-5" />}
            title="Log Rotation"
        >
            <div className="space-y-6">
                <p className="text-sm text-muted-foreground">
                    Configure automatic log file management to prevent disk space issues.
                </p>

                <Alert>
                    <InfoIcon className="h-4 w-4" />
                    <AlertDescription>
                        Logs are stored in <code className="text-xs bg-muted px-1 py-0.5 rounded">~/levante/levante.log</code>
                    </AlertDescription>
                </Alert>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="maxSize">Maximum File Size (MB)</Label>
                        <Input
                            id="maxSize"
                            type="number"
                            min="1"
                            max="1000"
                            value={maxSize}
                            onChange={e => setMaxSize(Number(e.target.value))}
                        />
                        <p className="text-xs text-muted-foreground">
                            Log file will rotate when it reaches this size
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="maxFiles">Maximum Files to Keep</Label>
                        <Input
                            id="maxFiles"
                            type="number"
                            min="1"
                            max="50"
                            value={maxFiles}
                            onChange={e => setMaxFiles(Number(e.target.value))}
                        />
                        <p className="text-xs text-muted-foreground">
                            Number of rotated log files to keep (older files are deleted)
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="maxAge">Maximum Age (days)</Label>
                        <Input
                            id="maxAge"
                            type="number"
                            min="1"
                            max="365"
                            value={maxAge}
                            onChange={e => setMaxAge(Number(e.target.value))}
                        />
                        <p className="text-xs text-muted-foreground">
                            Log files older than this will be automatically deleted
                        </p>
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label htmlFor="compress">Compress Rotated Logs</Label>
                            <p className="text-xs text-muted-foreground">
                                Saves disk space by gzipping historical log files
                            </p>
                        </div>
                        <Switch
                            id="compress"
                            checked={compress}
                            onCheckedChange={setCompress}
                        />
                    </div>

                    <div className="flex items-center gap-4 pt-4">
                        <Button
                            onClick={handleSave}
                            disabled={saving}
                        >
                            {saving ? 'Saving...' : 'Save Settings'}
                        </Button>

                        {saveStatus === 'success' && (
                            <div className="flex items-center text-green-600 text-sm">
                                <CheckCircle2 className="w-4 h-4 mr-1" />
                                Settings saved
                            </div>
                        )}

                        {saveStatus === 'error' && (
                            <div className="flex items-center text-red-600 text-sm">
                                <AlertCircle className="w-4 h-4 mr-1" />
                                Error saving settings
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </SettingsSection>
    );
}
