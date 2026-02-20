import { useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { SkillCard } from '@/components/skills/SkillCard'
import { SkillCategoryFilter } from '@/components/skills/SkillCategoryFilter'
import { SkillDetailsModal } from '@/components/skills/SkillDetailsModal'
import { useSkillsStore } from '@/stores/skillsStore'
import type { SkillDescriptor } from '../../types/skills'

const SkillsPage = () => {
  const {
    catalog,
    categories,
    isLoadingCatalog,
    error,
    loadCatalog,
    loadCategories,
    loadInstalled,
    isInstalled,
    installSkill,
    uninstallSkill,
  } = useSkillsStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<SkillDescriptor | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadCatalog()
    loadCategories()
    loadInstalled()
  }, [loadCatalog, loadCategories, loadInstalled])

  const filteredSkills = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()

    return catalog.filter((skill) => {
      if (selectedCategory && skill.category !== selectedCategory) return false
      if (!q) return true

      return (
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        skill.tags?.some((tag) => tag.toLowerCase().includes(q))
      )
    })
  }, [catalog, searchQuery, selectedCategory])

  const handleInstall = async (skill: SkillDescriptor) => {
    setProcessingIds((prev) => new Set(prev).add(skill.id))

    try {
      await installSkill(skill)
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

  const handleUninstall = async (skillId: string) => {
    setProcessingIds((prev) => new Set(prev).add(skillId))

    try {
      await uninstallSkill(skillId)
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

  const handleViewDetails = (skill: SkillDescriptor) => {
    setSelectedSkill(skill)
    setDetailsOpen(true)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b space-y-3 shrink-0">
        <div>
          <h1 className="text-xl font-semibold">Skills Store</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Browse and install AI agent skills
          </p>
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
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <Alert variant="destructive" className="mb-4">
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
            {searchQuery || selectedCategory
              ? 'No skills match your search.'
              : 'No skills available.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSkills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                isInstalled={isInstalled(skill.id)}
                isLoading={processingIds.has(skill.id)}
                onInstall={handleInstall}
                onUninstall={handleUninstall}
                onViewDetails={handleViewDetails}
              />
            ))}
          </div>
        )}
      </div>

      <SkillDetailsModal
        skill={selectedSkill}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </div>
  )
}

export default SkillsPage
