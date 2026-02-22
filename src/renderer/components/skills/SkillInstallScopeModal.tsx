import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Globe, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import type { InstallSkillOptions } from '../../../types/skills'
import type { Project } from '../../../types/database'

interface SkillInstallScopeModalProps {
  open: boolean
  skillName: string
  projects: Project[]
  onConfirm: (options: InstallSkillOptions) => void
  onCancel: () => void
}

export function SkillInstallScopeModal({
  open,
  skillName,
  projects,
  onConfirm,
  onCancel,
}: SkillInstallScopeModalProps) {
  const projectsWithCwd = projects.filter((p) => p.cwd && p.cwd.trim() !== '')
  const [selectedValue, setSelectedValue] = useState<string>('global')

  const handleConfirm = () => {
    if (selectedValue === 'global') {
      onConfirm({ scope: 'global' })
    } else {
      onConfirm({ scope: 'project', projectId: selectedValue })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Install Skill</DialogTitle>
          <DialogDescription>
            Choose where to install <strong>{skillName}</strong>.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup value={selectedValue} onValueChange={setSelectedValue} className="space-y-2">
          <div className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50" onClick={() => setSelectedValue('global')}>
            <RadioGroupItem value="global" id="scope-global" />
            <Label htmlFor="scope-global" className="flex items-center gap-2 cursor-pointer flex-1">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="font-medium text-sm">Global</div>
                <div className="text-xs text-muted-foreground">Available in all chats</div>
              </div>
            </Label>
          </div>

          {projectsWithCwd.map((project) => (
            <div
              key={project.id}
              className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50"
              onClick={() => setSelectedValue(project.id)}
            >
              <RadioGroupItem value={project.id} id={`scope-${project.id}`} />
              <Label htmlFor={`scope-${project.id}`} className="flex items-center gap-2 cursor-pointer flex-1">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="font-medium text-sm">{project.name}</div>
                  <div className="text-xs text-muted-foreground truncate max-w-[200px]">{project.cwd}</div>
                </div>
              </Label>
            </div>
          ))}
        </RadioGroup>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            Install
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
