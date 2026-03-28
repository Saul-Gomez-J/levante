import { useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Search, Globe, FolderOpen, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { SkillCard } from '@/components/skills/SkillCard'
import { SkillCategoryFilter } from '@/components/skills/SkillCategoryFilter'
import { SkillDetailsModal } from '@/components/skills/SkillDetailsModal'
import { SkillInstallScopeModal } from '@/components/skills/SkillInstallScopeModal'
import { SkillUninstallScopeModal } from '@/components/skills/SkillUninstallScopeModal'
import { CustomSkillImportModal } from '@/components/skills/CustomSkillImportModal'
import { useTranslation } from 'react-i18next'
import { useSkillsStore } from '@/stores/skillsStore'
import { useProjectStore } from '@/stores/projectStore'
import type { SkillDescriptor, InstallSkillOptions, UninstallSkillOptions } from '../../types/skills'

type ScopeFilter = 'all' | 'global' | string // string = projectId

interface SkillsPageProps {
  installed: boolean;
}

const SkillsPage = ({ installed }: SkillsPageProps) => {
  const {
    catalog,
    categories,
    isLoadingCatalog,
    error,
    loadCatalog,
    loadCategories,
    loadInstalled,
    getInstalledBySkillId,
    isInstalledAnywhere,
    installSkill,
    uninstallSkill,
  } = useSkillsStore()

  const { t } = useTranslation('chat')
  const { projects, loadProjects } = useProjectStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [customImportOpen, setCustomImportOpen] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<SkillDescriptor | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set())
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all')

  // Install scope modal state
  const [installScopeSkill, setInstallScopeSkill] = useState<SkillDescriptor | null>(null)

  // Uninstall scope modal state
  const [uninstallSkillId, setUninstallSkillId] = useState<string | null>(null)

  const projectsWithCwd = useMemo(
    () => projects.filter((p) => p.cwd && p.cwd.trim() !== ''),
    [projects]
  )

  useEffect(() => {
    loadCatalog()
    loadCategories()
    loadInstalled({ mode: 'all-scopes' })
    loadProjects()
  }, [loadCatalog, loadCategories, loadInstalled, loadProjects])

  const { installedSkills } = useSkillsStore()

  // In installed view, merge custom skills (not in catalog) into the source list
  const sourceSkills = useMemo((): SkillDescriptor[] => {
    if (!installed) return catalog

    const catalogIds = new Set(catalog.map((s) => s.id))
    const customDescriptors: SkillDescriptor[] = installedSkills
      .filter((s) => !catalogIds.has(s.id))
      .reduce<SkillDescriptor[]>((acc, s) => {
        // Dedupe by id (multiple scoped instances of the same skill)
        if (!acc.some((d) => d.id === s.id)) {
          acc.push({
            id: s.id,
            name: s.name,
            description: s.description ?? '',
            category: s.category ?? 'custom',
            author: s.author,
            version: s.version,
            license: s.license,
            allowedTools: s.allowedTools,
            model: s.model,
            userInvocable: s.userInvocable ?? undefined,
            content: s.content ?? '',
          })
        }
        return acc
      }, [])

    return [...catalog, ...customDescriptors]
  }, [catalog, installedSkills, installed])

  const filteredSkills = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()

    return sourceSkills.filter((skill) => {
      // In installed view, only show skills that are installed somewhere
      if (installed && !isInstalledAnywhere(skill.id)) return false

      if (selectedCategory && skill.category !== selectedCategory) return false

      // Scope filter — only applies in installed view
      if (installed && scopeFilter !== 'all') {
        if (scopeFilter === 'global') {
          const instances = getInstalledBySkillId(skill.id)
          if (!instances.some((i) => i.scope === 'global')) return false
        } else {
          // scopeFilter is a projectId
          const instances = getInstalledBySkillId(skill.id)
          if (!instances.some((i) => i.scope === 'project' && i.projectId === scopeFilter)) return false
        }
      }

      if (!q) return true

      return (
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        skill.tags?.some((tag) => tag.toLowerCase().includes(q))
      )
    })
  }, [sourceSkills, searchQuery, selectedCategory, scopeFilter, getInstalledBySkillId, isInstalledAnywhere, installed])

  const handleInstall = async (skill: SkillDescriptor) => {
    if (projectsWithCwd.length > 0) {
      // Show scope selector modal
      setInstallScopeSkill(skill)
    } else {
      // Install global directly
      await doInstall(skill, { scope: 'global' })
    }
  }

  const doInstall = async (skill: SkillDescriptor, options: InstallSkillOptions) => {
    setProcessingIds((prev) => new Set(prev).add(skill.id))
    try {
      await installSkill(skill, options)
      toast.success(`Skill "${skill.name}" installed`)
    } catch (err: any) {
      toast.error(`Failed to install: ${err.message}`)
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev)
        next.delete(skill.id)
        return next
      })
    }
  }

  const handleInstallScopeConfirm = async (options: InstallSkillOptions) => {
    const skill = installScopeSkill
    setInstallScopeSkill(null)
    if (skill) {
      await doInstall(skill, options)
    }
  }

  const handleUninstall = async (skillId: string) => {
    const instances = getInstalledBySkillId(skillId)

    if (instances.length === 0) return

    if (instances.length === 1) {
      // Single instance: uninstall directly
      await doUninstall(skillId, {
        scope: instances[0].scope,
        projectId: instances[0].projectId,
      })
    } else {
      // Multiple instances: show scope selector
      setUninstallSkillId(skillId)
    }
  }

  const doUninstall = async (skillId: string, options: UninstallSkillOptions) => {
    setProcessingIds((prev) => new Set(prev).add(skillId))
    try {
      await uninstallSkill(skillId, options)
      toast.success('Skill removed')
    } catch (err: any) {
      toast.error(`Failed to remove: ${err.message}`)
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev)
        next.delete(skillId)
        return next
      })
    }
  }

  const handleUninstallScopeConfirm = async (options: UninstallSkillOptions) => {
    const skillId = uninstallSkillId
    setUninstallSkillId(null)
    if (skillId) {
      await doUninstall(skillId, options)
    }
  }

  const handleViewDetails = (skill: SkillDescriptor) => {
    setSelectedSkill(skill)
    setDetailsOpen(true)
  }

  const uninstallModalSkill = uninstallSkillId
    ? sourceSkills.find((s) => s.id === uninstallSkillId) ?? null
    : null
  const uninstallModalInstances = uninstallSkillId ? getInstalledBySkillId(uninstallSkillId) : []

  return (
    <div className="max-w-4xl mx-auto space-y-6 px-4 py-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">
            {installed ? 'Installed Skills' : 'Skills Store'}
          </h1>
          {installed && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setCustomImportOpen(true)}
            >
              <Plus className="h-4 w-4" />
              {t('tools_menu.skills.custom_import.button')}
            </Button>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <SkillCategoryFilter
          categories={categories}
          selectedCategory={selectedCategory}
          onSelect={setSelectedCategory}
        />

        {/* Scope filter — only in installed view */}
        {installed && (
          <div className="flex flex-wrap gap-1">
            <Button
              variant={scopeFilter === 'all' ? 'secondary' : 'ghost'}
              size="sm"
              className="text-xs h-7"
              onClick={() => setScopeFilter('all')}
            >
              All
            </Button>
            <Button
              variant={scopeFilter === 'global' ? 'secondary' : 'ghost'}
              size="sm"
              className="text-xs h-7 gap-1"
              onClick={() => setScopeFilter('global')}
            >
              <Globe className="h-3 w-3" />
              Global
            </Button>
            {projectsWithCwd.map((project) => (
              <Button
                key={project.id}
                variant={scopeFilter === project.id ? 'secondary' : 'ghost'}
                size="sm"
                className="text-xs h-7 gap-1"
                onClick={() => setScopeFilter(project.id)}
              >
                <FolderOpen className="h-3 w-3" />
                {project.name}
              </Button>
            ))}
          </div>
        )}

      </div>

      {/* Content */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isLoadingCatalog ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
          {searchQuery || selectedCategory || (installed && scopeFilter !== 'all')
            ? 'No skills match your filters.'
            : installed
              ? 'No skills installed yet.'
              : 'No skills available.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              installedInstances={getInstalledBySkillId(skill.id)}
              isLoading={processingIds.has(skill.id)}
              onInstall={handleInstall}
              onUninstall={handleUninstall}
              onViewDetails={handleViewDetails}
            />
          ))}
        </div>
      )}

      <SkillDetailsModal
        skill={selectedSkill}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />

      {/* Install scope modal */}
      {installScopeSkill && (
        <SkillInstallScopeModal
          open={!!installScopeSkill}
          skillName={installScopeSkill.name}
          projects={projects}
          onConfirm={handleInstallScopeConfirm}
          onCancel={() => setInstallScopeSkill(null)}
        />
      )}

      {/* Uninstall scope modal */}
      {uninstallSkillId && uninstallModalSkill && (
        <SkillUninstallScopeModal
          open={!!uninstallSkillId}
          skillName={uninstallModalSkill.name}
          instances={uninstallModalInstances}
          onConfirm={handleUninstallScopeConfirm}
          onCancel={() => setUninstallSkillId(null)}
        />
      )}

      <CustomSkillImportModal
        open={customImportOpen}
        onClose={() => setCustomImportOpen(false)}
      />
    </div>
  )
}

export default SkillsPage
