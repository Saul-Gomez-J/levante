'use client';

import { Badge } from '@/components/ui/badge';
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
import { Check, ChevronsUpDown, Loader2, Filter, X, ChevronRight, ChevronDown } from 'lucide-react';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { Model, GroupedModelsByProvider } from '../../../types/models';
import type { ModelCategory } from '../../../types/modelCategories';
import { useTranslation } from 'react-i18next';

export interface ModelSearchableSelectProps {
  value?: string;
  onValueChange?: (value: string) => void;

  models: Model[];
  groupedModels?: GroupedModelsByProvider;
  loading?: boolean;
  placeholder?: string;
  className?: string;
  useCustomPortalContainer?: boolean;
  expandMiniChatOnOpen?: boolean;
}

export const ModelSearchableSelect = ({
  value,
  onValueChange,
  models,
  groupedModels,
  loading = false,
  placeholder,
  className,
  useCustomPortalContainer = false,
  expandMiniChatOnOpen = false,
}: ModelSearchableSelectProps) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ModelCategory | null>(null);
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(new Set());

  // Ref al contenedor custom del portal (si se usa)
  const portalContainerRef = useRef<HTMLDivElement | null>(null);

  // Ref para almacenar la altura original antes de expandir
  const originalHeightRef = useRef<number | null>(null);

  useEffect(() => {
    if (useCustomPortalContainer) {
      // Crear contenedor para el portal si no existe
      let container = document.getElementById('mini-chat-popover-portal');
      if (!container) {
        container = document.createElement('div');
        container.id = 'mini-chat-popover-portal';
        container.style.position = 'absolute';
        container.style.top = '0';
        container.style.left = '0';
        container.style.width = '100%';
        container.style.height = '100%';
        container.style.zIndex = '99999';
        container.style.pointerEvents = 'none';
        document.body.appendChild(container);
      }

      // Sync dark mode class from document to portal container
      const syncDarkMode = () => {
        if (container) {
          if (document.documentElement.classList.contains('dark')) {
            container.classList.add('dark');
          } else {
            container.classList.remove('dark');
          }
        }
      };

      // Initial sync
      syncDarkMode();

      // Observe changes to the dark class on document
      const observer = new MutationObserver(syncDarkMode);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class']
      });

      portalContainerRef.current = container as HTMLDivElement;

      return () => {
        observer.disconnect();
      };
    }

    return () => {
      // Cleanup: remover contenedor si el componente se desmonta
      if (useCustomPortalContainer && portalContainerRef.current) {
        portalContainerRef.current.remove();
      }
    };
  }, [useCustomPortalContainer]);

  // Handler para abrir/cerrar el popover
  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen);
  }, []);

  // Effect para manejar el resize del mini-chat cuando cambia el estado open
  useEffect(() => {
    if (!expandMiniChatOnOpen || !window.levante?.miniChat) {
      return;
    }

    async function handleResize() {
      if (open) {
        // Abriendo: guardar la altura actual antes de expandir
        if (window.levante?.miniChat?.getHeight) {
          try {
            const result = await window.levante.miniChat.getHeight();
            if (result.success) {
              originalHeightRef.current = result.height;
            }
          } catch (error) {
            console.error('Failed to get mini-chat height:', error);
          }
        }

        // Expandir a altura máxima cuando se abre
        if (window.levante?.miniChat?.resize) {
          window.levante.miniChat.resize(500);
        }
      } else {
        // Cerrando: restaurar a la altura original guardada
        if (window.levante?.miniChat?.resize && originalHeightRef.current !== null) {
          // Pequeño delay para asegurar que el popover ya se cerró
          setTimeout(() => {
            if (window.levante?.miniChat?.resize && originalHeightRef.current !== null) {
              window.levante.miniChat.resize(originalHeightRef.current);
              originalHeightRef.current = null;
            }
          }, 100);
        }
      }
    }

    handleResize();
  }, [open, expandMiniChatOnOpen]);

  // Toggle provider collapse
  const toggleProviderCollapse = (providerId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const newCollapsed = new Set(collapsedProviders);
    if (newCollapsed.has(providerId)) {
      newCollapsed.delete(providerId);
    } else {
      newCollapsed.add(providerId);
    }
    setCollapsedProviders(newCollapsed);
  };

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

  // Determine effective models list for categories: use all models from all providers if grouped
  const effectiveModelsForCategories = useMemo(() => {
    if (groupedModels) {
      return groupedModels.providers.flatMap(p => p.models);
    }
    return models;
  }, [models, groupedModels]);

  // Calculate available categories with counts
  const availableCategories = useMemo(() => {
    const counts = new Map<ModelCategory, number>();

    effectiveModelsForCategories.forEach(model => {
      if (model.category) {
        counts.set(model.category, (counts.get(model.category) || 0) + 1);
      }
    });

    return Array.from(counts.entries()).map(([category, count]) => ({
      category,
      count,
      label: getCategoryDisplayName(category)
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [effectiveModelsForCategories]);

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

  // Prepare display groups (supporting both legacy 'models' and new 'groupedModels')
  const displayGroups = useMemo(() => {
    // Helper to filter a list of models
    const filterModels = (list: Model[]) => {
      return list
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
    };

    if (groupedModels && groupedModels.providers.length > 0) {
      // Use grouped models from service
      return groupedModels.providers
        .map(group => ({
          id: group.provider.id,
          name: group.provider.name,
          models: filterModels(group.models),
          originalCount: group.modelCount,
          active: group.provider.isActive // For highlighting
        }))
        .filter(group => group.models.length > 0);
    } else {
      // Legacy fallback: group the 'models' prop manually
      const filtered = filterModels(models);

      const groups: Record<string, Model[]> = {};
      filtered.forEach(model => {
        const providerName = model.provider || 'Other';
        if (!groups[providerName]) {
          groups[providerName] = [];
        }
        groups[providerName].push(model);
      });

      return Object.entries(groups).map(([name, models]) => ({
        id: name,
        name: name.charAt(0).toUpperCase() + name.slice(1),
        models,
        originalCount: models.length,
        active: false // Can't detect active in legacy mode easily without prop
      }));
    }
  }, [models, groupedModels, selectedCategory, search]);

  // Auto-expand active provider group initially
  useEffect(() => {
    if (groupedModels && !open) {
      // Reset collapse state when closed? 
      // User requirement: "Providers displayed as collapsible groups (closed by default)."
      // Maybe we want to keep them closed by default except the one with the selected model?
      // Or simply default all to closed? 
      // Let's default to closed, but user might want to see the selected model.

      const shouldCollapse = new Set<string>();
      groupedModels.providers.forEach(p => {
        // If this provider does NOT contain the selected model, collapse it?
        // Or collapse everything by default except active provider?
        // Requirement: "Active provider highlighted".
        // Let's start with all expanded or all collapsed? 
        // "Providers displayed as collapsible groups (closed by default)" -> This suggests all closed?
        // But that hides the models. Usually "closed by default" means non-active ones.
        // Let's implement logic: collapse all groups that do NOT contain the currently selected model.

        const hasSelectedModel = p.models.some(m => m.id === value);
        if (!hasSelectedModel) {
          shouldCollapse.add(p.provider.id);
        }
      });
      setCollapsedProviders(shouldCollapse);
    }
  }, [groupedModels, open, value]); // Re-run when opening

  const selectedModel = useMemo(() => {
    if (groupedModels) {
      for (const group of groupedModels.providers) {
        const found = group.models.find(m => m.id === value);
        if (found) return found;
      }
    }
    return models.find(model => model.id === value);
  }, [models, groupedModels, value]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
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
      <PopoverContent
        className="w-[300px] p-0"
        align="start"
        container={useCustomPortalContainer ? portalContainerRef.current : undefined}
        style={useCustomPortalContainer ? { pointerEvents: 'auto' } : undefined}
      >
        <Command shouldFilter={false}>
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
            {displayGroups.length === 0 && (
              <div className="py-6 text-center text-sm">
                {selectedCategory
                  ? `No models found in "${getCategoryDisplayName(selectedCategory)}" category`
                  : t('model_selector.no_models_found')
                }
              </div>
            )}
            {displayGroups.map((group) => {
              const isCollapsed = collapsedProviders.has(group.id);

              return (
                <CommandGroup
                  key={group.id}
                  heading={
                    <div
                      className="flex items-center cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1 py-0.5 select-none"
                      onClick={(e) => toggleProviderCollapse(group.id, e)}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3 w-3 mr-1 opacity-70" />
                      ) : (
                        <ChevronDown className="h-3 w-3 mr-1 opacity-70" />
                      )}
                      <span className={cn(
                        "font-medium flex-1",
                        group.active && "text-primary font-bold"
                      )}>
                        {group.name}
                        <span className="ml-1.5 text-xs text-muted-foreground font-normal opacity-70">
                          ({group.models.length})
                        </span>
                      </span>
                    </div>
                  }
                >
                  {!isCollapsed && group.models.map((model) => (
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
                        <div className="flex items-center gap-1.5">
                          <span>{model.name}</span>
                          {model.zeroDataRetention && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-medium text-green-600 border-green-600/30">
                              {t('model_selector.private_badge')}
                            </Badge>
                          )}
                        </div>
                        {model.contextLength > 0 && (
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
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};