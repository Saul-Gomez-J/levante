import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

interface ProviderFilterProps {
  selectedProvider: string | 'all';
  availableProviders: string[];
  onSelectProvider: (provider: string | 'all') => void;
}

export function ProviderFilter({
  selectedProvider,
  availableProviders,
  onSelectProvider
}: ProviderFilterProps) {
  const { t } = useTranslation('mcp');

  return (
    <div className="flex gap-2">
      <Button
        variant={selectedProvider === 'all' ? 'default' : 'outline'}
        onClick={() => onSelectProvider('all')}
        size="sm"
      >
        {t('store.all_providers')}
      </Button>

      {availableProviders.map(provider => (
        <Button
          key={provider}
          variant={selectedProvider === provider ? 'default' : 'outline'}
          onClick={() => onSelectProvider(provider)}
          size="sm"
        >
          {provider.charAt(0).toUpperCase() + provider.slice(1)}
        </Button>
      ))}
    </div>
  );
}
