import { useState, useEffect } from 'react';
import { FolderOpen } from 'lucide-react';
import { ChatSession, Project } from '../../types/database';

interface ProjectPageProps {
  project: Project;
  onSessionSelect: (sessionId: string) => void;
  onNewSessionInProject: (projectId: string, initialMessage?: string) => void;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export function ProjectPage({ project, onSessionSelect, onNewSessionInProject }: ProjectPageProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');

  useEffect(() => {
    const loadSessions = async () => {
      setLoading(true);
      const result = await window.levante.projects.getSessions(project.id);
      if (result.success && result.data) {
        setSessions(result.data as ChatSession[]);
      }
      setLoading(false);
    };
    loadSessions();
  }, [project.id]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onNewSessionInProject(project.id, input.trim());
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex flex-col max-w-3xl mx-auto w-full px-6 py-8 flex-1">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <FolderOpen size={32} className="text-foreground" />
          <h1 className="text-3xl font-bold">{project.name}</h1>
        </div>

        {/* Chat input */}
        <div className="mb-8">
          <form onSubmit={handleSubmit}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Nuevo chat en ${project.name}`}
              className="w-full rounded-2xl border bg-muted/50 px-4 py-4 text-sm resize-none min-h-[80px] outline-none focus:ring-1 focus:ring-ring"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e as unknown as React.FormEvent);
                }
              }}
            />
          </form>
        </div>

        {/* Session list */}
        <div className="flex-1">
          <div className="flex gap-4 mb-4 border-b">
            <button className="text-sm font-semibold pb-2 border-b-2 border-foreground -mb-px">
              Chats
            </button>
          </div>

          {loading ? (
            <div className="py-8 text-center text-muted-foreground text-sm">Cargando...</div>
          ) : sessions.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No hay conversaciones aún. ¡Empieza una nueva!
            </div>
          ) : (
            <div>
              {sessions
                .sort((a, b) => b.updated_at - a.updated_at)
                .map((session, index) => (
                  <div key={session.id}>
                    <div
                      className="py-3 cursor-pointer hover:bg-accent/20 rounded-lg px-2 -mx-2 transition-colors"
                      onClick={() => onSessionSelect(session.id)}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm truncate">
                            {session.title || 'Sin título'}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 truncate">
                            {session.model}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground shrink-0 mt-0.5">
                          {formatDate(session.updated_at)}
                        </div>
                      </div>
                    </div>
                    {index < sessions.length - 1 && (
                      <div className="border-b border-border/50" />
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
