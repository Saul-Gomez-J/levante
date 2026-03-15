import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import type { Project, CreateProjectInput, UpdateProjectInput } from '../../../types/database';

function sanitizeProjectName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñü\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50)
    || 'project';
}

interface ProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;
  onSave: (input: CreateProjectInput | UpdateProjectInput) => Promise<void>;
}

export function ProjectModal({ open, onOpenChange, project, onSave }: ProjectModalProps) {
  const { t } = useTranslation('chat');
  const isEditing = !!project;

  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const [useCustomCwd, setUseCustomCwd] = useState(false);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Preview of the auto-generated path
  const autoPath = useMemo(() => {
    const safeName = sanitizeProjectName(name);
    return `~/levante/projects/${safeName}/`;
  }, [name]);

  // Reset form when modal opens/closes or project changes
  useEffect(() => {
    if (open) {
      setName(project?.name ?? '');
      setCwd(project?.cwd ?? '');
      setDescription(project?.description ?? '');
      setUseCustomCwd(isEditing && !!project?.cwd);
    }
  }, [open, project, isEditing]);

  const handleSelectDirectory = async () => {
    const result = await window.levante.cowork.selectWorkingDirectory({
      title: t('chat_list.project_modal.cwd_label'),
      buttonLabel: t('chat_list.project_modal.save'),
    });
    if (result.success && result.data && !result.data.canceled) {
      setCwd(result.data.path);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (isEditing && project) {
        await onSave({
          id: project.id,
          name: name.trim(),
          cwd: (useCustomCwd ? cwd.trim() : null) || null,
          description: description.trim() || null,
        } as UpdateProjectInput);
      } else {
        const customCwd = useCustomCwd ? cwd.trim() : undefined;
        await onSave({
          name: name.trim(),
          cwd: customCwd || undefined,
          description: description.trim() || undefined,
        } as CreateProjectInput);
      }
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? t('chat_list.project_modal.title_edit')
              : t('chat_list.project_modal.title_create')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1">
            <Label htmlFor="project-name">{t('chat_list.project_modal.name_label')}</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('chat_list.project_modal.name_placeholder')}
              maxLength={100}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
            />
          </div>

          {/* CWD */}
          <div className="space-y-1">
            <Label>{t('chat_list.project_modal.cwd_label')}</Label>
            {!useCustomCwd ? (
              <div>
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
                  <FolderOpen size={14} className="shrink-0 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground truncate">
                    {name.trim() ? autoPath : t('chat_list.project_modal.cwd_auto_preview')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setUseCustomCwd(true)}
                  className="mt-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  {t('chat_list.project_modal.cwd_use_custom')}
                </button>
              </div>
            ) : (
              <div>
                <div className="flex gap-2">
                  <Input
                    value={cwd}
                    onChange={(e) => setCwd(e.target.value)}
                    placeholder={t('chat_list.project_modal.cwd_placeholder')}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSelectDirectory}
                    className="shrink-0"
                  >
                    <FolderOpen size={14} />
                  </Button>
                </div>
                <button
                  type="button"
                  onClick={() => { setUseCustomCwd(false); setCwd(''); }}
                  className="mt-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  {t('chat_list.project_modal.cwd_use_auto')}
                </button>
              </div>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1">
            <Label htmlFor="project-description">
              {t('chat_list.project_modal.description_label')}
            </Label>
            <Textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('chat_list.project_modal.description_placeholder')}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('chat_list.project_modal.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {t('chat_list.project_modal.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
