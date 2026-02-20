import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import type { SkillDescriptor } from '../../../types/skills'
import { useSkillsStore } from '@/stores/skillsStore'

interface SkillInstallDeepLinkModalProps {
  skill: SkillDescriptor | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SkillInstallDeepLinkModal({
  skill,
  open,
  onOpenChange,
}: SkillInstallDeepLinkModalProps) {
  const [isInstalling, setIsInstalling] = useState(false)
  const { installSkill, isInstalled } = useSkillsStore()

  if (!skill) return null

  const alreadyInstalled = isInstalled(skill.id)

  const handleInstall = async () => {
    setIsInstalling(true)
    try {
      await installSkill(skill)
      toast.success(`Skill "${skill.name}" installed successfully`)
      onOpenChange(false)
    } catch (err: any) {
      toast.error(`Failed to install skill: ${err.message}`)
    } finally {
      setIsInstalling(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Install Skill</DialogTitle>
          <DialogDescription>
            You are about to install the following skill into Levante.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{skill.name}</h3>
              {skill.version && (
                <span className="text-xs text-muted-foreground">v{skill.version}</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{skill.description}</p>

            <div className="text-xs text-muted-foreground space-y-1">
              <div>Category: <span className="text-foreground">{skill.category}</span></div>
              {skill.author && (
                <div>Author: <span className="text-foreground">{skill.author}</span></div>
              )}
              {skill.model && (
                <div>Model: <span className="text-foreground">{skill.model}</span></div>
              )}
            </div>

            {skill.tags && skill.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {skill.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {alreadyInstalled && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              This skill is already installed. Proceeding will overwrite it.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleInstall} disabled={isInstalling}>
            <Download className="h-4 w-4 mr-2" />
            {isInstalling ? 'Installing...' : 'Install'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
