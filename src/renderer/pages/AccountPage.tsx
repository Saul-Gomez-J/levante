/**
 * AccountPage - Levante Platform account management
 * Only visible in platform mode. Shows user info, allowed models, and logout.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlatformStore } from '@/stores/platformStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { User, Mail, Building2, RefreshCw, LogOut, Bot, Loader2, ExternalLink } from 'lucide-react';

export default function AccountPage() {
  const { t } = useTranslation('account');
  const { t: tc } = useTranslation('common');
  const { user, models, isLoading, fetchModels, logout } = usePlatformStore();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleRefreshModels = async () => {
    await fetchModels();
  };

  const handleLogout = async () => {
    setShowLogoutConfirm(false);
    await logout();
  };

  const handleOpenPlatform = () => {
    window.levante.openExternal('http://localhost:3000');
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl mx-auto">
      {/* User Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {t('title')}
          </CardTitle>
          <CardDescription>
            {t('description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {user?.email && (
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{user.email}</span>
            </div>
          )}
          {user?.orgId && (
            <div className="flex items-center gap-3">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {t('org_label', { orgId: user.orgId })}
              </span>
            </div>
          )}
          <Separator />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleOpenPlatform}>
              <ExternalLink className="h-4 w-4 mr-2" />
              {t('manage_plan')}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setShowLogoutConfirm(true)}>
              <LogOut className="h-4 w-4 mr-2" />
              {t('log_out')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Allowed Models */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                {t('models_title')}
              </CardTitle>
              <CardDescription>
                {t('models_description', { count: models.length })}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshModels}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {models.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('no_models')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {models.map((model) => (
                <Badge key={model.id} variant="secondary" className="text-xs">
                  {model.name || model.id}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Logout Confirmation Dialog */}
      <AlertDialog open={showLogoutConfirm} onOpenChange={setShowLogoutConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('logout_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('logout_confirm_description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout}>
              {t('log_out')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
