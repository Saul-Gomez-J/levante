/**
 * ChatListContent
 *
 * Scrollable content extracted from ChatList.
 * Contains Projects + Conversations sections only.
 */

import { useState, useEffect, useRef } from 'react';
import { Trash2, MoreVertical, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getRawModelId } from '../../../shared/modelRefs';
import type { ChatSession, Project } from '../../../types/database';

export interface ChatListContentProps {
  sessions: ChatSession[];
  currentSessionId?: string;
  onSessionSelect: (sessionId: string) => void;
  onDeleteChat: (sessionId: string) => void;
  onRenameChat: (sessionId: string, newTitle: string) => void;
  loading?: boolean;
  searchQuery: string;
  projects?: Project[];
  selectedProjectId?: string;
  selectedProjectName?: string;
  onProjectSelect?: (project: Project) => void;
  onCreateProject?: () => void;
  onEditProject?: (project: Project) => void;
  onDeleteProject?: (projectId: string, projectName: string, sessionCount: number, cwd?: string | null) => void;
}

export function ChatListContent({
  sessions,
  currentSessionId,
  onSessionSelect,
  onDeleteChat,
  onRenameChat,
  loading = false,
  searchQuery,
  projects = [],
  selectedProjectId,
  selectedProjectName,
  onProjectSelect,
  onCreateProject,
  onEditProject,
  onDeleteProject,
}: ChatListContentProps) {
  const { t } = useTranslation('chat');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const isProjectScope = Boolean(selectedProjectId);

  const baseSessions = isProjectScope
    ? sessions.filter((s) => s.project_id === selectedProjectId)
    : sessions.filter((s) => !s.project_id);

  const filteredSessions = !searchQuery.trim()
    ? baseSessions
    : baseSessions.filter(
        (s) => {
          const q = searchQuery.toLowerCase();
          return (
            s.title?.toLowerCase().includes(q) ||
            s.model.toLowerCase().includes(q) ||
            getRawModelId(s.model).toLowerCase().includes(q)
          );
        }
      );

  const groupedSessions = filteredSessions.reduce((groups, session) => {
    const date = new Date(session.created_at);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let key: string;
    if (date.toDateString() === today.toDateString()) {
      key = 'today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      key = 'yesterday';
    } else if (date.getTime() > today.getTime() - 7 * 24 * 60 * 60 * 1000) {
      key = 'this_week';
    } else if (date.getTime() > today.getTime() - 30 * 24 * 60 * 60 * 1000) {
      key = 'this_month';
    } else {
      key = 'older';
    }

    if (!groups[key]) groups[key] = [];
    groups[key].push(session);
    return groups;
  }, {} as Record<string, ChatSession[]>);

  const sortedGroupKeys = Object.keys(groupedSessions).sort((a, b) => {
    const order = ['today', 'yesterday', 'this_week', 'this_month', 'older'];
    return order.indexOf(a) - order.indexOf(b);
  });

  const handleRenameStart = (session: ChatSession) => {
    setEditingSessionId(session.id);
    setEditingTitle(session.title || '');
  };

  const handleRenameSave = (sessionId: string) => {
    const trimmedTitle = editingTitle.trim();
    if (trimmedTitle && trimmedTitle.length > 0 && trimmedTitle.length <= 50) {
      onRenameChat(sessionId, trimmedTitle);
    }
    setEditingSessionId(null);
    setEditingTitle('');
  };

  const handleRenameCancel = () => {
    setEditingSessionId(null);
    setEditingTitle('');
  };

  useEffect(() => {
    if (editingSessionId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingSessionId]);

  const renderSession = (session: ChatSession) => (
    <div
      key={session.id}
      className={cn(
        'group mx-2 mb-1 rounded-lg cursor-pointer transition-colors',
        'hover:bg-accent/50',
        currentSessionId === session.id && 'bg-accent'
      )}
      onClick={() => editingSessionId !== session.id && onSessionSelect(session.id)}
    >
      <div className="flex items-center gap-2 p-1">
        <div className="flex-1 min-w-0">
          {editingSessionId === session.id ? (
            <Input
              ref={inputRef}
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleRenameSave(session.id);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  handleRenameCancel();
                }
              }}
              onBlur={() => handleRenameSave(session.id)}
              onClick={(e) => e.stopPropagation()}
              className="h-7 text-sm"
              maxLength={50}
            />
          ) : (
            <div className="text-sm font-medium truncate">{session.title || 'Untitled Chat'}</div>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleRenameStart(session);
              }}
            >
              <Pencil size={14} className="mr-2" />
              {t('chat_list.rename_chat')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.stopPropagation();
                onDeleteChat(session.id);
              }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 size={14} className="mr-2" />
              {t('chat_list.delete_chat')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        {t('chat_list.loading')}
      </div>
    );
  }

  return (
    <>
      <div className="pt-2">
        {filteredSessions.length > 0 ? (
          <div>
            {isProjectScope ? (
              <div>
                <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {t('chat_list.project_history', { projectName: selectedProjectName || selectedProjectId })}
                </div>
                {filteredSessions
                  .sort((a, b) => b.updated_at - a.updated_at)
                  .map((session) => renderSession(session))}
              </div>
            ) : (
              sortedGroupKeys.map((groupKey) => (
                <div key={groupKey}>
                  <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {t(`chat_list.groups.${groupKey}`)}
                  </div>
                  {groupedSessions[groupKey]
                    .sort((a, b) => b.updated_at - a.updated_at)
                    .map((session) => renderSession(session))}
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="p-4 text-center text-muted-foreground">
            {searchQuery ? t('chat_list.no_results') : t('chat_list.no_chats')}
          </div>
        )}
      </div>
    </>
  );
}
