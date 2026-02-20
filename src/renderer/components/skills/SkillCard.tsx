import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Download, Trash2, ExternalLink } from 'lucide-react'
import type { SkillDescriptor } from '../../../types/skills'

interface SkillCardProps {
  skill: SkillDescriptor
  isInstalled: boolean
  isLoading?: boolean
  onInstall: (skill: SkillDescriptor) => void
  onUninstall: (skillId: string) => void
  onViewDetails: (skill: SkillDescriptor) => void
}

export function SkillCard({
  skill,
  isInstalled,
  isLoading,
  onInstall,
  onUninstall,
  onViewDetails,
}: SkillCardProps) {
  return (
    <Card className="flex flex-col hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-sm leading-tight">{skill.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{skill.category}</p>
          </div>
          {skill.version && (
            <span className="text-xs text-muted-foreground shrink-0">v{skill.version}</span>
          )}
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
      </CardContent>

      <CardFooter className="pt-2 gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 text-xs"
          onClick={() => onViewDetails(skill)}
        >
          <ExternalLink className="h-3 w-3 mr-1" />
          Details
        </Button>

        {isInstalled ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs text-destructive hover:text-destructive"
            onClick={() => onUninstall(skill.id)}
            disabled={isLoading}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Remove
          </Button>
        ) : (
          <Button
            size="sm"
            className="flex-1 text-xs"
            onClick={() => onInstall(skill)}
            disabled={isLoading}
          >
            <Download className="h-3 w-3 mr-1" />
            Install
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
