import { useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    ShieldCheck,
    Clock,
    RefreshCw,
    LogOut,
    CheckCircle,
    XCircle,
    AlertTriangle,
    Loader2,
} from 'lucide-react';
import { useOAuthStore } from '@/stores/oauthStore';
import { formatDistanceToNow } from 'date-fns';

interface OAuthPermissionsViewProps {
    serverId: string;
}

export function OAuthPermissionsView({ serverId }: OAuthPermissionsViewProps) {
    const { servers, loading, errors, refreshStatus, refreshToken, disconnect } = useOAuthStore();

    const server = servers[serverId];
    const isLoading = loading[serverId];
    const error = errors[serverId];

    useEffect(() => {
        refreshStatus(serverId);
    }, [serverId, refreshStatus]);

    const handleRefresh = async () => {
        try {
            await refreshToken(serverId);
        } catch (err) {
            console.error('Failed to refresh token:', err);
        }
    };

    const handleDisconnect = async () => {
        if (confirm('Disconnect and revoke access? This will invalidate all tokens.')) {
            try {
                await disconnect(serverId, true);
            } catch (err) {
                console.error('Failed to disconnect:', err);
            }
        }
    };

    if (isLoading && !server) {
        return (
            <Card>
                <CardContent className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        );
    }

    if (!server) {
        return (
            <Alert>
                <AlertDescription>OAuth not configured for this server</AlertDescription>
            </Alert>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5" />
                    OAuth Connection
                </CardTitle>
                <CardDescription>Status and permissions for {serverId}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Status */}
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Connection Status</span>
                    {server.isTokenValid ? (
                        <Badge variant="default" className="gap-1">
                            <CheckCircle className="h-3 w-3" />
                            Connected
                        </Badge>
                    ) : server.hasTokens ? (
                        <Badge variant="secondary" className="gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Token Expired
                        </Badge>
                    ) : (
                        <Badge variant="outline" className="gap-1">
                            <XCircle className="h-3 w-3" />
                            Not Connected
                        </Badge>
                    )}
                </div>

                <Separator />

                {/* Scopes */}
                {server.scopes && server.scopes.length > 0 && (
                    <div className="space-y-2">
                        <span className="text-sm font-medium">Granted Permissions</span>
                        <div className="flex flex-wrap gap-2">
                            {server.scopes.map((scope) => (
                                <Badge key={scope} variant="secondary">
                                    {scope}
                                </Badge>
                            ))}
                        </div>
                    </div>
                )}

                {/* Expiration */}
                {server.expiresAt && (
                    <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            Token expires
                        </span>
                        <span>
                            {server.isTokenValid
                                ? formatDistanceToNow(new Date(server.expiresAt), { addSuffix: true })
                                : 'Expired'}
                        </span>
                    </div>
                )}

                {/* Authorization Server */}
                {server.authServerId && (
                    <div className="text-sm">
                        <span className="text-muted-foreground">Authorization Server: </span>
                        <code className="text-xs">{server.authServerId}</code>
                    </div>
                )}

                <Separator />

                {/* Actions */}
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRefresh}
                        disabled={isLoading || !server.hasTokens}
                    >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Refresh Token
                    </Button>
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleDisconnect}
                        disabled={isLoading}
                    >
                        <LogOut className="mr-2 h-4 w-4" />
                        Disconnect
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
