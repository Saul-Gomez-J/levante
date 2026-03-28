import { useCallback, useMemo, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload, FileArchive, Globe, FolderOpen, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { formatPathTail } from '@/lib/utils'
import { useProjectStore } from '@/stores/projectStore'
import { useSkillsStore } from '@/stores/skillsStore'
import type { InstallSkillOptions } from '../../../types/skills'

interface CustomSkillImportModalProps {
  open: boolean
  onClose: () => void
}

export function CustomSkillImportModal({ open, onClose }: CustomSkillImportModalProps) {
  const { t } = useTranslation('chat')
  const { projects } = useProjectStore()
  const { installFromZip, installFromZipBuffer, selectZipFile } = useSkillsStore()

  const [zipPath, setZipPath] = useState<string | null>(null)
  const [zipBuffer, setZipBuffer] = useState<ArrayBuffer | null>(null)
  const [zipFileName, setZipFileName] = useState<string | null>(null)
  const [selectedScope, setSelectedScope] = useState<string>('global')
  const [isInstalling, setIsInstalling] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  const projectsWithCwd = useMemo(
    () => projects.filter((p) => p.cwd && p.cwd.trim() !== ''),
    [projects]
  )

  const resetState = () => {
    setZipPath(null)
    setZipBuffer(null)
    setZipFileName(null)
    setSelectedScope('global')
    setIsDragOver(false)
  }

  const handleClose = () => {
    resetState()
    onClose()
  }

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const file = e.dataTransfer.files?.[0]
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error(t('tools_menu.skills.custom_import.invalid_file_type'))
      return
    }

    const buffer = await file.arrayBuffer()
    setZipBuffer(buffer)
    setZipPath('__dropped__')
    setZipFileName(file.name)
  }, [t])

  const handleBrowse = async () => {
    try {
      const filePath = await selectZipFile()
      if (!filePath) return

      setZipPath(filePath)
      setZipFileName(filePath.split('/').pop() || filePath)
    } catch (error) {
      toast.error(
        t('tools_menu.skills.custom_import.error', {
          message: error instanceof Error ? error.message : String(error),
        })
      )
    }
  }

  const handleInstall = async () => {
    if (!zipPath) return

    const options: InstallSkillOptions =
      selectedScope === 'global'
        ? { scope: 'global' }
        : { scope: 'project', projectId: selectedScope }

    setIsInstalling(true)

    try {
      const installed = zipBuffer
        ? await installFromZipBuffer(zipBuffer, zipFileName || 'skill.zip', options)
        : await installFromZip(zipPath, options)
      toast.success(
        t('tools_menu.skills.custom_import.success', { name: installed.name })
      )
      handleClose()
    } catch (error) {
      toast.error(
        t('tools_menu.skills.custom_import.error', {
          message: error instanceof Error ? error.message : String(error),
        })
      )
    } finally {
      setIsInstalling(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) handleClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('tools_menu.skills.custom_import.title')}</DialogTitle>
          <DialogDescription>
            {t('tools_menu.skills.custom_import.description')}
          </DialogDescription>
        </DialogHeader>

        <div
          className={[
            'relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors',
            isDragOver
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-muted-foreground/50',
            zipPath ? 'border-green-500/50 bg-green-500/5' : '',
          ].join(' ')}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={!zipPath ? handleBrowse : undefined}
        >
          {zipPath ? (
            <>
              <FileArchive className="h-10 w-10 text-green-500" />
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{zipFileName}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={(e) => {
                    e.stopPropagation()
                    setZipPath(null)
                    setZipBuffer(null)
                    setZipFileName(null)
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </>
          ) : (
            <>
              <Upload className="h-10 w-10 text-muted-foreground" />
              <p className="text-center text-sm text-muted-foreground">
                {t('tools_menu.skills.custom_import.drop_zone')}
              </p>
            </>
          )}
        </div>

        {!zipPath && (
          <Button variant="outline" className="w-full" onClick={handleBrowse}>
            {t('tools_menu.skills.custom_import.browse')}
          </Button>
        )}

        {zipPath && (
          <div className="space-y-3">
            <Label className="text-sm font-medium">
              {t('tools_menu.skills.custom_import.scope_label')}
            </Label>

            <RadioGroup value={selectedScope} onValueChange={setSelectedScope}>
              <div
                className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-accent"
                onClick={() => setSelectedScope('global')}
              >
                <RadioGroupItem value="global" id="custom-skill-scope-global" />
                <Globe className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="custom-skill-scope-global" className="flex-1 cursor-pointer">
                  <div className="font-medium">Global</div>
                  <div className="text-xs text-muted-foreground">
                    {t('tools_menu.skills.custom_import.scope_global_desc')}
                  </div>
                </Label>
              </div>

              {projectsWithCwd.map((project) => (
                <div
                  key={project.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-accent"
                  onClick={() => setSelectedScope(project.id)}
                >
                  <RadioGroupItem value={project.id} id={`custom-skill-scope-${project.id}`} />
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  <Label htmlFor={`custom-skill-scope-${project.id}`} className="min-w-0 flex-1 cursor-pointer">
                    <div className="min-w-0">
                      <div className="font-medium">{project.name}</div>
                      <div className="truncate text-xs text-muted-foreground" title={project.cwd ?? undefined}>
                        {formatPathTail(project.cwd ?? '', 2)}
                      </div>
                    </div>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleInstall} disabled={!zipPath || isInstalling}>
            {isInstalling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('tools_menu.skills.custom_import.install_button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
