import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { Download, Trash2, ExternalLink, Globe, FolderOpen, FolderPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SkillDescriptor, InstalledSkill } from '../../../types/skills'

const DEFAULT_SKILL_IDS = new Set(['custom/skill-creator', 'custom/pdf'])

interface SkillCardProps {
  skill: SkillDescriptor
  installedInstances: InstalledSkill[]
  isLoading?: boolean
  onInstall: (skill: SkillDescriptor) => void
  onUninstall: (skillId: string) => void
  onViewDetails: (skill: SkillDescriptor) => void
}

export function SkillCard({
  skill,
  installedInstances,
  isLoading,
  onInstall,
  onUninstall,
  onViewDetails,
}: SkillCardProps) {
  const { t } = useTranslation('chat')
  const isInstalledAnywhere = installedInstances.length > 0
  const isDefault = DEFAULT_SKILL_IDS.has(skill.id)
  const hasGlobal = installedInstances.some((i) => i.scope === 'global')
  const projectInstances = installedInstances.filter((i) => i.scope === 'project')
  const MAX_PROJECT_BADGES = 2

  return (
    <Card className="flex flex-col hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-sm leading-tight">{skill.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{skill.category}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {skill.version && (
              <span className="text-xs text-muted-foreground">v{skill.version}</span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => onViewDetails(skill)}
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 pb-2">
        <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>

        {skill.tags && skill.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {skill.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0">
                {tag}
              </Badge>
            ))}
            {skill.tags.length > 3 && (
              <span className="text-xs text-muted-foreground">+{skill.tags.length - 3}</span>
            )}
          </div>
        )}

        {/* Scope badges */}
        {isInstalledAnywhere && (
          <div className="flex flex-wrap gap-1 mt-2">
            {hasGlobal && (
              <Badge variant="outline" className="text-xs px-1.5 py-0 gap-1">
                <Globe className="h-2.5 w-2.5" />
                Global
              </Badge>
            )}
            {projectInstances.slice(0, MAX_PROJECT_BADGES).map((inst) => (
              <Badge key={inst.scopedKey} variant="outline" className="text-xs px-1.5 py-0 gap-1">
                <FolderOpen className="h-2.5 w-2.5" />
                {inst.projectName ?? 'Project'}
              </Badge>
            ))}
            {projectInstances.length > MAX_PROJECT_BADGES && (
              <Badge variant="outline" className="text-xs px-1.5 py-0">
                +{projectInstances.length - MAX_PROJECT_BADGES}
              </Badge>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="pt-2 gap-2">
        {isInstalledAnywhere && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs text-destructive hover:text-destructive"
                    onClick={() => onUninstall(skill.id)}
                    disabled={isLoading || isDefault}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Remove
                  </Button>
                </span>
              </TooltipTrigger>
              {isDefault && (
                <TooltipContent side="bottom">
                  <p>{t('tools_menu.skills.default_skill_tooltip')}</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        )}

        <Button
          size="sm"
          className="flex-1 text-xs"
          onClick={() => onInstall(skill)}
          disabled={isLoading}
        >
          {isInstalledAnywhere ? (
            <>
              <FolderPlus className="h-3 w-3 mr-1" />
              Add to project
            </>
          ) : (
            <>
              <Download className="h-3 w-3 mr-1" />
              Install
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  )
}
