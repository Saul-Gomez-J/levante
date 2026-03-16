import React, { useState, useEffect } from 'react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar
} from '@/components/ui/sidebar'
import { MessageSquare, Settings, User, Bot, Store, Plus, PanelLeftClose, PanelLeft, FileText, LogOut, Loader2, Zap } from 'lucide-react'
import { getRendererLogger } from '@/services/logger'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'
import { usePlatformStore } from '@/stores/platformStore'
// @ts-ignore - PNG import
import logoIcon from '@/assets/icons/icon.png'

const logger = getRendererLogger();

interface MainLayoutProps {
  children: React.ReactNode
  title?: string
  currentPage?: string
  onPageChange?: (page: string) => void
  sidebarContent?: React.ReactNode // Custom sidebar content for specific pages
  onNewChat?: () => void // Callback for New Chat button
  developerMode?: boolean // Show developer-only features
  selectedProjectName?: string
}

// Inner component that has access to useSidebar
function MainLayoutContent({ children, title, currentPage, onPageChange, sidebarContent, onNewChat, developerMode, selectedProjectName, version, platform }: MainLayoutProps & { version: string; platform: string }) {
  const { open } = useSidebar()
  const { t } = useTranslation('common')
  const appMode = usePlatformStore((s) => s.appMode)
  const platformUser = usePlatformStore((s) => s.user)
  const platformLogout = usePlatformStore((s) => s.logout)
  const platformLogin = usePlatformStore((s) => s.login)
  const platformLoading = usePlatformStore((s) => s.isLoading)
  const platformIsAuthenticated = usePlatformStore((s) => s.isAuthenticated)
  const isPlatformMode = appMode === 'platform'

  const userInitials = platformUser?.email
    ? platformUser.email.slice(0, 2).toUpperCase()
    : '?'

  return (
    <>
      <Sidebar>
        <SidebarHeader style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <div className="flex flex-col gap-2 p-2 pt-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {/* Logo, title and toggle on the same row */}
            <div className={`flex items-center justify-between ${platform === 'darwin' ? 'pt-8' : 'pt-2'}`}>
              <button
                onClick={onNewChat}
                className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer"
                title={t('actions.new_chat')}
              >
                <img
                  src={logoIcon}
                  alt={t('app.logo_alt')}
                  className="w-6 h-6 rounded-sm"
                />
                <h2 className="text-lg font-semibold">{t('app.name')}</h2>
              </button>

              {/* Sidebar toggle - only show when sidebar is open */}
              {open && (
                <SidebarTrigger className="h-7 w-7 shrink-0" />
              )}
            </div>

          </div>
        </SidebarHeader>
        <SidebarContent>
          {sidebarContent ? (
            // Custom sidebar content for specific pages (like ChatList for chat page)
            sidebarContent
          ) : (
            // Default navigation sidebar
            <SidebarGroup>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => onPageChange?.('chat')}
                    isActive={currentPage === 'chat'}
                  >
                    <MessageSquare className="w-4 h-4" />
                    {t('navigation.chat')}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          )}
        </SidebarContent>
        <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => onPageChange?.('store')}
              isActive={currentPage === 'store'}
            >
              <Store className="w-4 h-4" />
              {t('navigation.mcp')}
            </SidebarMenuButton>
          </SidebarMenuItem>
          {isPlatformMode ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => onPageChange?.('account')}
                isActive={currentPage === 'account'}
              >
                <User className="w-4 h-4" />
                {t('navigation.account')}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => onPageChange?.('model')}
                isActive={currentPage === 'model'}
              >
                <Bot className="w-4 h-4" />
                {t('navigation.models')}
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => onPageChange?.('settings')}
              isActive={currentPage === 'settings'}
            >
              <Settings className="w-4 h-4" />
              {t('navigation.settings')}
            </SidebarMenuButton>
          </SidebarMenuItem>
          {developerMode && (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => onPageChange?.('logs')}
                isActive={currentPage === 'logs'}
              >
                <FileText className="w-4 h-4" />
                {t('navigation.logs')}
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
          <div className="border-t pt-2 px-2 space-y-1">
            {platformIsAuthenticated && platformUser?.email ? (
              <div className="flex items-center gap-2 px-1 py-1.5 rounded-md hover:bg-muted/50 group">
                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/15 text-primary text-[11px] font-semibold shrink-0">
                  {userInitials}
                </div>
                <span className="flex-1 text-xs text-muted-foreground truncate">
                  {platformUser.email}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  title={t('actions.log_out', 'Log out')}
                  onClick={platformLogout}
                >
                  <LogOut className="w-3.5 h-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <Button
                  className="flex-1"
                  onClick={() => platformLogin()}
                  disabled={platformLoading}
                >
                  {platformLoading
                    ? t('platform.signing_in', 'Signing in...')
                    : t('platform.sign_in', 'Sign in')}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => window.levante.openExternal('https://www.levanteapp.com/feedback')}
                >
                  {t('actions.feedback')}
                </Button>
              </div>
            )}
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className='rounded-l-2xl h-screen flex flex-col overflow-hidden'>
        {/* Custom titlebar for macOS - draggable area with controls */}
        <header
          className="flex shrink-0 items-center h-12 px-2"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {/* Only show controls when sidebar is closed */}
          {!open && (
            <div
              className="flex items-center gap-1 ml-16"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <SidebarTrigger className="h-7 w-7" />
              <Button
                variant="ghost"
                size="sm"
                onClick={onNewChat}
                className="h-7 px-2 gap-1"
                title={t('actions.new_chat')}
              >
                <Plus size={14} />
                <span className="text-xs">{t('actions.new_chat')}</span>
              </Button>
              {selectedProjectName && (
                <span className="text-xs text-muted-foreground truncate max-w-32 ml-1" title={selectedProjectName}>
                  {selectedProjectName}
                </span>
              )}
            </div>
          )}

          {/* Center title */}
          <div className={`flex-1 text-center ${!open ? '' : 'ml-16'}`}>
            <h1 className="text-sm font-medium text-muted-foreground">{title}</h1>
          </div>

          {/* Right side spacer to balance layout */}
          {!open && <div className="w-32"></div>}
        </header>

        <div className="flex-1 flex flex-col px-0 py-2 min-h-0">
          {children}
        </div>
      </SidebarInset>
    </>
  )
}

export function MainLayout({ children, title = 'Chat', currentPage = 'chat', onPageChange, sidebarContent, onNewChat, developerMode, selectedProjectName }: MainLayoutProps) {
  const [version, setVersion] = useState<string>('')
  const [platform, setPlatform] = useState<string>('')

  useEffect(() => {
    const loadAppInfo = async () => {
      try {
        const appVersion = await window.levante.getVersion()
        const appPlatform = await window.levante.getPlatform()
        setVersion(appVersion)
        setPlatform(appPlatform)
      } catch (error) {
        logger.core.error('Failed to load app info in MainLayout', { error: error instanceof Error ? error.message : error })
      }
    }

    loadAppInfo()
  }, [])

  return (
    <SidebarProvider>
      <MainLayoutContent
        children={children}
        title={title}
        currentPage={currentPage}
        onPageChange={onPageChange}
        sidebarContent={sidebarContent}
        onNewChat={onNewChat}
        developerMode={developerMode}
        selectedProjectName={selectedProjectName}
        version={version}
        platform={platform}
      />
    </SidebarProvider>
  )
}
