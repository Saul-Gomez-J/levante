import { ProviderConfigPanel } from '@/components/providers/ProviderConfigPanel';

const ModelPage = () => {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 space-y-6">
        <ProviderConfigPanel />
      </div>
    </div>
  );
};

export default ModelPage;
