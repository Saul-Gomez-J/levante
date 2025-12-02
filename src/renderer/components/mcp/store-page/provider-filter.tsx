import { Home, Star } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MCPProvider } from '@/types/mcp';
import { useTranslation } from 'react-i18next';

interface ProviderFilterProps {
  providers: MCPProvider[];
  selectedProvider: string | 'all';
  onSelectProvider: (id: string | 'all') => void;
}

const providerIcons: Record<string, React.ReactNode> = {
  home: <Home className="h-4 w-4" />,
  star: <Star className="h-4 w-4" />,
};

export function ProviderFilter({
  providers,
  selectedProvider,
  onSelectProvider,
}: ProviderFilterProps) {
  const { t } = useTranslation('mcp');

  const enabledProviders = providers.filter(p => p.enabled);

  return (
    <Select
      value={selectedProvider}
      onValueChange={(value) => onSelectProvider(value as string | 'all')}
    >
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder={t('store.filter_provider')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">
          {t('store.all_providers')}
        </SelectItem>
        {enabledProviders.map((provider) => (
          <SelectItem key={provider.id} value={provider.id}>
            <div className="flex items-center gap-2">
              {providerIcons[provider.icon] || <Home className="h-4 w-4" />}
              <span>{provider.name}</span>
              {provider.serverCount !== undefined && provider.serverCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  ({provider.serverCount})
                </span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
