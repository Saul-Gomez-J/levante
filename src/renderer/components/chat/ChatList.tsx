import { useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { ChatListContent } from './ChatListContent';
import { ChatSession, Project } from '../../../types/database';

interface ChatListProps {
  sessions: ChatSession[];
  currentSessionId?: string;
  onSessionSelect: (sessionId: string) => void;
  onNewChat: () => void;
  onDeleteChat: (sessionId: string) => void;
  onRenameChat: (sessionId: string, newTitle: string) => void;
  loading?: boolean;
  projects?: Project[];
  selectedProjectId?: string;
  onProjectSelect?: (project: Project) => void;
  onCreateProject?: () => void;
  onEditProject?: (project: Project) => void;
  onDeleteProject?: (projectId: string, projectName: string, sessionCount: number, cwd?: string | null) => void;
}

export function ChatList({
  sessions,
  currentSessionId,
  onSessionSelect,
  onNewChat,
  onDeleteChat,
  onRenameChat,
  loading = false,
  projects = [],
  selectedProjectId,
  onProjectSelect,
  onCreateProject,
  onEditProject,
  onDeleteProject,
}: ChatListProps) {
  const { t } = useTranslation('chat');
  const [searchQuery, setSearchQuery] = useState('');

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
            placeholder={t('chat_list.search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <ChatListContent
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSessionSelect={onSessionSelect}
          onDeleteChat={onDeleteChat}
          onRenameChat={onRenameChat}
          loading={loading}
          searchQuery={searchQuery}
          projects={projects}
          selectedProjectId={selectedProjectId}
          onProjectSelect={onProjectSelect}
          onCreateProject={onCreateProject}
          onEditProject={onEditProject}
          onDeleteProject={onDeleteProject}
        />
      </div>
    </div>
  );
}
