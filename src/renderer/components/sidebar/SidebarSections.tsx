/**
 * SidebarSections
 *
 * Header + search + tabs (Chats/Files) + content switching.
 */

import { useState, useEffect } from 'react';
import { Search, Plus, MessageSquare, FolderTree } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { ChatListContent, type ChatListContentProps } from '@/components/chat/ChatListContent';
import { FileBrowserContent } from '@/components/file-browser';

type SidebarSection = 'chats' | 'files';

export interface SidebarSectionsProps {
  chatListProps: Omit<ChatListContentProps, 'searchQuery'>;
  onNewChat: () => void;
  loading?: boolean;
  coworkModeEnabled: boolean;
  effectiveCwd: string | null;
}

export function SidebarSections({
  chatListProps,
  onNewChat,
  loading,
  coworkModeEnabled,
  effectiveCwd,
}: SidebarSectionsProps) {
  const { t } = useTranslation('chat');
  const [activeSection, setActiveSection] = useState<SidebarSection>('chats');
  const [searchQuery, setSearchQuery] = useState('');

  const showFilesTab = coworkModeEnabled && Boolean(effectiveCwd);

  useEffect(() => {
    if (!showFilesTab && activeSection === 'files') {
      setActiveSection('chats');
    }
  }, [showFilesTab, activeSection]);

  useEffect(() => {
    setSearchQuery('');
  }, [activeSection]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <Button
          onClick={onNewChat}
          className="w-full mb-3 justify-start gap-2"
          disabled={loading}
        >
          <Plus size={16} />
          {t('chat_list.new_chat')}
        </Button>

        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground"
            size={16}
          />
          <Input
            placeholder={
              activeSection === 'chats'
                ? t('chat_list.search_placeholder')
                : t('chat_list.file_browser.search_files_placeholder')
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {showFilesTab && (
        <div className="flex border-b shrink-0">
          <button
            onClick={() => setActiveSection('chats')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors',
              activeSection === 'chats'
                ? 'text-foreground border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <MessageSquare size={13} />
            {t('chat_list.file_browser.tab_chats')}
          </button>

          <button
            onClick={() => setActiveSection('files')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors',
              activeSection === 'files'
                ? 'text-foreground border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <FolderTree size={13} />
            {t('chat_list.file_browser.tab_files')}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0">
        {activeSection === 'chats' || !showFilesTab ? (
          <ChatListContent {...chatListProps} searchQuery={searchQuery} />
        ) : (
          <FileBrowserContent searchQuery={searchQuery} cwd={effectiveCwd!} />
        )}
      </div>
    </div>
  );
}
