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
import type { InstalledSkill, UninstallSkillOptions } from '../../../types/skills'

interface SkillUninstallScopeModalProps {
  open: boolean
  skillName: string
  instances: InstalledSkill[]
  onConfirm: (options: UninstallSkillOptions) => void
  onCancel: () => void
}

export function SkillUninstallScopeModal({
  open,
  skillName,
  instances,
  onConfirm,
  onCancel,
}: SkillUninstallScopeModalProps) {
  const [selectedKey, setSelectedKey] = useState<string>(instances[0]?.scopedKey ?? '')

  const handleConfirm = () => {
    const instance = instances.find((i) => i.scopedKey === selectedKey)
    if (!instance) return

    onConfirm({
      scope: instance.scope,
      projectId: instance.projectId,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Remove Skill</DialogTitle>
          <DialogDescription>
            <strong>{skillName}</strong> is installed in multiple places. Choose which installation to remove.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup value={selectedKey} onValueChange={setSelectedKey} className="space-y-2">
          {instances.map((instance) => (
            <div
              key={instance.scopedKey}
              className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50"
              onClick={() => setSelectedKey(instance.scopedKey)}
            >
              <RadioGroupItem value={instance.scopedKey} id={`uninstall-${instance.scopedKey}`} />
              <Label htmlFor={`uninstall-${instance.scopedKey}`} className="flex items-center gap-2 cursor-pointer flex-1">
                {instance.scope === 'global' ? (
                  <Globe className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                )}
                <div>
                  <div className="font-medium text-sm capitalize">
                    {instance.scope === 'global' ? 'Global' : instance.projectName ?? 'Project'}
                  </div>
                  {instance.scope === 'project' && instance.projectCwd && (
                    <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                      {instance.projectCwd}
                    </div>
                  )}
                </div>
              </Label>
            </div>
          ))}
        </RadioGroup>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!selectedKey}>
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
