import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';
import { useSkillsStore } from '@/stores/skillsStore';
import type { InstalledSkill } from '../../../types/skills';

interface SkillsPanelProps {
  projectId?: string | null;
}

type SkillsTab = 'enabled' | 'disabled';

export function SkillsPanel({ projectId }: SkillsPanelProps) {
  const { t } = useTranslation('chat');
  const {
    installedSkills,
    isLoadingInstalled,
    error,
    clearError,
    loadInstalledForChat,
    toggleUserInvocable,
  } = useSkillsStore();

  const [tab, setTab] = useState<SkillsTab>('enabled');
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    clearError();
    loadInstalledForChat(projectId);
  }, [clearError, loadInstalledForChat, projectId]);

  const sorted = useMemo(() => {
    return [...installedSkills].sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === 'project' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [installedSkills]);

  const enabledSkills = useMemo(
    () => sorted.filter((s) => s.userInvocable !== false),
    [sorted]
  );
  const disabledSkills = useMemo(
    () => sorted.filter((s) => s.userInvocable === false),
    [sorted]
  );

  const toggle = async (skill: InstalledSkill, enabled: boolean) => {
    setPendingKeys((prev) => new Set(prev).add(skill.scopedKey));
    try {
      await toggleUserInvocable(skill, enabled);
    } finally {
      setPendingKeys((prev) => {
        const next = new Set(prev);
        next.delete(skill.scopedKey);
        return next;
      });
    }
  };

  const renderList = (skills: InstalledSkill[], emptyText: string) => {
    if (skills.length === 0) {
      return <div className="p-3 text-xs text-muted-foreground">{emptyText}</div>;
    }

    return (
      <div className="max-h-[300px] overflow-y-auto">
        {skills.map((skill) => {
          const checked = skill.userInvocable !== false;
          const isPending = pendingKeys.has(skill.scopedKey);

          return (
            <div
              key={skill.scopedKey}
              className="flex items-start justify-between gap-3 px-3 py-2 border-b last:border-b-0"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{skill.name}</div>
                <div className="text-xs text-muted-foreground truncate">{skill.id}</div>
                {skill.description && (
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {skill.description}
                  </div>
                )}
                <div className="mt-1">
                  <Badge variant="secondary" className="text-[10px]">
                    {skill.scope === 'project'
                      ? t('tools_menu.skills.scope_project', 'project')
                      : t('tools_menu.skills.scope_global', 'global')}
                  </Badge>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                <Switch
                  checked={checked}
                  disabled={isPending}
                  onCheckedChange={(v) => toggle(skill, v === true)}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="w-96">
      <div className="px-3 py-2 border-b">
        <div className="text-sm font-medium">
          {t('tools_menu.skills.panel_title', 'Skills')}
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-red-600 border-b">
          {error}
        </div>
      )}

      {isLoadingInstalled ? (
        <div className="p-3 text-xs text-muted-foreground">
          {t('tools_menu.loading_tools', 'Loading tools...')}
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as SkillsTab)} className="w-full">
          <TabsList className="mx-3 mt-2 grid w-auto grid-cols-2">
            <TabsTrigger value="enabled" className="text-xs">
              {t('tools_menu.skills.enabled', 'Enabled')} ({enabledSkills.length})
            </TabsTrigger>
            <TabsTrigger value="disabled" className="text-xs">
              {t('tools_menu.skills.disabled', 'Disabled')} ({disabledSkills.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="enabled" className="mt-2">
            {renderList(enabledSkills, t('tools_menu.skills.empty_enabled', 'No enabled skills'))}
          </TabsContent>
          <TabsContent value="disabled" className="mt-2">
            {renderList(disabledSkills, t('tools_menu.skills.empty_disabled', 'No disabled skills'))}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
