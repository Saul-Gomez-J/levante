/**
 * ChatListContent
 *
 * Scrollable content extracted from ChatList.
 * Contains Projects + Conversations sections only.
 */

import { useState, useEffect, useRef } from 'react';
import { Trash2, MoreVertical, Pencil, FolderOpen, Plus } from 'lucide-react';
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
  onProjectSelect?: (project: Project) => void;
  onCreateProject?: () => void;
  onEditProject?: (project: Project) => void;
  onDeleteProject?: (projectId: string, projectName: string, sessionCount: number) => void;
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
  onProjectSelect,
  onCreateProject,
  onEditProject,
  onDeleteProject,
}: ChatListContentProps) {
  const { t } = useTranslation('chat');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const looseSessions = sessions.filter((s) => !s.project_id);

  const filteredLooseSessions = !searchQuery.trim()
    ? looseSessions
    : looseSessions.filter(
        (s) =>
          s.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.model.toLowerCase().includes(searchQuery.toLowerCase())
      );

  const groupedSessions = filteredLooseSessions.reduce((groups, session) => {
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
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                handleRenameStart(session);
              }}
            >
              <Pencil size={14} className="mr-2" />
              {t('chat_list.rename_chat')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onDeleteChat(session.id)}
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
      <div className="mt-2 pb-2 border-b">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {t('chat_list.projects_section')}
          </span>
          {onCreateProject && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
              onClick={onCreateProject}
              title={t('chat_list.new_project')}
            >
              <Plus size={14} />
            </Button>
          )}
        </div>

        {projects.map((project) => (
          <div
            key={project.id}
            className={cn(
              'group flex items-center gap-2 px-2 py-1.5 rounded-lg mx-2 mb-0.5 cursor-pointer',
              'hover:bg-accent/30 transition-colors',
              selectedProjectId === project.id && 'bg-accent/50'
            )}
            onClick={() => onProjectSelect?.(project)}
          >
            <FolderOpen size={14} className="shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium truncate flex-1">{project.name}</span>

            {(onEditProject || onDeleteProject) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100 transition-opacity h-5 w-5 p-0 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical size={12} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onEditProject && (
                    <DropdownMenuItem onSelect={() => onEditProject(project)}>
                      <Pencil size={14} className="mr-2" />
                      {t('chat_list.edit_project')}
                    </DropdownMenuItem>
                  )}
                  {onDeleteProject && (
                    <DropdownMenuItem
                      onSelect={() =>
                        onDeleteProject(
                          project.id,
                          project.name,
                          sessions.filter((s) => s.project_id === project.id).length
                        )
                      }
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 size={14} className="mr-2" />
                      {t('chat_list.delete_project')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}

        {projects.length === 0 && onCreateProject && (
          <button
            className="w-full text-xs text-muted-foreground hover:text-foreground px-4 py-2 text-left"
            onClick={onCreateProject}
          >
            + {t('chat_list.new_project')}
          </button>
        )}
      </div>

      <div className="pt-2">
        <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {t('chat_list.conversations_section')}
        </div>

        {filteredLooseSessions.length > 0 ? (
          <div>
            {sortedGroupKeys.map((groupKey) => (
              <div key={groupKey}>
                <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {t(`chat_list.groups.${groupKey}`)}
                </div>
                {groupedSessions[groupKey]
                  .sort((a, b) => b.updated_at - a.updated_at)
                  .map((session) => renderSession(session))}
              </div>
            ))}
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
