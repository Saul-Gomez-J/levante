import { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, ShieldAlert, Shield } from 'lucide-react';
import { useOAuthStore } from '@/stores/oauthStore';

interface OAuthStatusIndicatorProps {
    serverId: string;
    variant?: 'default' | 'compact';
}

export function OAuthStatusIndicator({
    serverId,
    variant = 'default',
}: OAuthStatusIndicatorProps) {
    const { servers, refreshStatus } = useOAuthStore();
    const server = servers[serverId];

    useEffect(() => {
        refreshStatus(serverId);
    }, [serverId, refreshStatus]);

    if (!server?.hasConfig) {
        return null;
    }

    if (variant === 'compact') {
        return (
            <div className="flex items-center gap-1">
                {server.isTokenValid ? (
                    <ShieldCheck className="h-4 w-4 text-green-500" />
                ) : server.hasTokens ? (
                    <ShieldAlert className="h-4 w-4 text-yellow-500" />
                ) : (
                    <Shield className="h-4 w-4 text-muted-foreground" />
                )}
            </div>
        );
    }

    return (
        <Badge variant={server.isTokenValid ? 'default' : 'secondary'} className="gap-1">
            {server.isTokenValid ? (
                <>
                    <ShieldCheck className="h-3 w-3" />
                    OAuth Active
                </>
            ) : server.hasTokens ? (
                <>
                    <ShieldAlert className="h-3 w-3" />
                    Token Expired
                </>
            ) : (
                <>
                    <Shield className="h-3 w-3" />
                    OAuth
                </>
            )}
        </Badge>
    );
}
