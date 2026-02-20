import { Button } from '@/components/ui/button'
import type { SkillCategory } from '../../../types/skills'

interface SkillCategoryFilterProps {
  categories: SkillCategory[]
  selectedCategory: string | null
  onSelect: (category: string | null) => void
}

export function SkillCategoryFilter({
  categories,
  selectedCategory,
  onSelect,
}: SkillCategoryFilterProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant={selectedCategory === null ? 'default' : 'outline'}
        size="sm"
        onClick={() => onSelect(null)}
        className="text-xs"
      >
        All
      </Button>

      {categories.map((cat) => (
        <Button
          key={cat.category}
          variant={selectedCategory === cat.category ? 'default' : 'outline'}
          size="sm"
          onClick={() => onSelect(cat.category)}
          className="text-xs"
        >
          {cat.displayName}
          <span className="ml-1 text-muted-foreground">({cat.count})</span>
        </Button>
      ))}
    </div>
  )
}
