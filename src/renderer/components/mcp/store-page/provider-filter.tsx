import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { MCPSource, MCPCategory } from '@/types/mcp';
import { Badge, CheckCircle, Users } from 'lucide-react';

interface SourceFilterProps {
  selectedSource: MCPSource | 'all';
  availableSources: MCPSource[];
  onSelectSource: (source: MCPSource | 'all') => void;
}

interface CategoryFilterProps {
  selectedCategory: MCPCategory | 'all';
  availableCategories: MCPCategory[];
  onSelectCategory: (category: MCPCategory | 'all') => void;
}

const SOURCE_ICONS: Record<MCPSource, React.ReactNode> = {
  official: <CheckCircle className="h-3 w-3" />,
  community: <Users className="h-3 w-3" />
};

const CATEGORY_LABELS: Record<MCPCategory, string> = {
  documentation: 'Documentation',
  development: 'Development',
  database: 'Database',
  automation: 'Automation',
  ai: 'AI',
  communication: 'Communication',
  productivity: 'Productivity',
  other: 'Other'
};

export function SourceFilter({
  selectedSource,
  availableSources,
  onSelectSource
}: SourceFilterProps) {
  const { t } = useTranslation('mcp');

  return (
    <div className="flex gap-2">
      <Button
        variant={selectedSource === 'all' ? 'default' : 'outline'}
        onClick={() => onSelectSource('all')}
        size="sm"
      >
        {t('store.all_sources', 'All')}
      </Button>

      {availableSources.map(source => (
        <Button
          key={source}
          variant={selectedSource === source ? 'default' : 'outline'}
          onClick={() => onSelectSource(source)}
          size="sm"
          className="gap-1"
        >
          {SOURCE_ICONS[source]}
          {t(`store.source.${source}`, source.charAt(0).toUpperCase() + source.slice(1))}
        </Button>
      ))}
    </div>
  );
}

export function CategoryFilter({
  selectedCategory,
  availableCategories,
  onSelectCategory
}: CategoryFilterProps) {
  const { t } = useTranslation('mcp');

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant={selectedCategory === 'all' ? 'default' : 'outline'}
        onClick={() => onSelectCategory('all')}
        size="sm"
      >
        {t('store.all_categories', 'All Categories')}
      </Button>

      {availableCategories.map(category => (
        <Button
          key={category}
          variant={selectedCategory === category ? 'default' : 'outline'}
          onClick={() => onSelectCategory(category)}
          size="sm"
        >
          {t(`store.category.${category}`, CATEGORY_LABELS[category] || category)}
        </Button>
      ))}
    </div>
  );
}

// Legacy export for backwards compatibility
export function ProviderFilter({
  selectedProvider,
  availableProviders,
  onSelectProvider
}: {
  selectedProvider: string | 'all';
  availableProviders: string[];
  onSelectProvider: (provider: string | 'all') => void;
}) {
  return (
    <SourceFilter
      selectedSource={selectedProvider as MCPSource | 'all'}
      availableSources={availableProviders as MCPSource[]}
      onSelectSource={onSelectProvider as (source: MCPSource | 'all') => void}
    />
  );
}
