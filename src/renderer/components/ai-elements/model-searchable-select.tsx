'use client';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Check, ChevronsUpDown, Loader2, Filter, X } from 'lucide-react';
import { useState, useMemo } from 'react';
import type { Model } from '../../../types/models';
import type { ModelCategory } from '../../../types/modelCategories';
import { useTranslation } from 'react-i18next';

export interface ModelSearchableSelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  models: Model[];
  loading?: boolean;
  placeholder?: string;
  className?: string;
}

export const ModelSearchableSelect = ({
  value,
  onValueChange,
  models,
  loading = false,
  placeholder,
  className,
}: ModelSearchableSelectProps) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ModelCategory | null>(null);

  // Get category display name
  const getCategoryDisplayName = (category: ModelCategory): string => {
    const displayNames: Record<ModelCategory, string> = {
      'chat': 'Chat',
      'multimodal': 'Multimodal',
      'image': 'Image Generation',
      'audio': 'Audio',
      'specialized': 'Specialized'
    };
    return displayNames[category] || category;
  };

  // Calculate available categories with counts
  const availableCategories = useMemo(() => {
    const counts = new Map<ModelCategory, number>();

    models.forEach(model => {
      if (model.category) {
        counts.set(model.category, (counts.get(model.category) || 0) + 1);
      }
    });

    return Array.from(counts.entries()).map(([category, count]) => ({
      category,
      count,
      label: getCategoryDisplayName(category)
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [models]);

  // Simple fuzzy search function
  const fuzzyMatch = (text: string, query: string): boolean => {
    if (!query) return true;

    const normalizedText = text.toLowerCase();
    const normalizedQuery = query.toLowerCase();

    // Exact match or contains
    if (normalizedText.includes(normalizedQuery)) {
      return true;
    }

    // Simple fuzzy: check if all characters exist in order
    let queryIndex = 0;
    for (let i = 0; i < normalizedText.length && queryIndex < normalizedQuery.length; i++) {
      if (normalizedText[i] === normalizedQuery[queryIndex]) {
        queryIndex++;
      }
    }
    return queryIndex === normalizedQuery.length;
  };

  // Filter models based on category and search
  const filteredModels = models
    .filter(model => {
      // Filter by category
      if (selectedCategory && model.category !== selectedCategory) {
        return false;
      }
      return true;
    })
    .filter(model =>
      // Fuzzy search
      fuzzyMatch(model.name, search) || fuzzyMatch(model.provider, search)
    );

  // Group models by provider
  const groupedModels = filteredModels.reduce((groups, model) => {
    const provider = model.provider || 'Other';
    if (!groups[provider]) {
      groups[provider] = [];
    }
    groups[provider].push(model);
    return groups;
  }, {} as Record<string, Model[]>);

  const selectedModel = models.find(model => model.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'border-none bg-transparent font-medium text-muted-foreground shadow-none transition-colors',
            'hover:bg-accent hover:text-foreground [&[aria-expanded="true"]]:bg-accent [&[aria-expanded="true"]]:text-foreground',
            'justify-between w-[200px] text-left truncate',
            className
          )}
        >
          {loading ? (
            <div className="flex items-center">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('model_selector.loading')}
            </div>
          ) : selectedModel ? (
            <span className="truncate">{selectedModel.name}</span>
          ) : (
            <span className="truncate">{placeholder || t('model_selector.label')}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <div className="flex items-center border-b px-3">
            <CommandInput
              placeholder={t('model_selector.search_placeholder')}
              value={search}
              onValueChange={setSearch}
              className="flex-1"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8 w-8 p-0 ml-2",
                    selectedCategory && "text-primary"
                  )}
                >
                  <Filter className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[200px]">
                <DropdownMenuLabel>Filter by Category</DropdownMenuLabel>
                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => setSelectedCategory(null)}
                  className={cn(!selectedCategory && "bg-accent")}
                >
                  <Check className={cn("mr-2 h-4 w-4", !selectedCategory ? "opacity-100" : "opacity-0")} />
                  All Categories
                  <span className="ml-auto text-xs text-muted-foreground">
                    {models.length}
                  </span>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {availableCategories.map(({ category, count, label }) => (
                  <DropdownMenuItem
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={cn(selectedCategory === category && "bg-accent")}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedCategory === category ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {label}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {count}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {selectedCategory && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 ml-1"
                onClick={() => setSelectedCategory(null)}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          <CommandList>
            <CommandEmpty>
              {selectedCategory
                ? `No models found in "${getCategoryDisplayName(selectedCategory)}" category`
                : t('model_selector.no_models_found')
              }
            </CommandEmpty>
            {Object.entries(groupedModels).map(([provider, providerModels]) => (
              <CommandGroup key={provider} heading={provider.charAt(0).toUpperCase() + provider.slice(1)}>
                {providerModels.map((model) => (
                  <CommandItem
                    key={model.id}
                    value={model.id}
                    onSelect={() => {
                      onValueChange?.(model.id);
                      setOpen(false);
                      setSearch('');
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === model.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col flex-1">
                      <span>{model.name}</span>
                      {model.contextLength && (
                        <span className="text-xs text-muted-foreground">
                          {model.contextLength >= 1000
                            ? t('model_selector.context_k', { count: Math.round(model.contextLength / 1000) })
                            : t('model_selector.context', { count: model.contextLength })
                          }
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};