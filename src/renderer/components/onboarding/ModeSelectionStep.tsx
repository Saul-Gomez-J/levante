/**
 * ModeSelectionStep - Choose between Levante Platform and standalone mode
 *
 * Platform mode: OAuth login with Levante Platform
 * Standalone mode: Configure your own API keys
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Zap, Key, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { usePlatformStore } from '@/stores/platformStore';

interface ModeSelectionStepProps {
  onPlatformLogin: () => void;
  onStandaloneSelect: () => void;
  isPlatformConnected: boolean;
}

export function ModeSelectionStep({
  onPlatformLogin,
  onStandaloneSelect,
  isPlatformConnected,
}: ModeSelectionStepProps) {
  const { t } = useTranslation('wizard');
  const { login, isLoading, error } = usePlatformStore();
  const [loginError, setLoginError] = useState<string | null>(null);

  const handlePlatformLogin = async () => {
    try {
      setLoginError(null);
      await login();
      onPlatformLogin();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">
          {t('modeSelection.title', 'How do you want to use Levante?')}
        </h2>
        <p className="text-muted-foreground">
          {t('modeSelection.subtitle', 'Choose how you want to access AI models')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
        {/* Platform Mode Card */}
        <Card
          className={`cursor-pointer transition-all hover:border-primary/50 ${
            isPlatformConnected ? 'border-primary bg-primary/5' : ''
          }`}
          onClick={!isLoading && !isPlatformConnected ? handlePlatformLogin : undefined}
        >
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Levante Platform</h3>
                <Badge variant="secondary" className="text-xs">
                  {t('modeSelection.recommended', 'Recommended')}
                </Badge>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {t(
                'modeSelection.platformDescription',
                'Sign in with your Levante account. Access all models included in your plan with no API keys needed.'
              )}
            </p>
            {isPlatformConnected ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  {t('modeSelection.connected', 'Connected')}
                </div>
                <Button
                  className="w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlatformLogin();
                  }}
                >
                  {t('modeSelection.continue', 'Continue')}
                </Button>
              </div>
            ) : (
              <Button
                className="w-full"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePlatformLogin();
                }}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('modeSelection.connecting', 'Connecting...')}
                  </>
                ) : (
                  t('modeSelection.signIn', 'Sign in with Levante')
                )}
              </Button>
            )}
            {(loginError || error) && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {loginError || error}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Standalone Mode Card */}
        <Card
          className="cursor-pointer transition-all hover:border-primary/50"
          onClick={onStandaloneSelect}
        >
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-muted">
                <Key className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-semibold">
                {t('modeSelection.standalone', 'Use your own API keys')}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground">
              {t(
                'modeSelection.standaloneDescription',
                'Configure providers like OpenRouter, OpenAI, Anthropic, and more with your own API keys.'
              )}
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={(e) => {
                e.stopPropagation();
                onStandaloneSelect();
              }}
            >
              {t('modeSelection.configureKeys', 'Configure API keys')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
