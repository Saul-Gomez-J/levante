import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Download, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { SkillDescriptor } from '../../../types/skills'
import { useSkillsStore } from '@/stores/skillsStore'

interface SkillDetailsModalProps {
  skill: SkillDescriptor | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SkillDetailsModal({ skill, open, onOpenChange }: SkillDetailsModalProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const { isInstalled, installSkill, uninstallSkill } = useSkillsStore()

  if (!skill) return null

  const installed = isInstalled(skill.id)

  const handleInstall = async () => {
    setIsProcessing(true)
    try {
      await installSkill(skill)
      toast.success(`Skill "${skill.name}" installed`)
      onOpenChange(false)
    } catch (err: any) {
      toast.error(`Failed to install: ${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleUninstall = async () => {
    setIsProcessing(true)
    try {
      await uninstallSkill(skill.id)
      toast.success(`Skill "${skill.name}" removed`)
      onOpenChange(false)
    } catch (err: any) {
      toast.error(`Failed to remove: ${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {skill.name}
            {skill.version && (
              <span className="text-sm font-normal text-muted-foreground">v{skill.version}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 flex-1 overflow-hidden">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Category: </span>
              <span>{skill.category}</span>
            </div>
            {skill.author && (
              <div>
                <span className="text-muted-foreground">Author: </span>
                <span>{skill.author}</span>
              </div>
            )}
            {skill.model && (
              <div>
                <span className="text-muted-foreground">Model: </span>
                <span>{skill.model}</span>
              </div>
            )}
            {skill.allowedTools && (
              <div>
                <span className="text-muted-foreground">Tools: </span>
                <span className="text-xs">{skill.allowedTools}</span>
              </div>
            )}
          </div>

          <p className="text-sm text-muted-foreground">{skill.description}</p>

          {skill.tags && skill.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {skill.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          <Separator />

          <ScrollArea className="flex-1 min-h-0">
            <pre className="text-xs font-mono whitespace-pre-wrap bg-muted p-3 rounded-md">
              {skill.content}
            </pre>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>

          {installed ? (
            <Button
              variant="destructive"
              onClick={handleUninstall}
              disabled={isProcessing}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Remove Skill
            </Button>
          ) : (
            <Button onClick={handleInstall} disabled={isProcessing}>
              <Download className="h-4 w-4 mr-2" />
              {isProcessing ? 'Installing...' : 'Install Skill'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
