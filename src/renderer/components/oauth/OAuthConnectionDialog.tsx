import { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, ShieldCheck, ExternalLink } from 'lucide-react';
import { useOAuthStore } from '@/stores/oauthStore';

export function OAuthConnectionDialog() {
    const {
        authorize,
        clearError,
        errors,
        loading,
        pendingAuth,
        clearPendingAuth,
    } = useOAuthStore();
    const [scopes, setScopes] = useState('mcp:read mcp:write');
    const [clientId, setClientId] = useState('');

    const currentError = pendingAuth ? errors[pendingAuth.serverId] : null;
    const isAuthorizing = pendingAuth ? loading[pendingAuth.serverId] : false;

    const handleAuthorize = async () => {
        if (!pendingAuth) return;

        clearError(pendingAuth.serverId);

        try {
            await authorize({
                serverId: pendingAuth.serverId,
                mcpServerUrl: pendingAuth.mcpServerUrl,
                scopes: scopes.split(' ').filter(Boolean),
                clientId: clientId || undefined,
                wwwAuthHeader: pendingAuth.wwwAuth,
            });

            clearPendingAuth();
        } catch {
            // Error handled via store state
        }
    };

    return (
        <Dialog open={!!pendingAuth} onOpenChange={(open) => !open && clearPendingAuth()}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5" />
                        OAuth Authorization
                    </DialogTitle>
                    <DialogDescription>
                        {pendingAuth ? (
                            <>Connect to <strong>{pendingAuth.mcpServerUrl}</strong> using OAuth 2.1</>
                        ) : (
                            'Waiting for OAuth request...'
                        )}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Scopes */}
                    <div className="space-y-2">
                        <Label htmlFor="scopes">Scopes (space-separated)</Label>
                        <Input
                            id="scopes"
                            value={scopes}
                            onChange={(e) => setScopes(e.target.value)}
                            placeholder="mcp:read mcp:write"
                            disabled={isAuthorizing}
                        />
                        <p className="text-xs text-muted-foreground">
                            Permissions requested from the MCP server
                        </p>
                    </div>

                    {/* Client ID (optional) */}
                    <div className="space-y-2">
                        <Label htmlFor="client-id">
                            Client ID <span className="text-muted-foreground">(optional)</span>
                        </Label>
                        <Input
                            id="client-id"
                            value={clientId}
                            onChange={(e) => setClientId(e.target.value)}
                            placeholder="Auto-register if empty"
                            disabled={isAuthorizing}
                        />
                        <p className="text-xs text-muted-foreground">
                            Leave empty to use Dynamic Client Registration
                        </p>
                    </div>

                    {/* Info */}
                    <Alert>
                        <ExternalLink className="h-4 w-4" />
                        <AlertDescription>
                            Your browser will open to complete the authorization. After approving,
                            you can close the browser window and return to Levante.
                        </AlertDescription>
                    </Alert>

                    {/* Error */}
                    {currentError && (
                        <Alert variant="destructive">
                            <AlertDescription>{currentError}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => clearPendingAuth()}
                        disabled={isAuthorizing}
                    >
                        Cancel
                    </Button>
                    <Button onClick={handleAuthorize} disabled={isAuthorizing || !pendingAuth}>
                        {isAuthorizing ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Authorizing...
                            </>
                        ) : (
                            <>
                                <ShieldCheck className="mr-2 h-4 w-4" />
                                Authorize
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
